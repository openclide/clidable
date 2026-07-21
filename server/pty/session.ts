/**
 * One PTY session — holds the Bun.Terminal + subprocess + a ring buffer for
 * replay on reconnect + a fan-out set of subscribers (WebSocket connections).
 *
 * Sessions outlive WebSocket connections. The frontend can reconnect and
 * replay the last N kbytes from the ring buffer.
 */
import type { Subprocess } from "bun";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { detectAgent, getAgentSpec } from "../agents";
import { pathWithClidableBin } from "../cli-shim";
import { clearTerminal, recordOutput } from "../preview/detector";
import { markDormant, setAgentRef, upsertTerminal } from "./terminal-store";
import { hookReportUrl } from "./hook-report";
import { ensureHookInstalled } from "./agent-hooks";
import { clearAgentStatus } from "./agent-status";
import { setSessionLabel } from "./session-label";
import type { TerminalAgentId } from "../../shared/types";

// A resume-launched session (argsOverride set) that dies this fast almost
// certainly failed to resume — a stale/deleted agent ref. Clear the ref so the
// next open spawns a fresh session instead of looping on the same broken resume.
const RESUME_FAILFAST_MS = 6000;

export interface SessionSubscriber {
  /** Called for each chunk emitted while subscribed. */
  onOutput(data: Uint8Array): void;
  /** Called once when the subprocess exits. */
  onExit(code: number, signal: string | null): void;
}

interface RingBuffer {
  chunks: Uint8Array[];
  bytes: number;
}

const RING_BYTES_CAP = 256 * 1024; // 256 KB per session

export interface SessionSpawnOptions {
  id: string;
  agent: TerminalAgentId;
  projectPath: string;
  cols: number;
  rows: number;
}

export class Session {
  readonly id: string;
  readonly agent: TerminalAgentId;
  readonly projectPath: string;
  private terminal: Bun.Terminal | null = null;
  private proc: Subprocess | null = null;
  private subscribers = new Set<SessionSubscriber>();
  // ms timestamp when the last subscriber detached (null while attached).
  // Seeded to "now" because a freshly-created session has no subscribers until
  // the opening WebSocket subscribes a beat later. Drives the manager's
  // idle-session reaper so a closed tab / reloaded page / crashed client
  // doesn't leak the PTY forever.
  private detachedAt: number | null = Date.now();
  // Connections that declared ownership of this session via `retain` (one
  // token per WebSocket). A retained session is exempt from the reaper even
  // with zero subscribers — background tabs and minimized terminals have no
  // output subscriber but must survive past the detach grace period.
  private retainers = new Set<unknown>();
  private ring: RingBuffer = { chunks: [], bytes: 0 };
  private exited = false;
  /** We asked this process to die (close / reap / shutdown), as opposed to it
   *  dying on its own. Without this, a kill within the fail-fast window is
   *  indistinguishable from a resume against a session that never existed. */
  private killed = false;
  /** Set on exit when this was a resume attempt that died fast — i.e. the
   *  stored session ref was stale (the agent had no such conversation). */
  private resumeFailedFast = false;
  private exitCode: number | null = null;
  private exitSignal: string | null = null;
  // Project UUID this session belongs to (null → not persisted). Drives the
  // durable terminal record + disk scrollback; best-effort, never blocks I/O.
  private readonly projectUuid: string | null;
  // When set, launch argv used INSTEAD of the agent's default args — this is how
  // a resume works (e.g. ["--resume", "<id>"] for a session with a known ref).
  private readonly argsOverride: string[] | null;
  // ms timestamp of the spawn, for the resume fail-fast check on exit.
  private spawnedAt = 0;

  constructor(
    opts: SessionSpawnOptions,
    projectUuid: string | null = null,
    argsOverride: string[] | null = null,
  ) {
    this.id = opts.id;
    this.agent = opts.agent;
    this.projectPath = opts.projectPath;
    this.projectUuid = projectUuid;
    this.argsOverride = argsOverride;
  }

  static async create(
    opts: SessionSpawnOptions,
    projectUuid: string | null = null,
    argsOverride: string[] | null = null,
  ): Promise<Session> {
    const session = new Session(opts, projectUuid, argsOverride);
    await session.spawn(opts.cols, opts.rows);
    return session;
  }

