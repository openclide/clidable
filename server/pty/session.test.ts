/**
 * Unit tests for Session retention bookkeeping.
 *
 * `new Session(opts)` does NOT spawn a PTY (only the static `create` does),
 * so the reaper/retention state machine can be tested directly.
 *
 * Run with `bun test`.
 */
import { describe, expect, it } from "bun:test";
import { Session, type SessionSubscriber } from "./session";

function makeSession(id = "s1"): Session {
  return new Session({
    id,
    agent: "claude",
    projectPath: "/tmp",
    cols: 80,
    rows: 24,
  });
}

function sub(): SessionSubscriber {
  return { onOutput: () => {}, onExit: () => {} };
}

describe("Session retention", () => {
  it("starts detached (reaper countdown armed) until someone attaches", () => {
    const s = makeSession();
    expect(s.detachedFor(Date.now() + 1000)).not.toBeNull();
  });

  it("subscribe cancels the countdown; last unsubscribe restarts it", () => {
    const s = makeSession();
    const a = sub();
    s.subscribe(a);
    expect(s.detachedFor(Date.now())).toBeNull();
    s.unsubscribe(a);
    expect(s.detachedFor(Date.now())).not.toBeNull();
  });

  it("retain exempts a session with zero subscribers from the reaper", () => {
    const s = makeSession();
    s.retain("conn-1");
    expect(s.detachedFor(Date.now())).toBeNull();
  });

  it("releasing the last retainer restarts the countdown", () => {
    const s = makeSession();
    s.retain("conn-1");
    s.retain("conn-2");
    s.release("conn-1");
    expect(s.detachedFor(Date.now())).toBeNull();
    s.release("conn-2");
    expect(s.detachedFor(Date.now())).not.toBeNull();
  });

  it("stays attached while EITHER a subscriber or a retainer remains", () => {
    const s = makeSession();
    const a = sub();
    s.subscribe(a);
    s.retain("conn-1");
    // Viewer leaves but the client still retains (e.g. tab minimized).
    s.unsubscribe(a);
    expect(s.detachedFor(Date.now())).toBeNull();
    // Retention dropped while a viewer is back — still attached.
    s.subscribe(a);
    s.release("conn-1");
    expect(s.detachedFor(Date.now())).toBeNull();
  });

  it("retain is idempotent per token", () => {
    const s = makeSession();
    s.retain("conn-1");
    s.retain("conn-1");
    s.release("conn-1");
    expect(s.detachedFor(Date.now())).not.toBeNull();
  });
});
