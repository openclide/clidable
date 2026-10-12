/**
 * Singleton server daemon lifecycle — the shared contract between the desktop
 * shell (Rust) and the `clidable open`/`stop` CLI verbs.
 *
 * ONE server per machine owns 127.0.0.1:<port>. Whoever launches first spawns
 * it; everyone else health-checks and attaches. The server writes a {pid,port}
 * lockfile on boot (see server/index.ts) so `stop` can find it and a stale lock
 * can be reclaimed. A spawned server is DETACHED so it outlives the launcher —
 * closing an app window (or the launching terminal) never kills it; only an
 * explicit `clidable stop`, or quitting the desktop app that owns it
 * (`stopIfAppOwned`), does.
 */
import { spawn } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { basename } from "node:path";
import { paths } from "../paths";
import type { HealthResponse } from "../../shared/types";

const DEFAULT_PORT = 7878;

/** The port the server binds — env override, else the default. */
export function serverPort(): number {
  const p = Number(process.env.CLIDABLE_PORT ?? DEFAULT_PORT);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}

/**
 * The host to probe for a given bind address. A wildcard bind (`0.0.0.0`,
 * `::`) accepts loopback, and a wildcard is not a connectable address; any
 * other bind is probed as itself — so `--bind ::1` probes `[::1]`, not an IPv4
 * loopback that a v6-only listener never answers.
 */
export function probeHost(bind = "127.0.0.1"): string {
  return bind === "0.0.0.0" || bind === "::" || bind === "" ? "127.0.0.1" : bind;
}

