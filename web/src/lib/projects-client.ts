/**
 * Client wrapper around `/api/projects` — the project registry.
 *
 * Mirrors checkpoints-client's shape: fetch/parse/error normalization + a
 * tiny pub-sub so every project-list surface (welcome recents, the add-project
 * menu, the agent modal) refreshes the instant a project is opened/removed.
 *
 * The backend `Project` (shared/types) has no notion of "which agent did I
 * last use here" — that's a pure UI affordance — so we keep a `lastAgent`
 * map in localStorage and merge it into the client-side `Project` view.
 */
import { useCallback, useEffect, useState } from "react";
import { getAgent } from "../components/welcome/data";
import type {
  CreateProjectRequest,
  DevServerStatusResponse,
  ListProjectsResponse,
  Project as ApiProject,
  ProjectFramework,
  StartDevServerResponse,
  TerminalAgentId,
} from "@shared/types";

/** Same 8-value union as welcome/data.ts's AgentId — kept in @shared. */
export type ProjectAgentId = TerminalAgentId;

/**
 * Client-side project view. Field names match the old `MockProject` so
 * existing consumers compile unchanged (welcome/data.ts re-exports this as
 * `MockProject`). `lastOpenedAt` maps from the API's `lastOpened`;
 * `lastAgent` is UI-derived.
 */
export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  lastAgent: ProjectAgentId;
  framework: ProjectFramework;
}

/* ---------------------------------------------------------------------------
 * lastAgent persistence (localStorage; id → agent)
 * ------------------------------------------------------------------------- */

const LAST_AGENT_KEY = "clidable:project-last-agent";

function readLastAgentMap(): Record<string, ProjectAgentId> {
  try {
    const raw = localStorage.getItem(LAST_AGENT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ProjectAgentId>) : {};
  } catch {
    return {};
  }
}

export function getLastAgent(id: string): ProjectAgentId {
  const stored = readLastAgentMap()[id];
  // getAgent migrates a renamed id ("gemini" → "antigravity") AND clamps any
  // unknown/corrupted value to claude, so a stale stored id never reaches the
  // server (or a render) as an unknown id that would fail the spawn. Absent →
  // default to claude.
  return stored ? getAgent(stored).id : "claude";
}

export function setLastAgent(id: string, agent: ProjectAgentId): void {
  try {
    const map = readLastAgentMap();
    map[id] = agent;
    localStorage.setItem(LAST_AGENT_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable / over quota — lastAgent is best-effort.
  }
}

function fromApi(p: ApiProject): Project {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    lastOpenedAt: p.lastOpened,
    lastAgent: getLastAgent(p.id),
    framework: p.framework,
  };
}

/* ---------------------------------------------------------------------------
 * pub-sub — fires after any mutation so live lists re-fetch
 * ------------------------------------------------------------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeProjects(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch (e) {
      console.error("[projects-client] listener threw", e);
    }
  }
}

/* ---------------------------------------------------------------------------
 * fetch wrappers
 * ------------------------------------------------------------------------- */

// Dedup concurrent list fetches — multiple useProjects() consumers (welcome
// recents + agent modal, etc.) mount together and reload together on each
// emit; they should share one request rather than each firing their own.
let listInFlight: Promise<Project[]> | null = null;

export function listProjects(): Promise<Project[]> {
  if (listInFlight) return listInFlight;
  listInFlight = (async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw await errFrom(res, "list");
      const { projects } = (await res.json()) as ListProjectsResponse;
      return projects.map(fromApi);
    } finally {
      listInFlight = null;
    }
  })();
  return listInFlight;
}

/** Open/register a folder. Idempotent on the server. Records lastAgent when
 *  an agent is supplied (the welcome/agent-modal flow knows it; the
 *  add-to-workspace flow doesn't and lets it default). */
export async function openProject(
  projectPath: string,
  agent?: ProjectAgentId,
): Promise<Project> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!res.ok) throw await errFrom(res, "open");
  const api = (await res.json()) as ApiProject;
  if (agent) setLastAgent(api.id, agent);
  emit();
  return fromApi(api);
}

/** Scaffold a new project from a template, then register it. Long-running —
 *  the caller should show a spinner. Records lastAgent when supplied. */
export async function createProject(
  req: CreateProjectRequest,
  agent?: ProjectAgentId,
): Promise<Project> {
  const res = await fetch("/api/projects/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw await errFrom(res, "create");
  const api = (await res.json()) as ApiProject;
  if (agent) setLastAgent(api.id, agent);
  emit();
  return fromApi(api);
}

export async function touchProject(
  id: string,
  agent?: ProjectAgentId,
): Promise<void> {
  if (agent) setLastAgent(id, agent);
  const res = await fetch("/api/projects/touch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw await errFrom(res, "touch");
  emit();
}

export async function removeProject(id: string): Promise<void> {
  const res = await fetch("/api/projects/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw await errFrom(res, "remove");
  emit();
}

/* --- own-the-spawn dev server (M-F) --- */

export async function startDevServer(
  projectPath: string,
): Promise<StartDevServerResponse> {
  const res = await fetch("/api/projects/dev-server/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!res.ok) throw await errFrom(res, "dev-server start");
  return (await res.json()) as StartDevServerResponse;
}

export async function stopDevServer(projectPath: string): Promise<void> {
  await fetch("/api/projects/dev-server/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath }),
  }).catch(() => {});
}

export async function getDevServerStatus(
  projectPath: string,
): Promise<DevServerStatusResponse> {
  const res = await fetch(
    `/api/projects/dev-server?projectPath=${encodeURIComponent(projectPath)}`,
  );
  if (!res.ok) throw await errFrom(res, "dev-server status");
  return (await res.json()) as DevServerStatusResponse;
}

async function errFrom(res: Response, what: string): Promise<Error> {
  const parsed = await res.json().catch(() => ({ error: res.statusText }));
  return new Error(
    (parsed as { error?: string }).error ?? `project ${what} failed: ${res.status}`,
  );
}

/* ---------------------------------------------------------------------------
 * useProjects — the live list, shared by every project-list surface
 * ------------------------------------------------------------------------- */

export interface UseProjects {
  projects: Project[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useProjects(): UseProjects {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listProjects()
      .then((ps) => {
        setProjects(ps);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    return subscribeProjects(reload);
  }, [reload]);

  return { projects, loading, error, reload };
}
