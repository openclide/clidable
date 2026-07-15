/**
 * Cross-pane store for the diff comparison base + a "reveal the
 * Changes panel" intent.
 *
 * The comparison base (HEAD vs a checkpoint SHA) is chosen in two
 * places that live in different corners of the React tree:
 *   • the Changes-panel "Since" picker (right pane)
 *   • the composer's rewind popover (left/terminal pane)
 * and consumed in a third (CodePane's ChangesList + GitDiffPane).
 * A module store is the cleanest single source of truth — same
 * pattern as file-watch-client / checkpoints-client — avoiding a
 * deep prop-drill across the workspace split.
 *
 * Base value semantics, per project path:
 *   undefined → never chosen (callers treat as HEAD; the picker
 *               defaults it to explicit HEAD (null) on mount)
 *   null      → explicitly HEAD (the project's real-git working tree)
 *   object    → a checkpoint: {checkpointId, sha}
 *
 * The reveal intent is fired by the composer's "compare" action to
 * pull the right pane to Code → Changes for a project. It's a
 * transient event (not stored) — consumers act on it synchronously.
 */
import { useEffect, useState } from "react";
import type { Checkpoint } from "@shared/types";

export type DiffBase = { checkpointId: string; sha: string } | null;

/**
 * Resolve a picked checkpoint to a concrete diff base. Noop
 * checkpoints (sha === null) walk back to the nearest prior real
 * snapshot — the list is newest-first, so "prior in time" is later in
 * the array. Returns null when there's no underlying snapshot
 * (fall back to HEAD).
 */
export function resolveBaseFromCheckpoint(
  checkpoint: Checkpoint,
  newestFirst: Checkpoint[],
): DiffBase {
  if (checkpoint.sha) {
    return { checkpointId: checkpoint.id, sha: checkpoint.sha };
  }
  const idx = newestFirst.findIndex((c) => c.id === checkpoint.id);
  if (idx === -1) return null;
  for (let i = idx + 1; i < newestFirst.length; i++) {
    const sha = newestFirst[i]!.sha;
    if (sha) return { checkpointId: checkpoint.id, sha };
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Per-project base store
 * ------------------------------------------------------------------------- */

const bases = new Map<string, DiffBase>();
type BaseListener = (projectPath: string, base: DiffBase) => void;
const baseListeners = new Set<BaseListener>();

/** Returns `undefined` when no base has ever been set for this project. */
export function getDiffBase(projectPath: string): DiffBase | undefined {
  return bases.get(projectPath);
}

export function setDiffBase(projectPath: string, base: DiffBase): void {
  const prev = bases.get(projectPath);
  if (prev !== undefined && sameBase(prev, base)) return;
  bases.set(projectPath, base);
  for (const cb of baseListeners) {
    try {
      cb(projectPath, base);
    } catch (e) {
      console.error("[diff-base] listener threw", e);
    }
  }
}

function sameBase(a: DiffBase, b: DiffBase): boolean {
  if (a === null || b === null) return a === b;
  return a.checkpointId === b.checkpointId && a.sha === b.sha;
}

/** React hook: the current base for a project, re-rendering on change. */
export function useDiffBase(projectPath: string): DiffBase | undefined {
  const [base, setBase] = useState<DiffBase | undefined>(() =>
    bases.get(projectPath),
  );
  useEffect(() => {
    setBase(bases.get(projectPath));
    const listener: BaseListener = (p, b) => {
      if (p === projectPath) setBase(b);
    };
    baseListeners.add(listener);
    return () => {
      baseListeners.delete(listener);
    };
  }, [projectPath]);
  return base;
}

/* ---------------------------------------------------------------------------
 * Reveal intent
 * ------------------------------------------------------------------------- */

type RevealListener = (projectPath: string) => void;
const revealListeners = new Set<RevealListener>();

/** Ask the workspace to surface Code → Changes for this project. */
export function requestRevealChanges(projectPath: string): void {
  for (const cb of revealListeners) {
    try {
      cb(projectPath);
    } catch (e) {
      console.error("[diff-base] reveal listener threw", e);
    }
  }
}

export function subscribeRevealChanges(cb: RevealListener): () => void {
  revealListeners.add(cb);
  return () => revealListeners.delete(cb);
}
