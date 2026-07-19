/**
 * Workspace layout persistence — the server-authoritative pane tree per project,
 * so a reload (and, later, a second client) rehydrates the same terminals/splits
 * instead of re-seeding a fresh single-terminal layout. Keyed by the project id
 * the client sends (its stable `.clidable/project-id` UUID).
 *
 *   GET  /api/projects/layout?id=<projectId>   → { ok, tree }   (tree null if none)
 *   PUT  /api/projects/layout  { id, tree }     → { ok }
 */
import { jsonError } from "../http";
import { loadLayout, saveLayout } from "../pty/terminal-store";

export async function layoutGetHandler(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonError(400, "missing 'id'");
  return Response.json({ ok: true, tree: loadLayout(id) });
}

export async function layoutSaveHandler(req: Request): Promise<Response> {
  let body: { id?: unknown; tree?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; tree?: unknown };
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  if (typeof body.id !== "string" || body.id.length === 0) {
    return jsonError(400, "missing 'id'");
  }
  if (body.tree === undefined) return jsonError(400, "missing 'tree'");
  saveLayout(body.id, body.tree);
  return Response.json({ ok: true });
}
