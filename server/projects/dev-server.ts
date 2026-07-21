/**
 * Own-the-spawn dev server (M-F), terminal-first. Each project gets a real
 * interactive **shell** running in a PTY (Bun.Terminal); we auto-run the dev
 * command in it with a free port injected, so we know the URL a priori. The
 * shell is what makes it a genuine terminal: Ctrl-C interrupts the dev server
 * (the shell's job control turns \x03 into SIGINT for the foreground job) and
 * drops you back to a prompt where you can run anything — build, git, install,
 * or re-run dev. Re-running reuses the same shell + port.
 *
 * Because the dev server is now "a command in your shell" rather than a tracked
 * process, "is it running?" is answered by the **port** (is the assigned port
 * listening?), not by the shell's liveness — the shell stays up across Ctrl-C.
 *
 * The PTY stream is buffered in a ring + fanned out to subscribers, which the
 * dev-server terminal WebSocket (`/api/dev-terminal`) replays + streams into
 * the interactive xterm bottom sheet.
 */
import { realpath } from "node:fs/promises";
import type { ProjectFramework } from "../../shared/types";
import {
  clearTerminal,
  recordDetectedUrl,
  removeDetectedUrl,
} from "../preview/detector";
import { buildCommand, resolveLaunch } from "./launch-config";

type DataSub = (chunk: Uint8Array) => void;
type ExitSub = () => void;

interface RingBuffer {
  chunks: Uint8Array[];
  bytes: number;
}

interface RunningDevServer {
  terminal: Bun.Terminal;
  proc: Bun.Subprocess; // the shell
  port: number;
  /** The preview URL to surface — the configured `url` override, else
   *  `http://localhost:<port>`. Kept so status reports the same URL that start did. */
  url: string;
  /** The dev command we type into the shell — re-typed to restart on the same port. */
  command: string;
  ring: RingBuffer;
  dataSubs: Set<DataSub>;
  exitSubs: Set<ExitSub>;
  exited: boolean;
}

const RING_BYTES_CAP = 256 * 1024; // 256 KB of scrollback per shell
// How long a dev server gets to answer the "are you actually alive?" probe.
// Generous enough for a cold Next.js route compile, short enough that a hung
// server doesn't stall Run.
const HTTP_PROBE_MS = 5_000;
const running = new Map<string, RunningDevServer>();

/**
 * Dev servers we did NOT spawn but have adopted: something was already
 * listening on the project's port from inside the project directory, so it IS
 * this project's dev server (started in the user's own terminal, or leaked from
 * a previous Clidable process). We point the preview at it instead of racing
 * it — starting a second one is at best a duplicate and at worst impossible:
 * Next.js refuses outright ("Another next dev server is already running") no
 * matter which port we pass. No shell, so no terminal to attach; Stop still
 * works because stopping is port-based.
 *
 * `pids` is who was listening when we adopted. Keeping it lets the status check
 * tell "still the server we adopted" from "that process died and something else
 * took the port" — a port number alone can't.
 */
const adopted = new Map<string, { port: number; url: string; pids: number[] }>();

export interface DevServerStatus {
  running: boolean;
  port: number | null;
  url: string | null;
  logs: string[];
}

// Ports handed out by findFreePort but not yet bound — so two cold starts
// racing don't pick the same port before either server is listening.
const reservedPorts = new Set<number>();
// In-flight starts, deduped per project so a second start during cold start
// (auto-run + a quick manual Run) doesn't spawn a second shell + orphan the first.
const startInFlight = new Map<string, Promise<{ port: number; url: string }>>();

export function startDevServer(
  projectPath: string,
  framework: ProjectFramework,
): Promise<{ port: number; url: string }> {
  const inFlight = startInFlight.get(projectPath);
  if (inFlight) return inFlight;
  const p = doStartDevServer(projectPath, framework).finally(() =>
    startInFlight.delete(projectPath),
  );
  startInFlight.set(projectPath, p);
  return p;
}

