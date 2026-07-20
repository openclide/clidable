/**
 * Client wrapper around `/api/workspaces` — the workspace registry.
 *
 * A workspace is the persisted unit of work: its ordered open projects, the
 * pane tree, the minimized-terminals dock, and the active project. Mirrors
 * projects-client's shape (fetch/parse/error + a pub-sub so every workspace-list
 * surface refreshes on mutation).
 *
 * The wire payload embeds `Project` (shared/types); we run each through
 * projects-client's `fromApi` so consumers get the client `Project` view (with
 * the UI-only `lastAgent`). Client-side `Workspace`/`WorkspaceFull` therefore
 * use the client `Project`, not the wire one.
 */
import { useCallback, useEffect, useState } from "react";
import { type Project, fromApi } from "./projects-client";
import type {
  CreateWorkspaceRequest,
  ListWorkspacesResponse,
  WorkspaceFull as ApiWorkspaceFull,
  WorkspaceSummary as ApiWorkspaceSummary,
} from "@shared/types";

/** A workspace summary for the home list — projects hydrated to the client view. */
export interface Workspace {
  id: string;
  name: string | null;
  projects: Project[];
  createdAt: number;
  lastOpened: number;
}

/** Full workspace state, restored into WorkspaceScreen. `tree`/`minimized` are
 *  the opaque client-owned blobs (Pane / MinimizedTerminal[]) round-tripped
 *  through the server. */
export interface WorkspaceFull extends Workspace {
  openProjects: string[];
  activeProjectId: string | null;
  tree: unknown | null;
  minimized: unknown | null;
}

function summaryFromApi(w: ApiWorkspaceSummary): Workspace {
  return {
    id: w.id,
    name: w.name,
    projects: w.projects.map(fromApi),
    createdAt: w.createdAt,
    lastOpened: w.lastOpened,
  };
}

function fullFromApi(w: ApiWorkspaceFull): WorkspaceFull {
  return {
    ...summaryFromApi(w),
    openProjects: w.openProjects,
    activeProjectId: w.activeProjectId,
    tree: w.tree,
    minimized: w.minimized,
  };
}

/* ---------------------------------------------------------------------------
 * pub-sub — fires after any mutation so live lists re-fetch
 * ------------------------------------------------------------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeWorkspaces(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(): void {
  // A mutation just changed the list — drop any in-flight list promise so the
  // reload it triggers fetches fresh state instead of reusing a pre-mutation
  // snapshot (the dedup below would otherwise hand back the stale in-flight list).
  listInFlight = null;
  for (const cb of listeners) {
    try {
      cb();
    } catch (e) {
      console.error("[workspaces-client] listener threw", e);
    }
  }
}

/* ---------------------------------------------------------------------------
 * fetch wrappers
 * ------------------------------------------------------------------------- */

let listInFlight: Promise<Workspace[]> | null = null;

export function listWorkspaces(): Promise<Workspace[]> {
  if (listInFlight) return listInFlight;
  listInFlight = (async () => {
    try {
      const res = await fetch("/api/workspaces");
      if (!res.ok) throw await errFrom(res, "list");
      const { workspaces } = (await res.json()) as ListWorkspacesResponse;
      return workspaces.map(summaryFromApi);
    } finally {
      listInFlight = null;
    }
  })();
  return listInFlight;
}

/** Load a workspace's full state, or null if it's gone / unopenable. */
export async function getWorkspace(id: string): Promise<WorkspaceFull | null> {
  const res = await fetch(`/api/workspaces/get?id=${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await errFrom(res, "get");
  return fullFromApi((await res.json()) as ApiWorkspaceFull);
}

/** Create a fresh workspace for the given project(s). The client seeds the
 *  first terminal on mount; tree/minimized start null server-side. */
export async function createWorkspace(
  req: CreateWorkspaceRequest,
): Promise<WorkspaceFull> {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw await errFrom(res, "create");
  const full = fullFromApi((await res.json()) as ApiWorkspaceFull);
  emit();
  return full;
}

export interface WorkspaceState {
  tree: unknown;
  openProjects: string[];
  activeProjectId: string | null;
  minimized: unknown;
  name?: string | null;
}

/** Persist a workspace's live state. Fire-and-forget from the caller's view —
 *  failures are non-fatal (the next reload just re-hydrates the last good save).
 *
 *  Default is a PLAIN fetch: "Back" is an in-app view change (not a page unload),
 *  so it completes normally even from an unmount cleanup, with no body-size cap.
 *  Pass `keepalive` ONLY for a real page teardown (pagehide: tab/window close,
 *  reload) where a plain fetch would be cancelled — at the cost of the browser's
 *  ~64KB keepalive body cap, so a huge snapshot may drop (best-effort, rare). */
export async function saveWorkspace(
  id: string,
  state: WorkspaceState,
  opts?: { keepalive?: boolean },
): Promise<void> {
  await fetch("/api/workspaces/save", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...state }),
    keepalive: opts?.keepalive,
  }).catch(() => {
    // best-effort — a dropped save just means the next reload re-seeds/re-hydrates
  });
}

export async function touchWorkspace(id: string): Promise<void> {
  await fetch("/api/workspaces/touch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  emit();
}

export async function removeWorkspace(id: string): Promise<void> {
  const res = await fetch("/api/workspaces/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw await errFrom(res, "remove");
  emit();
}

async function errFrom(res: Response, what: string): Promise<Error> {
  const parsed = await res.json().catch(() => ({ error: res.statusText }));
  return new Error(
    (parsed as { error?: string }).error ?? `workspace ${what} failed: ${res.status}`,
  );
}

/* ---------------------------------------------------------------------------
 * useWorkspaces — the live list, shared by every workspace-list surface
 * ------------------------------------------------------------------------- */

export interface UseWorkspaces {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useWorkspaces(): UseWorkspaces {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listWorkspaces()
      .then((ws) => {
        setWorkspaces(ws);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    return subscribeWorkspaces(reload);
  }, [reload]);

  return { workspaces, loading, error, reload };
}
