/**
 * Agent-native resume — maps a captured agent session ref to the argv that
 * relaunches that exact conversation, so a dormant terminal can be brought
 * back with the agent's own memory intact (`claude --resume <id>`, …).
 *
 * The session ref itself is captured out-of-band from the agent's own
 * SessionStart hook (see the durable-sessions design) — this module only turns
 * a ref into a launch command. Refs are validated and always passed as argv
 * ELEMENTS to Bun.spawn, never interpolated into a shell string, so a hostile
 * or malformed id (`"abc; rm -rf /"`) is inert data.
 *
 * Technique is prior art from herdr (AGPL); this is an independent Bun/TS
 * implementation covering the agents in Clidable's registry.
 */
import type { TerminalAgentId } from "../../shared/types";

export type AgentSessionRefKind = "id" | "path";

export interface AgentSessionRef {
  kind: AgentSessionRefKind;
  value: string;
}

const MAX_REF_LEN = 512;

/** A session id is non-empty, length-capped, and free of control chars. */
export function isValidSessionId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_REF_LEN && !hasControlChar(value);
}

/** A session PATH additionally must be absolute (resume-by-file agents). */
export function isValidSessionPath(value: string): boolean {
  return isValidSessionId(value) && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value));
}

export function isValidRef(ref: AgentSessionRef): boolean {
  return ref.kind === "path" ? isValidSessionPath(ref.value) : isValidSessionId(ref.value);
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Confidence in each agent's resume argv:
 *   • "verified" — probed against the installed CLI in this repo's environment.
 *   • "herdr"    — taken from herdr's shipping resume table; VERIFY against the
 *                  local CLI before treating as trustworthy (flags drift over
 *                  agent releases).
 * `resumePlan` returns argv regardless; callers that want to gate on
 * confidence can read `RESUME_SUPPORT`.
 */
export type ResumeConfidence = "verified" | "herdr";

interface ResumeEntry {
  confidence: ResumeConfidence;
  /** Build argv from a validated ref. Return null if the ref kind is unusable. */
  argv: (ref: AgentSessionRef) => string[] | null;
}

const idOnly =
  (bin: string, flag: string) =>
  (ref: AgentSessionRef): string[] | null =>
    ref.kind === "id" ? [bin, flag, ref.value] : null;

const RESUME: Partial<Record<TerminalAgentId, ResumeEntry>> = {
  // Verified locally (CLI --help probe, 2026-07-19):
  //   claude --resume <id>   (also supports --session-id <uuid> to mint, and -c/--continue)
  claude: { confidence: "verified", argv: idOnly("claude", "--resume") },
  //   codex --dangerously-bypass-hook-trust resume <id>   (subcommand; no mint).
  //   The flag matches the fresh-spawn args (agents.ts) so the resumed session's
  //   hook fires too, keeping the captured ref fresh.
  codex: {
    confidence: "verified",
    argv: (ref) =>
      ref.kind === "id"
        ? ["codex", "--dangerously-bypass-hook-trust", "resume", ref.value]
        : null,
  },

  // From herdr's shipping table — verify against the local CLI before trusting.
  copilot: {
    confidence: "herdr",
    argv: (ref) => (ref.kind === "id" ? ["copilot", `--resume=${ref.value}`] : null),
  },
  cursor: { confidence: "herdr", argv: idOnly("cursor-agent", "--resume") },
  opencode: { confidence: "herdr", argv: idOnly("opencode", "--session") },
  kimi: { confidence: "herdr", argv: idOnly("kimi", "--session") },
  // Verified live (agy 1.1.4): resumes by conversation id, which its own
  // PreInvocation/Stop hooks report as `conversationId`.
  antigravity: { confidence: "verified", argv: idOnly("agy", "--conversation") },

  // Unmapped (no verified resume syntax yet): qwen. Add here once probed.
};

/** Public view of which agents have a resume mapping and how trustworthy it is. */
export const RESUME_SUPPORT: Readonly<Record<string, ResumeConfidence>> =
  Object.fromEntries(
    Object.entries(RESUME).map(([id, e]) => [id, e!.confidence]),
  );

/**
 * Build the argv that resumes `agent` from `ref`, or null when the agent has
 * no resume mapping or the ref is invalid / the wrong kind for this agent.
 */
export function resumePlan(agent: TerminalAgentId, ref: AgentSessionRef): string[] | null {
  const entry = RESUME[agent];
  if (!entry) return null;
  if (!isValidRef(ref)) return null;
  return entry.argv(ref);
}
