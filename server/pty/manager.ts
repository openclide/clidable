/**
 * Process-wide registry of running PTY sessions.
 *
 * Sessions are keyed by client-chosen id (typically
 * `${projectId}-${agentId}-${nonce}` — see web/src/components/workspace/
 * paneTree.ts → TileTerminal.instanceId). Sessions outlive WebSocket
 * connections — disconnect leaves the PTY running so a refreshing client
 * can resume.
 */
import { Session, type SessionSpawnOptions } from "./session";

class SessionManager {
  private sessions = new Map<string, Session>();
  // Spawns in flight. A second `open` for the same id while the first is
  // still awaiting Session.create must share that spawn — otherwise both
  // pass the sessions.get() check and the loser's PTY leaks outside the map
  // (unreachable by kill() and invisible to the sweep) until server restart.
  private pending = new Map<string, Promise<Session>>();
  // Ids kill()ed while their spawn was in flight — honored on arrival, so a
  // close that races an open still terminates the PTY instead of no-opping.
  private killedWhilePending = new Set<string>();

  // Sessions outlive a WebSocket disconnect so a refreshing client can resume
  // — but only for a grace period. Without this, every closed tab, reloaded
  // page (tabs get fresh instanceIds that never resume), or crashed client
  // leaks its PTY forever, until the process runs out of pseudo-terminals and
  // `new Bun.Terminal()` throws "Failed to open PTY".
  private static readonly REAP_GRACE_MS = 10 * 60_000; // 10 min detached → reap
  private static readonly SWEEP_MS = 60_000; // check once a minute
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  async open(opts: SessionSpawnOptions): Promise<Session> {
    this.ensureSweeping();
    // An open means "want this session alive" — cancel any kill that raced
    // an earlier spawn of this id BEFORE the shared-spawn return below, or
    // the stale tombstone would murder the session this open just requested.
    this.killedWhilePending.delete(opts.id);
    const existing = this.sessions.get(opts.id);
    if (existing && !existing.isExited()) {
      // Re-attach: the new client likely has a different viewport size
      // than the last one. Resize the PTY so the agent gets SIGWINCH and
      // redraws at the right dimensions.
      existing.resize(opts.cols, opts.rows);
      return existing;
    }
    const inFlight = this.pending.get(opts.id);
    if (inFlight) return inFlight;
    if (existing) this.sessions.delete(opts.id);
    const spawn = Session.create(opts)
      .then((session) => {
        if (this.killedWhilePending.delete(opts.id)) {
          // close raced the spawn — honor it now that a process exists.
          session.kill();
          return session;
        }
        this.sessions.set(opts.id, session);
        return session;
      })
      .finally(() => this.pending.delete(opts.id));
    this.pending.set(opts.id, spawn);
    return spawn;
  }

  /** Start the idle-session sweep lazily on first use. Unref'd so it never
   *  keeps the process alive on its own. */
  private ensureSweeping(): void {
    if (this.sweepTimer) return;
    const t = setInterval(() => this.sweep(), SessionManager.SWEEP_MS);
    (t as { unref?: () => void }).unref?.();
    this.sweepTimer = t;
  }

  /** Kill sessions detached longer than the grace period, and drop any that
   *  have already exited. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.isExited()) {
        this.sessions.delete(id);
        continue;
      }
      const detached = s.detachedFor(now);
      if (detached !== null && detached > SessionManager.REAP_GRACE_MS) {
        s.kill();
        this.sessions.delete(id);
      }
    }
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      s.kill();
      this.sessions.delete(id);
      return;
    }
    // Not in the map, but maybe mid-spawn — tombstone so the completing
    // open kills it instead of registering a session nobody wants.
    if (this.pending.has(id)) this.killedWhilePending.add(id);
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  killAll(): void {
    for (const s of this.sessions.values()) s.kill();
    this.sessions.clear();
  }
}

export const sessionManager = new SessionManager();
