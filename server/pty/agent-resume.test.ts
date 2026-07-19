import { describe, expect, it } from "bun:test";
import {
  isValidSessionId,
  isValidSessionPath,
  resumePlan,
  RESUME_SUPPORT,
  type AgentSessionRef,
} from "./agent-resume";

const id = (value: string): AgentSessionRef => ({ kind: "id", value });
const path = (value: string): AgentSessionRef => ({ kind: "path", value });

describe("ref validation", () => {
  it("accepts a normal session id, rejects empty / control chars / overlong", () => {
    expect(isValidSessionId("01HXYZ-abc")).toBe(true);
    expect(isValidSessionId("")).toBe(false);
    expect(isValidSessionId("has\nnewline")).toBe(false);
    expect(isValidSessionId("has\ttab")).toBe(false);
    expect(isValidSessionId("x".repeat(513))).toBe(false);
  });

  it("path validation additionally requires absolute", () => {
    expect(isValidSessionPath("/abs/session.jsonl")).toBe(true);
    expect(isValidSessionPath("relative.jsonl")).toBe(false);
  });
});

describe("resumePlan — verified agents", () => {
  it("claude → claude --resume <id>", () => {
    expect(resumePlan("claude", id("sess-1"))).toEqual(["claude", "--resume", "sess-1"]);
  });

  it("codex → codex --dangerously-bypass-hook-trust resume <id>", () => {
    expect(resumePlan("codex", id("sess-2"))).toEqual([
      "codex",
      "--dangerously-bypass-hook-trust",
      "resume",
      "sess-2",
    ]);
  });

  it("antigravity → agy --conversation <id>", () => {
    expect(resumePlan("antigravity", id("conv-9"))).toEqual(["agy", "--conversation", "conv-9"]);
  });
});

describe("resumePlan — safety & guards", () => {
  it("keeps a hostile id as a single argv element (never shell text)", () => {
    const evil = "abc; rm -rf /";
    expect(resumePlan("codex", id(evil))).toEqual([
      "codex",
      "--dangerously-bypass-hook-trust",
      "resume",
      evil,
    ]);
    expect(resumePlan("claude", id(evil))).toEqual(["claude", "--resume", evil]);
  });

  it("rejects an invalid ref (control chars) → null", () => {
    expect(resumePlan("claude", id("bad\nid"))).toBeNull();
  });

  it("rejects a path ref for an id-only agent → null", () => {
    expect(resumePlan("claude", path("/abs/session"))).toBeNull();
  });

  it("returns null for an agent with no resume mapping", () => {
    expect(resumePlan("qwen", id("x"))).toBeNull();
  });
});

describe("RESUME_SUPPORT confidence", () => {
  it("marks claude/codex verified and copilot from herdr", () => {
    expect(RESUME_SUPPORT.claude).toBe("verified");
    expect(RESUME_SUPPORT.codex).toBe("verified");
    expect(RESUME_SUPPORT.antigravity).toBe("verified");
    expect(RESUME_SUPPORT.copilot).toBe("herdr");
    expect(RESUME_SUPPORT.qwen).toBeUndefined();
  });
});
