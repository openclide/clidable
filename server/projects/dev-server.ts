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
import type { ProjectFramework } from "../../shared/types";
import {
  clearTerminal,
  recordDetectedUrl,
  removeDetectedUrl,
} from "../preview/detector";

interface DevPlan {
  cmd: (port: number) => string[];
  env?: (port: number) => Record<string, string>;
  defaultPort: number;
}

// Two launch shapes: the vite family takes a `--port`/`--host` flag; everyone
// else reads PORT from the env. Only the default port varies per framework.
const flagPlan = (defaultPort: number): DevPlan => ({
  cmd: (p) => ["bun", "run", "dev", "--port", String(p), "--host", "127.0.0.1"],
  defaultPort,
});
const envPlan = (defaultPort: number): DevPlan => ({
  cmd: () => ["bun", "run", "dev"],
  env: (p) => ({ PORT: String(p) }),
  defaultPort,
});

/** How to run + inject the port per framework. Absent = no known dev command
 *  (python / rust / go / expo / unknown run their server in the terminal). */
const DEV_PLANS: Partial<Record<ProjectFramework, DevPlan>> = {
  vite: flagPlan(5173),
  sveltekit: flagPlan(5173),
  astro: flagPlan(4321),
  nextjs: envPlan(3000),
  nuxt: envPlan(3000),
  remix: envPlan(3000),
  hono: envPlan(3000),
  node: envPlan(3000),
};

function devPlan(framework: ProjectFramework): DevPlan | null {
  return DEV_PLANS[framework] ?? null;
}

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
  /** The dev command we type into the shell — re-typed to restart on the same port. */
  command: string;
  ring: RingBuffer;
  dataSubs: Set<DataSub>;
  exitSubs: Set<ExitSub>;
  exited: boolean;
}

const RING_BYTES_CAP = 256 * 1024; // 256 KB of scrollback per shell
const running = new Map<string, RunningDevServer>();

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
  const plan = devPlan(framework);
  if (!plan) {
    throw new Error(
      `no known dev command for "${framework}" — run your server in the terminal`,
    );
  }

  let entry = running.get(projectPath);
  if (!entry || entry.exited) {
    // Fresh shell: pick a free port, build the dev command, spawn, then type it
    // once the interactive shell has printed its first prompt.
    const port = await findFreePort(plan.defaultPort);
    try {
      const command = buildCommand(plan, port);
      entry = spawnShell(projectPath, port, command);
      running.set(projectPath, entry);
      await delay(300);
      writeCommand(entry, command);
    } finally {
      reservedPorts.delete(port); // now tracked via `running`
    }
  } else if (await isPortUp(entry.port)) {
    return { port: entry.port, url: `http://localhost:${entry.port}` };
  } else {
    // Shell alive but the dev server isn't (e.g. after Ctrl-C) — re-run it on
    // the same port, in the same shell.
    writeCommand(entry, entry.command);
  }

  const url = `http://localhost:${entry.port}`;
  const ready = await waitForPort(entry.port);
  if (!ready) {
    // Don't return/record a URL nothing is listening on — the broken script's
    // output is in the terminal for the user to see.
    throw new Error(
      `dev server didn't start listening on port ${entry.port} — check the terminal for errors`,
    );
  }
  recordDetectedUrl(projectPath, `dev:${entry.port}`, url, "spawn");
  return { port: entry.port, url };
}

/** Build the shell command line from a plan, inlining any env assignments
 *  (e.g. `PORT=3001 bun run dev`). Our values are simple literals — no quoting. */
function buildCommand(plan: DevPlan, port: number): string {
  const cmd = plan.cmd(port).join(" ");
  const env = plan.env?.(port) ?? {};
  const prefix = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return prefix ? `${prefix} ${cmd}` : cmd;
}

function spawnShell(
  projectPath: string,
  port: number,
  command: string,
): RunningDevServer {
  // terminal/proc are assigned immediately below; the data/exit callbacks that
  // close over `entry` only fire afterwards.
  const entry: RunningDevServer = {
    terminal: undefined as unknown as Bun.Terminal,
    proc: undefined as unknown as Bun.Subprocess,
    port,
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
  if (!entry || entry.exited) return false;
  writeDevTerminal(projectPath, "\x03");
  void killDevServerPort(projectPath);
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
  if (!entry || entry.exited) return;
  const { port } = entry;
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

export async function devServerStatus(
  projectPath: string,
): Promise<DevServerStatus> {
  const entry = running.get(projectPath);
  if (!entry || entry.exited) {
    return { running: false, port: null, url: null, logs: [] };
  }
  if (await isPortUp(entry.port)) {
    return {
      running: true,
      port: entry.port,
      url: `http://localhost:${entry.port}`,
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