export function healthUrl(port = serverPort(), host = "127.0.0.1"): string {
  // An IPv6 literal must be bracketed in a URL authority.
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${h}:${port}/api/health`;
}

/**
 * Does ANYTHING accept a TCP connection on host:port — Clidable or not?
 *
 * Deliberately protocol-agnostic, and separate from the HTTP probe: it is the
 * only way to tell "nothing is there" (start a server) from "something is
 * there but it isn't us" (refuse) — both of which make the HTTP probe fail.
 */
export function portListening(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 300,
): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ port, host });
    const done = (up: boolean): void => {
      sock.destroy();
      resolve(up);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/**
 * Does this value have the exact shape Clidable's /api/health returns?
 *
 * Every field is checked, because a looser test is what let impostors through:
 * `res.ok` alone accepted an SPA dev server, whose catch-all route answers 200
 * with index.html for ANY path. `shell` is the distinctive field — a generic
 * `{ ok, version }` health endpoint is plausible for an unrelated app, a `shell`
 * of "server" | "tauri-sidecar" is not. Every release since 0.1.1 returns all
 * four (verified against a live 0.1.1 server).
 *
 * The object check comes FIRST so a `null` body is rejected here, not by a
 * TypeError caught somewhere upstream — a shape check that only works because
 * of an outer catch silently stops working the day that catch moves.
 */
export function isHealthResponse(v: unknown): v is HealthResponse {
  if (v === null || typeof v !== "object") return false;
  const h = v as Record<string, unknown>;
  return (
    h.ok === true &&
    typeof h.version === "string" &&
    h.version.length > 0 &&
    typeof h.uptimeMs === "number" &&
    (h.shell === "server" || h.shell === "tauri-sidecar")
  );
}

export interface ProbeOptions {
  host?: string;
  timeoutMs?: number;
  /** Injectable for tests; production callers pass nothing. */
  fetchImpl?: typeof fetch;
}

/**
 * The health of the Clidable on host:port, or null if no Clidable answers there.
 *
 * Only the transport is inside the try: a parse or shape failure is a real
 * "not Clidable" answer, not an exception to swallow.
 */
export async function probeHealth(
  port = serverPort(),
  { host = "127.0.0.1", timeoutMs = 1000, fetchImpl = fetch }: ProbeOptions = {},
): Promise<HealthResponse | null> {
  let res: Response;
  try {
    res = await fetchImpl(healthUrl(port, host), { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null; // refused, unreachable, or timed out
  }
  if (!res.ok) return null;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null; // not JSON — e.g. an SPA's index.html
  }
  return isHealthResponse(body) ? body : null;
}

/** True if a CLIDABLE server answers on the port — not merely anything. */
export async function serverHealthy(
  port = serverPort(),
  timeoutMs = 1000,
): Promise<boolean> {
  return (await probeHealth(port, { timeoutMs })) !== null;
}

/** What is on a port, from the point of view of something that wants to use it. */
export type PortState =
  | { kind: "free" }
  | { kind: "clidable"; health: HealthResponse }
  /** Something accepts connections but is not Clidable: another dev server, a
   *  tunnel, a hung process. Clidable can neither attach to it nor bind past it. */
  | { kind: "foreign" };

export async function probePort(
  port = serverPort(),
  opts: ProbeOptions & { listening?: typeof portListening } = {},
): Promise<PortState> {
  const host = opts.host ?? "127.0.0.1";
  const listening = opts.listening ?? portListening;
  // Health first: one request answers the common case (a Clidable is there).
  const health = await probeHealth(port, opts);
  if (health) return { kind: "clidable", health };
  return (await listening(port, host)) ? { kind: "foreign" } : { kind: "free" };
}

/**
 * Order two `x.y.z[-pre]` versions: negative if `a` is older, positive if newer,
 * 0 if equal. A prerelease sorts before its release (`1.2.3-rc.1` < `1.2.3`).
 *
 * Needed because "different" is not "older": the first attempt at this warned
 * "attaching to the OLDER server" on plain string inequality, so running an old
 * binary against a newer server told the user to kill the NEWER one.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string | null } => {
    const t = v.trim().replace(/^v/, "");
    const dash = t.indexOf("-");
    const core = dash === -1 ? t : t.slice(0, dash);
    const pre = dash === -1 ? null : t.slice(dash + 1);
    const parts = core.split(".").map((n) => Number.parseInt(n, 10));
    return { nums: [0, 1, 2].map((i) => (Number.isFinite(parts[i]) ? parts[i]! : 0)), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i]! < y.nums[i]! ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * How many agents on the server at `port` are mid-task (`working`, or `blocked`
 * on an approval) — the ones a restart would cut off. Idle and finished
 * sessions are NOT counted: a restart resumes their conversation, so they must
 * not stand in the way of a silent upgrade. Null when it can't be determined.
 */
export async function busyAgentCount(
  port = serverPort(),
  { host = "127.0.0.1", timeoutMs = 1000, fetchImpl = fetch }: ProbeOptions = {},
): Promise<number | null> {
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  let body: unknown;
  try {
    const res = await fetchImpl(`http://${h}:${port}/api/agents/live`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const agents = (body as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return null;
  return agents.filter((a) => {
    const state = (a as { state?: unknown } | null)?.state;
    return state === "working" || state === "blocked";
  }).length;
}

/**
 * What a newly started Clidable should do about what it found on its port.
 *
 * Pure, so every rule is testable; the desktop app and the CLI share it and
 * differ only in what they do with an OLDER server — the app may replace it,
 * the CLI only warns (a terminal command shouldn't kill a server on its own).
 */
export type AttachPlan =
  | { action: "start" }
  | { action: "attach"; running: string; relation: "same" | "newer" }
  /** Older, idle and app-owned: safe to replace without asking. The user just
   *  installed a new version and opened it — asking would be a question with
   *  one answer. */
  | { action: "replace"; running: string }
  /** Older, but replacing it could destroy work or override a deliberate
   *  choice, so the user decides. */
  | {
      action: "ask";
      running: string;
      reason: "busy-agents" | "agents-unknown" | "not-app-owned";
      busy?: number;
    }
  | { action: "refuse"; reason: "foreign" };

