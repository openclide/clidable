/**
 * GET /api/agents/live — every live PTY session across the whole server, with
 * its current status, for the desktop tray's agent roster + corner-pip.
 *
 * Unlike the frontend's per-window `agent-status` store (which only knows the
 * sessions THIS window subscribed to), this reads the authoritative in-memory
 * SessionManager, so the machine-wide tray reflects agents in every window —
 * even when they're all hidden.
 */
import { sessionManager } from "../pty/manager";
import { acknowledgeDone, getAgentStatus, isAgentDone } from "../pty/agent-status";
import { getSessionLabel } from "../pty/session-label";
import { getAgentSpec } from "../agents";
import type { LiveAgent, LiveAgentsResponse, TrayAgentState } from "../../shared/types";

function displayState(id: string): TrayAgentState {
  if (isAgentDone(id)) return "done"; // finished a turn, not yet re-prompted
  return getAgentStatus(id) ?? "idle"; // no hook status (e.g. plain shell) ⇒ idle
}

export function liveAgentsHandler(): Response {
  const agents: LiveAgent[] = sessionManager
    .list()
    // Only sessions in active use — attached (open in a window) or retained
    // (minimized/backgrounded). Excludes orphans from a closed workspace whose
    // PTYs still linger through the reaper's detach-grace window, so they don't
    // show in the tray as "running".
    .filter((s) => s.inUse)
    .map((s) => ({
      id: s.id,
      agent: s.agent,
      // The user's custom tab name wins; fall back to the agent-type name.
      name: getSessionLabel(s.id) ?? getAgentSpec(s.agent).name,
      state: displayState(s.id),
    }));
  const body: LiveAgentsResponse = { agents };
  return Response.json(body);
}

/**
 * POST /api/agents/ack-done — clear the "done" (finished-a-turn) marks. The
 * desktop tray calls this when the user opens its menu, so the green "done"
 * state drops once they've seen it. No-op on blocked/working state.
 */
export function ackDoneHandler(): Response {
  acknowledgeDone();
  return new Response(null, { status: 204 });
}