async function doStartDevServer(
  projectPath: string,
  framework: ProjectFramework,
): Promise<{ port: number; url: string }> {
  const plan = await resolveLaunch(projectPath, framework);
  const existing = running.get(projectPath);
  const alive = existing && !existing.exited ? existing : null;

  // Nothing of ours is running, but the project's port may already be held by
  // the project itself — the user's own `npm run dev`, or a dev server leaked
  // by a previous Clidable process. Never race it. Checked before the "can we
  // even launch this?" guard below: something already serving the project is
  // previewable whether or not we'd know how to start it ourselves.
  const candidate = plan.fixedPort ?? plan.defaultPort;
  const owners = alive ? [] : await projectOwnedPids(candidate, projectPath);
  const heldByProject = owners.length > 0;
  if (heldByProject && (await isServingHttp(candidate))) {
    const url = plan.urlOverride ?? `http://localhost:${candidate}`;
    adopted.set(projectPath, { port: candidate, url, pids: owners });
    // "process", not "spawn": we observed this server, we didn't start it.
    recordDetectedUrl(projectPath, `dev:${candidate}`, `http://localhost:${candidate}`, "process");
    return { port: candidate, url };
  }

  if (!plan.customCommand && !plan.detected) {
    throw new Error(
      "No dev command detected for this project — set one in “Configure dev server”.",
    );
  }

  // Holds the port but answers nothing: a dead dev server for this project.
  // Nothing can preview it, and (for Next) nothing else can start while it
  // lives — so take the port back. Only now that we know we have something to
  // start in its place.
  if (heldByProject) {
    console.log(
      `[dev-server] reclaiming port ${candidate} from an unresponsive dev server for ${projectPath}`,
    );
    await killPort(projectPath, candidate);
    await waitForPortFree(candidate);
  }

  // Past the adoption check → we own (or are about to own) this project's dev
  // server; any earlier adoption is stale.
  adopted.delete(projectPath);

  // Decide the port BEFORE building the command so a detected command's injected
  // `--port` always matches what we probe. An alive shell keeps its own port
  // unless the config now pins a different one. A custom command can't have a
  // scanned port injected, so it takes the configured/framework port and relies
  // on PORT in the env.
  const port =
    plan.fixedPort ??
    alive?.port ??
    (plan.customCommand ? plan.defaultPort : await findFreePort(plan.defaultPort));
  const command =
    plan.customCommand ??
    buildCommand(plan.detected!.pm, plan.detected!.script, plan.detected!.inject, port);
  const url = plan.urlOverride ?? `http://localhost:${port}`;

  // Reuse the shell only if it would run the same thing. Re-typing a stale
  // command would silently ignore a command/port the user just changed in
  // "Configure dev server" (the shell survives Ctrl-C, so the entry outlives a
  // Stop). A url-only edit needs no respawn.
  let entry = alive && alive.port === port && alive.command === command ? alive : null;
  if (entry) {
    entry.url = url;
    if (await isPortUp(entry.port)) return { port: entry.port, url: entry.url };
    // Shell alive but the dev server isn't (e.g. after Ctrl-C) — re-run it on
    // the same port, in the same shell.
    writeCommand(entry, entry.command);
  } else {
    if (alive) disposeShell(projectPath, alive); // config changed → drop the stale shell
    try {
      entry = spawnShell(projectPath, port, url, command);
      running.set(projectPath, entry);
      await delay(300);
      writeCommand(entry, command);
    } finally {
      reservedPorts.delete(port); // now tracked via `running`
    }
  }

  const ready = await waitForPort(entry.port);
  if (!ready) {
    // Don't return/record a URL nothing is listening on — the broken script's
    // output is in the terminal for the user to see.
    throw new Error(startFailureMessage(entry.port, plan.customCommand !== null));
  }
  // Record the loopback URL (not the override) for the reverse-proxy allowlist,
  // which is keyed on the actually-listening local port.
  recordDetectedUrl(projectPath, `dev:${entry.port}`, `http://localhost:${entry.port}`, "spawn");
  return { port: entry.port, url: entry.url };
}

/**
 * Tear down a shell we're replacing because the launch config changed. Runs the
 * normal exit cleanup (detector buffer + proxy allowlist for the OLD port) and
 * drops it from `running`; the real `onExit` that follows early-returns on the
 * `exited` flag, and handleExit's identity check keeps it from evicting the
 * replacement entry we set right after.
 */
function disposeShell(projectPath: string, entry: RunningDevServer): void {
  try {
    entry.proc?.kill();
  } catch {
    // already gone
  }
  handleExit(projectPath, entry);
}

/** A port that never came up. When the user supplied the command we can't know
 *  which port it binds, so point them at the setting that fixes it. */
function startFailureMessage(port: number, custom: boolean): string {
  const base = `dev server didn't start listening on port ${port} — check the terminal for errors`;
  return custom
    ? `${base}. If your command binds a different port, set “Local port” in “Configure dev server” to match.`
    : base;
}

