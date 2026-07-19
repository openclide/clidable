import { describe, expect, it } from "bun:test";
import { clearAgentStatus, getAgentStatus, onAgentStatus, setAgentStatus } from "./agent-status";

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
});
