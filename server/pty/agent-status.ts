/**
 * Live per-terminal agent status (working / idle / blocked), fed by the agents'
 * own hooks (see agent-hooks.ts → /api/agent-hook). Purely in-memory and
 * ephemeral — it describes what a live session is doing right now, not durable
 * state. terminal-ws subscribes via `onAgentStatus` to broadcast changes to
 * attached clients, and reads `getAgentStatus` to snapshot on (re)attach.
 */
import type { TerminalAgentState } from "../../shared/types";

// `null` state means the terminal's status was cleared (its process exited) —
// listeners fan that out so clients drop the dot, including for retained-only
// (background/minimized) terminals that get no `exit` message.
type Listener = (id: string, state: TerminalAgentState | null) => void;

const current = new Map<string, TerminalAgentState>();
const listeners = new Set<Listener>();

// Terminals that just finished a turn (transitioned working → idle) and haven't
// been re-prompted. Powers the tray's derived "done" state. An entry is dropped
// the moment the agent goes back to work (working/blocked) or its session exits,
// so "done" naturally persists from finish until the user next engages it — no
// separate seen/ack signal needed. (The value is unused today but records *when*
// it finished, in case a time-based fade is wanted later.)
const finishedAt = new Map<string, number>();

/** Record a terminal's state; notifies listeners only when it actually changes. */
export function setAgentStatus(id: string, state: TerminalAgentState): void {
  const prev = current.get(id);
  if (prev === state) return;
  current.set(id, state);
  // A completed turn is specifically working → idle. Any move back into
  // working/blocked clears the "done" mark (the agent is busy again).
  if (state === "idle" && prev === "working") finishedAt.set(id, Date.now());
  else if (state === "working" || state === "blocked") finishedAt.delete(id);
  for (const l of listeners) l(id, state);
}

export function getAgentStatus(id: string): TerminalAgentState | null {
  return current.get(id) ?? null;
}

/** True if this terminal finished a turn and hasn't gone back to work — the
 *  tray renders it as "done" (green) rather than plain idle. */
export function isAgentDone(id: string): boolean {
  return finishedAt.has(id);
}

/** Acknowledge every finished ("done") agent, dropping the green marks so the
 *  tray falls back to plain idle. Called when the user opens the tray menu —
 *  they've seen them. Live working/blocked state is untouched (a blocked agent
 *  is still waiting on you). */
export function acknowledgeDone(): void {
  finishedAt.clear();
}

/** Drop a terminal's status (on exit/close) so the map tracks only live ids;
 *  notifies listeners so attached clients clear the dot. */
export function clearAgentStatus(id: string): void {
  finishedAt.delete(id);
  if (current.delete(id)) {
    for (const l of listeners) l(id, null);
  }
}

/** Subscribe to status changes. Returns an unsubscribe fn. */
export function onAgentStatus(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
