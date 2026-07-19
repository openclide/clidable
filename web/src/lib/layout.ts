/**
 * Client helpers for the server-authoritative workspace layout (the pane tree
 * per project). WorkspaceScreen hydrates from `fetchLayout` on mount and
 * persists via `saveLayout` (debounced) on every change, so a reload restores
 * the same terminals/splits instead of a fresh single-terminal layout.
 */
import type { Pane } from "@/components/workspace/paneTree";

/** Load a project's saved pane tree, or null if none / on any error. */
export async function fetchLayout(projectId: string): Promise<Pane | null> {
  try {
    const res = await fetch(`/api/projects/layout?id=${encodeURIComponent(projectId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; tree?: unknown };
    return isPane(data.tree) ? (data.tree as Pane) : null;
  } catch {
    return null;
  }
}

/** Persist a project's pane tree (fire-and-forget; failures are non-fatal). */
export async function saveLayout(projectId: string, tree: Pane): Promise<void> {
  try {
    await fetch("/api/projects/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, tree }),
    });
  } catch {
    // best-effort — a failed save just means the next reload re-seeds
  }
}

/** Minimal structural guard so a corrupt/foreign payload can't crash the tree. */
function isPane(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const kind = (v as { kind?: unknown }).kind;
  return kind === "leaf" || kind === "split";
}
