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

/** Record a terminal's state; notifies listeners only when it actually changes. */
export function setAgentStatus(id: string, state: TerminalAgentState): void {
  if (current.get(id) === state) return;
  current.set(id, state);
  for (const l of listeners) l(id, state);
}

export function getAgentStatus(id: string): TerminalAgentState | null {
  return current.get(id) ?? null;
}

/** Drop a terminal's status (on exit/close) so the map tracks only live ids;
 *  notifies listeners so attached clients clear the dot. */
export function clearAgentStatus(id: string): void {
  if (current.delete(id)) {
    for (const l of listeners) l(id, null);
  }
}

/** Subscribe to status changes. Returns an unsubscribe fn. */
export function onAgentStatus(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
