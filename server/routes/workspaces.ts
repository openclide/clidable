/**
 * /api/workspaces — the workspace registry over HTTP.
 *
 *   GET  /api/workspaces          → { workspaces } (most-recently-opened first)
 *   GET  /api/workspaces/get?id=  → WorkspaceFull (404 if unknown)
 *   POST /api/workspaces          → create {projectIds, name?} → WorkspaceFull
 *   PUT  /api/workspaces/save     → persist {id, tree, openProjects, …}
 *   POST /api/workspaces/touch    → bump last_opened {id}
 *   POST /api/workspaces/remove   → forget {id} (+ kill its terminals)
 *
 * Mirrors the projects route style: shallow body validation, errors as
 * `{ ok: false, error }` JSON with a matching status.
 */
import { jsonError as err } from "../http";
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  saveWorkspace,
  touchWorkspace,
} from "../workspaces";
import type {
  CreateWorkspaceRequest,
  ListWorkspacesResponse,
  RemoveWorkspaceRequest,
  SaveWorkspaceRequest,
  TouchWorkspaceRequest,
} from "../../shared/types";

export function workspacesListHandler(_req: Request): Response {
  try {
    const body: ListWorkspacesResponse = { workspaces: listWorkspaces() };
    return Response.json(body);
  } catch (e) {
    return err(500, msg(e), "[workspaces] list failed:");
  }
}

export function workspaceGetHandler(req: Request): Response {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return err(400, "missing 'id' query param");
  try {
    const ws = getWorkspace(id);
    if (!ws) return err(404, `unknown workspace: ${id}`);
    return Response.json(ws);
  } catch (e) {
    return err(500, msg(e), "[workspaces] get failed:");
  }
}

export async function workspaceCreateHandler(req: Request): Promise<Response> {
  let body: CreateWorkspaceRequest;
  try {
    body = (await req.json()) as CreateWorkspaceRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (
    !Array.isArray(body.projectIds) ||
    body.projectIds.length === 0 ||
    !body.projectIds.every((p) => typeof p === "string" && p.length > 0)
  ) {
    return err(400, "missing/invalid 'projectIds'");
  }
  try {
    return Response.json(
      createWorkspace({ projectIds: body.projectIds, name: body.name ?? null }),
    );
  } catch (e) {
    return err(500, msg(e), "[workspaces] create failed:");
  }
}

export async function workspaceSaveHandler(req: Request): Promise<Response> {
  let body: SaveWorkspaceRequest;
  try {
    body = (await req.json()) as SaveWorkspaceRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.id !== "string" || body.id.length === 0) {
    return err(400, "missing 'id'");
  }
  if (!Array.isArray(body.openProjects)) {
    return err(400, "missing/invalid 'openProjects'");
  }
  try {
    saveWorkspace(body.id, {
      name: body.name,
      tree: body.tree,
      openProjects: body.openProjects,
      activeProjectId: body.activeProjectId,
      minimized: body.minimized,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return err(500, msg(e), "[workspaces] save failed:");
  }
}

export async function workspaceTouchHandler(req: Request): Promise<Response> {
  let body: TouchWorkspaceRequest;
  try {
    body = (await req.json()) as TouchWorkspaceRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.id !== "string" || body.id.length === 0) {
    return err(400, "missing 'id'");
  }
  try {
    touchWorkspace(body.id);
    return Response.json({ ok: true });
  } catch (e) {
    return err(500, msg(e), "[workspaces] touch failed:");
  }
}

export async function workspaceRemoveHandler(req: Request): Promise<Response> {
  let body: RemoveWorkspaceRequest;
  try {
    body = (await req.json()) as RemoveWorkspaceRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.id !== "string" || body.id.length === 0) {
    return err(400, "missing 'id'");
  }
  try {
    removeWorkspace(body.id);
    return Response.json({ ok: true });
  } catch (e) {
    return err(500, msg(e), "[workspaces] remove failed:");
  }
}

function msg(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}
