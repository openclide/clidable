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
import type { TerminalAgentId } from "../../shared/types";

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
  private exitCode: number | null = null;
  private exitSignal: string | null = null;

  constructor(opts: SessionSpawnOptions) {
    this.id = opts.id;
    this.agent = opts.agent;
    this.projectPath = opts.projectPath;
  }

  static async create(opts: SessionSpawnOptions): Promise<Session> {
    const session = new Session(opts);
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

    this.terminal = new Bun.Terminal({
      cols,
      rows,
      data: (_t, data) => this.onTerminalData(data),
      exit: (_t, code, signal) => this.onTerminalExit(code, signal),
    });

    this.proc = Bun.spawn([binPath, ...spec.args], {
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
      },
      onExit: (_p, code, signalCode) => {
        this.onProcExit(code ?? 0, signalCode != null ? String(signalCode) : null);
      },
    });
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
    for (const s of this.subscribers) s.onExit(code, signal);
    clearTerminal(this.id); // free the detector's rolling buffer
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
    this.proc?.kill();
  }

  isExited(): boolean {
    return this.exited;
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
