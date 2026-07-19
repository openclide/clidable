/**
 * Client-side live agent status, keyed by terminal instanceId. Fed by the
 * terminal WS `status` messages (see TerminalView) and read by any component
 * that shows a status dot via `useAgentStatus(instanceId)`. Purely ephemeral —
 * mirrors what a live session is doing right now (working / idle / blocked).
 */
import { useSyncExternalStore } from "react";
import type { TerminalAgentState } from "@shared/types";

const store = new Map<string, TerminalAgentState>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function setLocalAgentStatus(id: string, state: TerminalAgentState): void {
  if (store.get(id) === state) return;
  store.set(id, state);
  emit();
}

export function clearLocalAgentStatus(id: string): void {
  if (!store.delete(id)) return;
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Subscribe a component to one terminal's live status (null if unknown). */
export function useAgentStatus(id: string): TerminalAgentState | null {
  return useSyncExternalStore(
    subscribe,
    () => store.get(id) ?? null,
    () => null,
  );
}