  private async spawn(cols: number, rows: number): Promise<void> {
    const spec = getAgentSpec(this.agent);
    const binPath = await detectAgent(this.agent);
    if (!binPath) {
      throw Object.assign(new Error(`Agent "${this.agent}" not installed`), {
        code: "AGENT_NOT_FOUND",
      });
    }
    // Install the agent's session-id hook before it starts, so its very first
    // SessionStart is captured (idempotent, best-effort).
    ensureHookInstalled(this.agent);

    this.terminal = new Bun.Terminal({
      cols,
      rows,
      data: (_t, data) => this.onTerminalData(data),
      exit: (_t, code, signal) => this.onTerminalExit(code, signal),
    });

    this.proc = Bun.spawn([binPath, ...(this.argsOverride ?? spec.args)], {
      terminal: this.terminal,
      cwd: resolveCwd(this.projectPath),
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...spec.env,
        // Make `clidable …` (AI Team delegation) resolve inside this agent's
        // terminal without a global install — prepend our shim dir to PATH.
        PATH: pathWithClidableBin(),
        // Durable-session hooks: the agent's SessionStart hook (once installed
        // into its config) reads these to report its session id back to us for
        // resume. Inert until the hook exists; the hook itself also early-exits
        // when CLIDABLE is unset, so a non-Clidable session never reports.
        CLIDABLE: "1",
        CLIDABLE_TERMINAL_ID: this.id,
        CLIDABLE_REPORT_URL: hookReportUrl(),
      },
      onExit: (_p, code, signalCode) => {
        this.onProcExit(code ?? 0, signalCode != null ? String(signalCode) : null);
      },
    });