export function planAttach(input: {
  state: PortState;
  ours: string;
  /** Owner recorded in the lockfile FOR THIS PORT; null if there is none. */
  owner: "app" | "cli" | null;
  /** Mid-task agents on the running server; null if it couldn't be asked. */
  busyAgents: number | null;
}): AttachPlan {
  const { state, ours, owner, busyAgents } = input;
  if (state.kind === "free") return { action: "start" };
  if (state.kind === "foreign") return { action: "refuse", reason: "foreign" };
  const running = state.health.version;
  const cmp = compareVersions(running, ours);
  if (cmp === 0) return { action: "attach", running, relation: "same" };
  if (cmp > 0) return { action: "attach", running, relation: "newer" };
  // The running server is OLDER. Work in flight outranks ownership: it's the
  // one thing a restart destroys outright.
  if (busyAgents === null) return { action: "ask", running, reason: "agents-unknown" };
  if (busyAgents > 0) return { action: "ask", running, reason: "busy-agents", busy: busyAgents };
  // A server the user started themselves may carry deliberate flags — e.g.
  // `--allow-lan` for phone access — that an app-spawned replacement drops.
  if (owner !== "app") return { action: "ask", running, reason: "not-app-owned" };
  return { action: "replace", running };
}

/** How to stop the server that holds the port, in words that will work. An
 *  app-owned server refuses a plain `clidable stop`, so telling its user to run
 *  that is telling them to hit a wall. "Quit the app" can't be relied on either:
 *  this advice is for an OLDER server, and its app may predate quit stopping the
 *  server — or be gone already, since a brew upgrade quits the app and leaves
 *  the server behind. */
export function stopAdvice(owner: "app" | "cli" | null): string {
  return owner === "app"
    ? "Run `clidable stop --force`, then try again."
    : "Run `clidable stop`, then try again.";
}

/**
 * The message and exit code for a CLI process that found its port taken.
 * Attaching to the same or a newer server is success (0); an older server or a
 * foreign process means what was asked for did not happen (1), so scripts and
 * installers can tell.
 */
export function attachOutcome(
  plan: AttachPlan,
  port: number,
  ours: string,
  owner: "app" | "cli" | null,
): { level: "log" | "warn" | "error"; text: string; code: number } {
  switch (plan.action) {
    case "start":
      return { level: "log", text: "", code: 0 };
    case "attach":
      return plan.relation === "same"
        ? {
            level: "log",
            text: `[clidable] port ${port} is already serving Clidable — attaching to it (not starting a second server).`,
            code: 0,
          }
        : {
            level: "log",
            text: `[clidable] port ${port} is serving a newer Clidable (${plan.running}; this is ${ours}) — attaching to it.`,
            code: 0,
          };
    case "replace":
    case "ask":
      return {
        level: "warn",
        text:
          `[clidable] port ${port} is serving an OLDER Clidable (${plan.running}; this is ${ours}).\n` +
          `  You won't see this version's changes until it restarts. ${stopAdvice(owner)}`,
        code: 1,
      };
    case "refuse":
      return {
        level: "error",
        text:
          `[clidable] port ${port} is in use by a program that isn't Clidable.\n` +
          `  Stop that program, or run Clidable on another port: --port <n> or CLIDABLE_PORT=<n>.`,
        code: 1,
      };
  }
}


export interface ServerLock {
  pid: number;
  port: number;
  /** Who spawned this server. "app" = the desktop shell's sidecar — its
   *  windows die with it and nothing respawns it, so `stop` refuses without
   *  --force. Absent on locks written before this field existed → treated as
   *  "cli". */
  owner?: "app" | "cli";
}

export function readLock(file: string = paths.serverLock): ServerLock | null {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as ServerLock;
    if (typeof v.pid === "number" && typeof v.port === "number") return v;
  } catch {
    // missing / malformed → no lock
  }
  return null;
}

/**
 * Who started the server on `port`, from the lockfile — or null when the lock is
 * missing or belongs to a different port (a `--port` server doesn't own the
 * canonical lock, so its record says nothing about this one). A lock written
 * before the owner field existed reads as "cli", matching `stopServer`.
 */
export function lockOwnerFor(
  port: number,
  file: string = paths.serverLock,
): "app" | "cli" | null {
  const lock = readLock(file);
  if (!lock || lock.port !== port) return null;
  return lock.owner ?? "cli";
}