function spawnShell(
  projectPath: string,
  port: number,
  url: string,
  command: string,
): RunningDevServer {
  // terminal/proc are assigned immediately below; the data/exit callbacks that
  // close over `entry` only fire afterwards.
  const entry: RunningDevServer = {
    terminal: undefined as unknown as Bun.Terminal,
    proc: undefined as unknown as Bun.Subprocess,
    port,
    url,
    command,
    ring: { chunks: [], bytes: 0 },
    dataSubs: new Set(),
    exitSubs: new Set(),
    exited: false,
  };
  // Use the user's interactive shell on POSIX; on Windows fall back to the
  // command processor (no `-i`). $SHELL is unset on Windows, so the old
  // `$SHELL || /bin/zsh` would have tried to spawn a nonexistent /bin/zsh.
  const isWin = process.platform === "win32";
  const shell = isWin
    ? process.env.COMSPEC || "cmd.exe"
    : process.env.SHELL || "/bin/bash";
  const shellArgs = isWin ? [] : ["-i"];
  entry.terminal = new Bun.Terminal({
    cols: 120,
    rows: 30,
    data: (_t, data) => onData(entry, data),
    exit: () => {},
  });
  entry.proc = Bun.spawn([shell, ...shellArgs], {
    terminal: entry.terminal,
    cwd: projectPath,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      FORCE_COLOR: "1",
      // Export the resolved port so a *custom* command that reads PORT (the
      // common convention) binds where we probe, without the user hardcoding it.
      // Detected commands inject the port themselves and don't rely on this.
      PORT: String(port),
    },
    onExit: () => handleExit(projectPath, entry),
  });
  return entry;
}

/** Type a command into the shell (as if the user pressed Enter). */
function writeCommand(entry: RunningDevServer, command: string): void {
  try {
    entry.terminal.write(`${command}\r`);
  } catch {
    // shell may have exited
  }
}

function onData(entry: RunningDevServer, data: Uint8Array): void {
  const copy = new Uint8Array(data); // off the shared PTY buffer
  appendRing(entry, copy);
  for (const sub of entry.dataSubs) {
    try {
      sub(copy);
    } catch {
      // a dead subscriber shouldn't break the fan-out
    }
  }
}

function handleExit(projectPath: string, entry: RunningDevServer): void {
  if (entry.exited) return;
  entry.exited = true;
  if (running.get(projectPath) === entry) running.delete(projectPath);
  clearTerminal(`dev:${entry.port}`); // free the detector's rolling buffer
  removeDetectedUrl(projectPath, `http://localhost:${entry.port}`); // purge the allowlist
  for (const sub of entry.exitSubs) {
    try {
      sub();
    } catch {
      // ignore
    }
  }
  try {
    entry.terminal?.close();
  } catch {
    // already closed
  }
}

function appendRing(entry: RunningDevServer, chunk: Uint8Array): void {
  entry.ring.chunks.push(chunk);
  entry.ring.bytes += chunk.byteLength;
  while (entry.ring.bytes > RING_BYTES_CAP && entry.ring.chunks.length > 1) {
    const dropped = entry.ring.chunks.shift()!;
    entry.ring.bytes -= dropped.byteLength;
  }
}