    this.spawnedAt = Date.now();
    // Durable record. Best-effort: a persistence failure must never stop the
    // agent from running.
    if (this.projectUuid) {
      try {
        upsertTerminal({
          id: this.id,
          projectUuid: this.projectUuid,
          agentId: this.agent,
          cwd: resolveCwd(this.projectPath),
        });
      } catch {
        // recording is non-critical
      }
    }
  }

  private onTerminalData(data: Uint8Array): void {
    // Copy into our own buffer so the ring buffer can hold long-term refs
    // without depending on the underlying allocation lifetime.
    const copy = new Uint8Array(data);
    this.appendRing(copy);
    for (const s of this.subscribers) s.onOutput(copy);
    // Scan for dev-server banners (M-C). Always-on, bounded work per chunk;
    // results are pushed to any open preview pane via /api/preview-events.
    recordOutput(this.projectPath, this.id, copy);
  }

  private onTerminalExit(_code: number, _signal: string | null): void {
    // PTY EOF — wait for the real subprocess exit before marking exited.
  }

  private onProcExit(code: number, signal: string | null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.exitSignal = signal;
    // A resume that died almost immediately means the ref was stale. A SIGTERM
    // *we* sent looks identical by timing, so `killed` is what separates them —
    // without it, closing a just-resumed terminal in one window would read as a
    // failed resume in every other window still subscribed to it, and they'd
    // each respawn the session the user just closed.
    this.resumeFailedFast =
      this.argsOverride !== null &&
      !this.killed &&
      Date.now() - this.spawnedAt < RESUME_FAILFAST_MS;
    // Settle the durable record BEFORE notifying anyone. A subscriber reacts to
    // this exit by re-opening the id, and that spawn must not be able to read a
    // ref we are about to clear — today it can't only because `open` defers the
    // read behind an awaited stat(), which isn't a guarantee worth resting on.
    if (this.projectUuid) {
      try {
        // Keep the record but mark it dormant — the process is gone, yet the
        // agent can be resumed later (claude --resume …). An explicit user
        // close deletes the record first (manager.kill), so this no-ops there.
        markDormant(this.id, true);
        if (this.resumeFailedFast) setAgentRef(this.id, null);
      } catch {
        // non-critical
      }
    }
    for (const s of this.subscribers) s.onExit(code, signal);
    clearTerminal(this.id); // free the detector's rolling buffer
    clearAgentStatus(this.id); // no live status once the process is gone
    setSessionLabel(this.id, null); // drop any tray name too
    this.terminal?.close();
    this.terminal = null;
    this.proc = null;
  }

  private appendRing(chunk: Uint8Array): void {
    this.ring.chunks.push(chunk);
    this.ring.bytes += chunk.byteLength;
    while (this.ring.bytes > RING_BYTES_CAP && this.ring.chunks.length > 1) {
      const dropped = this.ring.chunks.shift()!;
      this.ring.bytes -= dropped.byteLength;
    }
  }

  /** Concatenated replay bytes (up to RING_BYTES_CAP). */
  getReplay(): Uint8Array {
    if (this.ring.chunks.length === 0) return new Uint8Array(0);
    const out = new Uint8Array(this.ring.bytes);
    let off = 0;
    for (const c of this.ring.chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }

  get replayLength(): number {
    return this.ring.bytes;
  }

  subscribe(sub: SessionSubscriber): void {
    this.subscribers.add(sub);
    this.detachedAt = null; // attached — cancel the reaper countdown
    if (this.exited) {
      sub.onExit(this.exitCode ?? 0, this.exitSignal);
    }
  }

  unsubscribe(sub: SessionSubscriber): void {
    this.subscribers.delete(sub);
    // Last viewer left AND no client retains us — start the idle countdown.
    if (this.subscribers.size === 0 && this.retainers.size === 0) {
      this.detachedAt = Date.now();
    }
  }

  /** Declare ownership without subscribing to output — exempts the session
   *  from the reaper while `token`'s connection lives. Idempotent per token. */
  retain(token: unknown): void {
    this.retainers.add(token);
    this.detachedAt = null;
  }

  release(token: unknown): void {
    this.retainers.delete(token);
    if (this.subscribers.size === 0 && this.retainers.size === 0) {
      this.detachedAt = Date.now();
    }
  }

  /** Milliseconds since the last subscriber/retainer detached, or null if
   *  still attached. Drives the manager's idle-session reaper. */
  detachedFor(now: number): number | null {
    return this.detachedAt === null ? null : now - this.detachedAt;
  }

  /** True while a client is attached (viewing) or retaining (backgrounding)
   *  this session — i.e. it's in active use, not an orphan the reaper is
   *  counting down. The tray lists only in-use sessions so a workspace the user
   *  closed (its PTYs linger through the detach grace) doesn't show as running. */
  get inUse(): boolean {
    return this.detachedAt === null;
  }

  write(data: string | Uint8Array): void {
    if (!this.terminal || this.exited) return;
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.terminal || this.exited) return;
    this.terminal.resize(cols, rows);
    // Bun.Terminal.resize() updates the kernel PTY size but, unlike
    // node-pty, does NOT deliver SIGWINCH to the foreground process —
    // so agents like Claude never learn the terminal resized and don't
    // redraw. Send SIGWINCH manually here. Confirmed via local probe:
    // python signal handler fires on SIGWINCH only when this is sent.
    if (this.proc?.pid) {
      try {
        process.kill(this.proc.pid, "SIGWINCH");
      } catch {
        // Process may have exited between the checks.
      }
    }
  }

  /** Send SIGTERM and let the exit handler clean up. */
  kill(): void {
    if (this.exited) return;
    this.killed = true; // this exit is ours, not the agent failing
    this.proc?.kill();
  }

  isExited(): boolean {
    return this.exited;
  }

  /** True once this session has exited AND it was a resume whose ref turned out
   *  to be stale. The ref has already been cleared, so re-opening this id
   *  spawns a fresh agent rather than re-failing. */
  didResumeFailFast(): boolean {
    return this.resumeFailedFast;
  }

  /** OS pid of the spawned agent process, or null once exited. Used by the
   *  process-mode port scanner (M-D) to scope socket enumeration to this
   *  session's descendant process tree. */
  get pid(): number | null {
    return this.proc?.pid ?? null;
  }
}

/**
 * Resolve the project path to an absolute cwd: expand `~`, resolve
 * relative paths against the server's cwd, and fall back to `$HOME` if
 * the path doesn't exist on disk. The real Project Manager (PLAN.md §7)
 * will eventually feed verified absolute paths and this fallback can
 * go away.
 */
export function resolveCwd(path: string): string {
  const expanded = path.startsWith("~")
    ? resolve(homedir(), path.slice(path.startsWith("~/") ? 2 : 1))
    : resolve(path);
  if (existsSync(expanded)) return expanded;
  return homedir();
}