export function writeLock(port: number, file: string = paths.serverLock): void {
  try {
    // "1" is the exact value the Tauri shell sets on its sidecar spawn
    // (src-tauri/src/lib.rs ensure_server) — the only writer of this var.
    const owner = process.env.CLIDABLE_OWNED_BY_APP === "1" ? "app" : "cli";
    writeFileSync(
      file,
      JSON.stringify({ pid: process.pid, port, owner }),
      "utf8",
    );
  } catch {
    // best-effort — a missing lock only costs `stop` its target
  }
}

export function clearLock(file: string = paths.serverLock): void {
  try {
    unlinkSync(file);
  } catch {
    // already gone
  }
}

/**
 * argv that boots a fresh server with THIS process's runtime + entry. In dev the
 * runtime is `bun` and the entry is a script (`Bun.main`); a compiled standalone
 * binary IS the executable and embeds its entry. Mirrors cli-shim's invocation.
 */
export function serverBootArgv(port: number): string[] {
  const exe = process.execPath;
  const isBun = basename(exe).toLowerCase().startsWith("bun");
  const base = isBun ? [exe, Bun.main] : [exe];
  return [...base, "--port", String(port)];
}

/** Spawn a detached server that outlives this process (survives the launcher's
 *  exit and its controlling terminal). Prod mode → no HMR. */
export function spawnDetachedServer(port: number): void {
  const [cmd, ...args] = serverBootArgv(port);
  const child = spawn(cmd!, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production" },
  });
  child.unref();
}

/**
 * Ensure a server is answering on the port: attach if one is already up, else
 * spawn a detached one and poll until it's healthy. Returns false if it never
 * came up.
 */
export async function ensureServerRunning(
  port = serverPort(),
): Promise<boolean> {
  if (await serverHealthy(port)) return true;
  spawnDetachedServer(port);
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(200);
    if (await serverHealthy(port)) return true;
  }
  return false;
}

/** Stop the running server via its lockfile PID. Reclaims a stale lock.
 *
 * Guards against PID reuse: a crash (SIGKILL) leaves a stale lock whose pid the
 * OS may have recycled for an unrelated process, so we only kill when a server
 * is actually answering on the lock's port. If nothing's serving, the server is
 * already gone — clear the stale lock instead of SIGTERM-ing a random pid.
 *
 * Refuses an APP-OWNED server unless forced: the desktop shell's sidecar is
 * the app's entire backend, the app only spawns it at launch, and killing it
 * strands every open window. `stop` in a terminal means "stop the background
 * daemon", so the accident is blocked and the deliberate case is `--force` —
 * the git branch -D pattern. */
export async function stopServer(
  file: string = paths.serverLock,
  opts: { force?: boolean } = {},
): Promise<{
  stopped: boolean;
  pid?: number;
  /** True when a live app-owned server was left running (use --force). */
  refusedAppOwned?: boolean;
}> {
  const lock = readLock(file);
  if (!lock) return { stopped: false };
  if (!(await serverHealthy(lock.port))) {
    clearLock(file); // nothing serving → the pid is dead or recycled; don't kill it
    return { stopped: false, pid: lock.pid };
  }
  if (lock.owner === "app" && !opts.force) {
    return { stopped: false, pid: lock.pid, refusedAppOwned: true };
  }
  try {
    process.kill(lock.pid, "SIGTERM");
    return { stopped: true, pid: lock.pid };
  } catch {
    clearLock(file); // vanished between the health check and the kill
    return { stopped: false, pid: lock.pid };
  }
}

/**
 * What quitting the desktop app does to the server (`__app-quit`, which the app
 * runs as it exits): stop it if the app owns it. A server started from a
 * terminal belongs to that terminal — the app only attached to it — so it keeps
 * running. Judged on the lock for THIS port, so a `--port` server's record can't
 * stop anything here. Forced, because stopServer's app-owned guard protects the
 * app's windows, and those are what's closing.
 */
export async function stopIfAppOwned(
  port: number = serverPort(),
  file: string = paths.serverLock,
): Promise<{ stopped: boolean; pid?: number }> {
  if (lockOwnerFor(port, file) !== "app") return { stopped: false };
  return stopServer(file, { force: true });
}
