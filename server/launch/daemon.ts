/**
 * Singleton server daemon lifecycle — the shared contract between the desktop
 * shell (Rust) and the `clidable open`/`stop` CLI verbs.
 *
 * ONE server per machine owns 127.0.0.1:<port>. Whoever launches first spawns
 * it; everyone else health-checks and attaches. The server writes a {pid,port}
 * lockfile on boot (see server/index.ts) so `stop` can find it and a stale lock
 * can be reclaimed. A spawned server is DETACHED so it outlives the launcher —
 * closing the app (or the launching terminal) never kills it; only an explicit
 * `clidable stop` (or the desktop tray's Quit) does.
 */
import { spawn } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { paths } from "../paths";

const DEFAULT_PORT = 7878;

/** The port the server binds — env override, else the default. */
export function serverPort(): number {
  const p = Number(process.env.CLIDABLE_PORT ?? DEFAULT_PORT);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}

export function healthUrl(port = serverPort()): string {
  return `http://127.0.0.1:${port}/api/health`;
}

/** True if a Clidable server answers /api/health on the port. */
export async function serverHealthy(
  port = serverPort(),
  timeoutMs = 1000,
): Promise<boolean> {
  try {
    const res = await fetch(healthUrl(port), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ServerLock {
  pid: number;
  port: number;
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

export function writeLock(port: number, file: string = paths.serverLock): void {
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, port }), "utf8");
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
 * already gone — clear the stale lock instead of SIGTERM-ing a random pid. */
export async function stopServer(file: string = paths.serverLock): Promise<{
  stopped: boolean;
  pid?: number;
}> {
  const lock = readLock(file);
  if (!lock) return { stopped: false };
  if (!(await serverHealthy(lock.port))) {
    clearLock(file); // nothing serving → the pid is dead or recycled; don't kill it
    return { stopped: false, pid: lock.pid };
  }
  try {
    process.kill(lock.pid, "SIGTERM");
    return { stopped: true, pid: lock.pid };
  } catch {
    clearLock(file); // vanished between the health check and the kill
    return { stopped: false, pid: lock.pid };
  }
}
