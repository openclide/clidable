import { describe, expect, it } from "bun:test";
import {
  acknowledgeDone,
  clearAgentStatus,
  getAgentStatus,
  isAgentDone,
  onAgentStatus,
  setAgentStatus,
} from "./agent-status";

describe("agent status store", () => {
  it("records and reads a terminal's state", () => {
    setAgentStatus("t-read", "working");
    expect(getAgentStatus("t-read")).toBe("working");
    expect(getAgentStatus("t-unknown")).toBeNull();
    clearAgentStatus("t-read");
  });

  it("notifies listeners only on an actual change (dedups repeats)", () => {
    const seen: Array<[string, string | null]> = [];
    const off = onAgentStatus((id, s) => seen.push([id, s]));
    setAgentStatus("t-dedup", "working");
    setAgentStatus("t-dedup", "working"); // no change → no notify
    setAgentStatus("t-dedup", "idle");
    clearAgentStatus("t-dedup"); // clear notifies with null (drops the dot)
    clearAgentStatus("t-dedup"); // already gone → no second notify
    off();
    setAgentStatus("t-dedup", "blocked"); // after unsubscribe → not seen
    expect(seen).toEqual([
      ["t-dedup", "working"],
      ["t-dedup", "idle"],
      ["t-dedup", null],
    ]);
  });

  it("clear drops the entry", () => {
    setAgentStatus("t-clear", "blocked");
    clearAgentStatus("t-clear");
    expect(getAgentStatus("t-clear")).toBeNull();
  });

  describe("done (finished-a-turn) derivation", () => {
    it("marks done only on working → idle, and holds until re-engaged", () => {
      setAgentStatus("t-done", "working");
      expect(isAgentDone("t-done")).toBe(false);
      setAgentStatus("t-done", "idle"); // finished a turn
      expect(isAgentDone("t-done")).toBe(true);
      setAgentStatus("t-done", "working"); // re-prompted → back to work
      expect(isAgentDone("t-done")).toBe(false);
      clearAgentStatus("t-done");
    });

    it("a fresh idle (never worked) is not done", () => {
      setAgentStatus("t-fresh", "idle"); // e.g. SessionStart, no prior work
      expect(isAgentDone("t-fresh")).toBe(false);
      clearAgentStatus("t-fresh");
    });

    it("blocked → idle is not a completed turn", () => {
      setAgentStatus("t-blk", "working");
      setAgentStatus("t-blk", "blocked"); // clears any pending done
      setAgentStatus("t-blk", "idle"); // not working → idle, so not done
      expect(isAgentDone("t-blk")).toBe(false);
      clearAgentStatus("t-blk");
    });

    it("clear drops the done mark too", () => {
      setAgentStatus("t-done2", "working");
      setAgentStatus("t-done2", "idle");
      expect(isAgentDone("t-done2")).toBe(true);
      clearAgentStatus("t-done2");
      expect(isAgentDone("t-done2")).toBe(false);
    });

    it("acknowledgeDone clears done marks but leaves live state intact", () => {
      setAgentStatus("t-ackd", "working");
      setAgentStatus("t-ackd", "idle"); // done
      setAgentStatus("t-live", "blocked"); // still waiting on the user
      expect(isAgentDone("t-ackd")).toBe(true);
      acknowledgeDone();
      expect(isAgentDone("t-ackd")).toBe(false); // green cleared
      expect(getAgentStatus("t-ackd")).toBe("idle"); // underlying state kept
      expect(getAgentStatus("t-live")).toBe("blocked"); // untouched
      clearAgentStatus("t-ackd");
      clearAgentStatus("t-live");
    });
  });
});