function concatRing(ring: RingBuffer): Uint8Array {
  const out = new Uint8Array(ring.bytes);
  let off = 0;
  for (const c of ring.chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/* --- dev-server terminal stream (read by /api/dev-terminal) --- */

export interface DevTerminalHandle {
  port: number;
  replay: Uint8Array;
  unsubscribe: () => void;
}

/** Attach to a project's shell PTY stream. Null if there's no shell. */
export function attachDevTerminal(
  projectPath: string,
  onChunk: DataSub,
  onExit: ExitSub,
): DevTerminalHandle | null {
  const entry = running.get(projectPath);
  if (!entry || entry.exited) return null;
  entry.dataSubs.add(onChunk);
  entry.exitSubs.add(onExit);
  return {
    port: entry.port,
    replay: concatRing(entry.ring),
    unsubscribe() {
      entry.dataSubs.delete(onChunk);
      entry.exitSubs.delete(onExit);
    },
  };
}

/** Port of an adopted (externally started) dev server for this project, or null.
 *  Lets the terminal endpoint say "no terminal, because we didn't spawn it"
 *  instead of the misleading "not running". */
export function adoptedDevServerPort(projectPath: string): number | null {
  return adopted.get(projectPath)?.port ?? null;
}

/** Forward stdin to the shell PTY — keystrokes, and control chars like Ctrl-C
 *  (\x03), which the shell's job control turns into SIGINT for the dev server. */
export function writeDevTerminal(
  projectPath: string,
  data: string | Uint8Array,
): void {
  const entry = running.get(projectPath);
  if (!entry || entry.exited || !entry.terminal) return;
  try {
    entry.terminal.write(data);
  } catch {
    // shell may have exited
  }
}

/** Resize the shell PTY so output wraps to the panel width. */
export function resizeDevTerminal(
  projectPath: string,
  cols: number,
  rows: number,
): void {
  const entry = running.get(projectPath);
  if (!entry || entry.exited || !entry.terminal) return;
  try {
    entry.terminal.resize(cols, rows);
    if (entry.proc.pid) process.kill(entry.proc.pid, "SIGWINCH");
  } catch {
    // shell may have exited
  }
}

/**
 * Stop the dev server: send Ctrl-C to return the shell to a prompt, and kill
 * whatever is actually listening on the assigned port. The shell stays alive so
 * the user keeps a prompt to run other commands.
 */
export function stopDevServer(projectPath: string): boolean {
  const entry = running.get(projectPath);
  if (entry && !entry.exited) {
    writeDevTerminal(projectPath, "\x03");
    void killDevServerPort(projectPath);
    return true;
  }
  // An adopted server has no shell to interrupt — kill it by port. This is the
  // user's only handle on a dev server leaked by a previous Clidable process.
  const ext = adopted.get(projectPath);
  if (!ext) return false;
  adopted.delete(projectPath);
  void killPort(projectPath, ext.port);
  return true;
}

/**
 * Kill whatever is listening on the dev server's assigned port. `bun run dev`
 * spawns the real server as a child that *orphans* (re-parents to launchd/init)
 * when the shell interrupts the wrapper — so it survives Ctrl-C and keeps the
 * port, spamming output into the now-idle prompt. Finding it by port and
 * killing it directly is robust to the re-parenting. The shell never listens on
 * this port, so it's untouched.
 */
export async function killDevServerPort(projectPath: string): Promise<void> {
  const entry = running.get(projectPath);
  const port = entry && !entry.exited ? entry.port : adopted.get(projectPath)?.port;
  if (port == null) return;
  await killPort(projectPath, port);
}

async function killPort(projectPath: string, port: number): Promise<void> {
  removeDetectedUrl(projectPath, `http://localhost:${port}`); // it's going down
  for (const pid of await pidsOnPort(port)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  // Escalate to SIGKILL for anything that ignored SIGTERM.
  setTimeout(() => {
    void (async () => {
      for (const pid of await pidsOnPort(port)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    })();
  }, 1200);
}

/** PIDs listening on a TCP port (lsof on macOS/Linux, Get-NetTCPConnection on
 *  Windows). Empty on error or if nothing's listening. */
async function pidsOnPort(port: number): Promise<number[]> {
  try {
    const cmd =
      process.platform === "win32"
        ? [
            "powershell",
            "-NoProfile",
            "-Command",
            `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess`,
          ]
        : ["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"];
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return [
      ...new Set(
        text
          .split(/\s+/)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * Which processes listening on `port` are this project's own dev server —
 * those whose working directory is the project (or a directory inside it, for a
 * monorepo package). A non-empty result is what lets us adopt an already-running
 * server instead of starting a rival one, and it's deliberately strict: an
 * unrelated app squatting the port yields nothing and we scan on as before.
 *
 * POSIX only (`lsof` reports a process's cwd); on Windows this is always empty,
 * so Windows keeps the old scan-to-the-next-free-port behaviour.
 */
async function projectOwnedPids(port: number, projectPath: string): Promise<number[]> {
  if (process.platform === "win32") return [];
  // Cheap in-process TCP check first: on a free port — the common case for
  // every project open — this returns false and saves spawning lsof at all.
  if (!(await isPortUp(port))) return [];
  const pids = await pidsOnPort(port);
  if (pids.length === 0) return [];
  // Compare resolved paths: a process's cwd is always fully resolved, while the
  // project path can be reached through a symlink (on macOS every path under
  // /tmp or /var already is one), and a raw string compare would miss the match.
  const root = await realpath(projectPath).catch(() => projectPath);
  const cwds = await Promise.all(pids.map(processCwd));
  return pids.filter((_, i) => {
    const cwd = cwds[i];
    return cwd != null && (cwd === root || cwd.startsWith(`${root}/`));
  });
}

/** Is this pid still around? EPERM means it exists but belongs to someone else,
 *  which still counts as alive. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Does the port answer an actual HTTP request? A TCP accept is not enough: a
 * crashed dev server can keep its listening socket open and never reply, which
 * is a black hole for the preview (and the state a leaked `next dev` ends up
 * in). Any response — even a 404/500 — counts as alive.
 */
async function isServingHttp(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_PROBE_MS),
    });
    return true;
  } catch {
    return false;
  }
}

/** Wait (briefly) for a port to stop listening after we've killed its owner. */
async function waitForPortFree(port: number): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (!(await isPortUp(port))) return;
    await delay(200);
  }
}

/** A process's current working directory, or null if it can't be determined. */
async function processCwd(pid: number): Promise<string | null> {
  try {
    const proc = Bun.spawn(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    // -F output is one field per line, prefixed by its type: `n<path>`.
    for (const line of text.split("\n")) {
      if (line.startsWith("n/")) return line.slice(1);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Kill every dev-server shell on the way out. Each shell is a PTY session
 * leader, so its pid doubles as the process-group id — signalling the *group*
 * takes the dev server (and its children) with it. Without this they re-parent
 * to init and keep holding their ports forever, invisible to the user: exactly
 * how a stale `next dev` ends up squatting :3000 across a restart.
 */
export function shutdownDevServers(): void {
  for (const [projectPath, entry] of [...running]) {
    const pid = entry.proc?.pid;
    try {
      if (pid) process.kill(-pid, "SIGKILL");
    } catch {
      try {
        entry.proc?.kill();
      } catch {
        // already gone
      }
    }
    handleExit(projectPath, entry);
  }
}

export async function devServerStatus(
  projectPath: string,
): Promise<DevServerStatus> {
  const entry = running.get(projectPath);
  if (!entry || entry.exited) {
    const ext = adopted.get(projectPath);
    if (!ext) return { running: false, port: null, url: null, logs: [] };
    // An adopted server has to clear the same bar it was adopted on, not just
    // "something accepts TCP here". A wedged dev server keeps its listening
    // socket open forever, and reporting that as running is precisely the
    // blank-preview-under-a-green-badge bug adoption exists to avoid — the UI
    // polls this and skips auto-run whenever it says running, so nothing would
    // ever recover. The pid check catches the other half: the process we
    // adopted died and something unrelated now holds its port.
    if (ext.pids.some(pidAlive) && (await isServingHttp(ext.port))) {
      return { running: true, port: ext.port, url: ext.url, logs: [] };
    }
    // The server we adopted went away — forget it (and un-allowlist its port)
    // so the next Run starts a fresh one of our own.
    adopted.delete(projectPath);
    removeDetectedUrl(projectPath, `http://localhost:${ext.port}`);
    return { running: false, port: null, url: null, logs: [] };
  }
  if (await isPortUp(entry.port)) {
    return {
      running: true,
      port: entry.port,
      url: entry.url,
      logs: [],
    };
  }
  // Shell alive but nothing on the port (interrupted / not started yet).
  return { running: false, port: null, url: null, logs: [] };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until the assigned port accepts a connection, or we time out. */
async function waitForPort(port: number): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await isPortUp(port)) return true;
    await delay(250);
  }
  return false;
}

async function isPortUp(port: number): Promise<boolean> {
  return (await canConnect("127.0.0.1", port)) || (await canConnect("::1", port));
}

/** Find a free TCP port at/after `start` (bounded scan), reserving it so a
 *  concurrent cold start doesn't pick the same one before it binds. Throws if
 *  none free — never returns 0 (a dead http://localhost:0 preview). */
async function findFreePort(start: number): Promise<number> {
  const end = Math.min(start + 200, 65535);
  // Ports already handed to a running (or starting) dev server count as taken
  // even before their server has bound.
  const assigned = new Set(
    [...running.values()].filter((e) => !e.exited).map((e) => e.port),
  );
  for (let port = start; port <= end; port++) {
    if (reservedPorts.has(port) || assigned.has(port)) continue;
    if (!(await isPortUp(port))) {
      reservedPorts.add(port);
      return port;
    }
  }
  throw new Error(`no free port available near ${start}`);
}

async function canConnect(hostname: string, port: number): Promise<boolean> {
  try {
    const sock = await Bun.connect({
      hostname,
      port,
      socket: { data() {}, open() {}, close() {}, error() {} },
    });
    sock.end();
    return true; // connected → something is listening here
  } catch {
    return false; // connection refused → free
  }
}
