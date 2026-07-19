/**
 * Receiver for agent SessionStart hook reports.
 *
 * Each agent's own hook (installed into ~/.claude, ~/.codex, …) POSTs here over
 * the loopback API to tell us the agent's session id. We stash it on the
 * terminal record so the session can later be resumed (claude --resume <id>, …).
 * The hook is env-gated (CLIDABLE=1 + CLIDABLE_TERMINAL_ID) so it only fires for
 * Clidable-spawned sessions and stays inert during the user's normal agent use.
 *
 * Trust model: /api is loopback-only (guardApiRoutes), and we only write against
 * a terminal id we already know. A per-session token could further bind a report
 * to its terminal — a hardening TODO, not needed while the surface is loopback.
 *
 * Technique is prior art from herdr (AGPL); this is an independent implementation.
 */
import type { TerminalAgentState } from "../../shared/types";
import { jsonError } from "../http";
import { isValidSessionId } from "../pty/agent-resume";
import { setAgentStatus } from "../pty/agent-status";
import { getTerminal, setAgentRef } from "../pty/terminal-store";

interface HookReport {
  terminalId?: unknown;
  agent?: unknown;
  /** Lifecycle state this hook event maps to (working/idle/blocked). */
  state?: unknown;
  sessionId?: unknown;
  /** The agent's raw hook payload, forwarded verbatim by the sh+curl hook
   *  (which has no JSON parser) — we pull session_id out of it here. */
  raw?: unknown;
}

const STATES: readonly TerminalAgentState[] = ["working", "idle", "blocked"];
function asState(v: unknown): TerminalAgentState | null {
  return typeof v === "string" && (STATES as readonly string[]).includes(v)
    ? (v as TerminalAgentState)
    : null;
}

/** First string value found for any of `keys` on a plain object, else null. */
function pick(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    if (typeof rec[k] === "string" && rec[k]) return rec[k] as string;
  }
  return null;
}

export async function agentHookHandler(req: Request): Promise<Response> {
  let body: HookReport;
  try {
    body = (await req.json()) as HookReport;
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const terminalId = typeof body.terminalId === "string" ? body.terminalId : "";
  if (!terminalId) return jsonError(400, "missing 'terminalId'");

  // Only act on a terminal we actually track — an unknown id (e.g. a hook
  // firing for a session Clidable didn't spawn) simply no-ops.
  if (!getTerminal(terminalId)) return Response.json({ ok: true });

  // Capture the agent's session id (for resume) from either a structured
  // top-level `sessionId` or the raw payload (Claude: `session_id`).
  const reported =
    (typeof body.sessionId === "string" ? body.sessionId : null) ??
    pick(body.raw, "session_id", "sessionId", "conversationId", "conversation_id");
  const sessionId = reported && isValidSessionId(reported) ? reported : null;
  if (sessionId) setAgentRef(terminalId, { kind: "id", value: sessionId });

  // Record the live status transition (for the status indicator).
  const state = asState(body.state);
  if (state) setAgentStatus(terminalId, state);

  return Response.json({ ok: true });
}
