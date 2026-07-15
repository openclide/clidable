/**
 * POST /api/checkpoints — create a snapshot of the working tree.
 *
 * Called by the composer right before each Send. The body carries
 * everything we need to attribute the snapshot:
 *   {projectPath, agentId, terminalId, message}
 *
 * Success → 200 with the created Checkpoint. The composer reads the
 * SHA to flash the ✓ chip. Failure → JSON error body, the composer
 * shows an error chip but still writes to the PTY (the user's intent
 * is to send the message; checkpoint failures shouldn't eat keystrokes).
 *
 * Body validation is shallow on purpose. M1's createCheckpoint already
 * handles bad projectPath via filesystem errors; we surface those as
 * 500 with the message so the client can render a useful tooltip.
 */
import { jsonError as err } from "../http";
import {
  createCheckpoint,
  listCheckpoints,
  resolveScreenshotPath,
  restoreCheckpoint,
} from "../checkpoints";
import type {
  Checkpoint,
  CreateCheckpointRequest,
  ListCheckpointsResponse,
  RestoreCheckpointRequest,
  RestoreCheckpointResponse,
} from "../../shared/types";

export async function checkpointsCreateHandler(
  req: Request,
): Promise<Response> {
  let body: CreateCheckpointRequest;
  try {
    body = (await req.json()) as CreateCheckpointRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  const { projectPath, agentId, terminalId, message, screenshot } = body;
  if (typeof projectPath !== "string" || projectPath.length === 0) {
    return err(400, "missing 'projectPath'");
  }
  if (typeof agentId !== "string" || agentId.length === 0) {
    return err(400, "missing 'agentId'");
  }
  if (typeof terminalId !== "string" || terminalId.length === 0) {
    return err(400, "missing 'terminalId'");
  }
  if (typeof message !== "string") {
    return err(400, "missing 'message'");
  }

  try {
    const checkpoint: Checkpoint = await createCheckpoint({
      projectPath,
      agentId,
      terminalId,
      message,
      screenshot: typeof screenshot === "string" ? screenshot : undefined,
    });
    return Response.json(checkpoint);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("[checkpoints] create failed:", msg);
    return err(500, msg);
  }
}

/**
 * GET /api/checkpoints?projectPath=...&terminalId=...&limit=...
 *
 * Returns recent checkpoints for the project, newest-first.
 * `terminalId` filters to a single PTY session (used by the composer
 * popover's "this terminal" scope); omit for project-wide (used by
 * the Changes panel's "Since" picker).
 *
 * `limit` defaults to 100 — matches the retention policy, so we never
 * hand back more than that anyway.
 */
export async function checkpointsListHandler(
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");

  const terminalId = url.searchParams.get("terminalId") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw !== null ? Number(limitRaw) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    return err(400, "'limit' must be a positive integer");
  }

  try {
    const checkpoints = await listCheckpoints(projectPath, {
      terminalId,
      limit,
    });
    const body: ListCheckpointsResponse = { checkpoints };
    return Response.json(body);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("[checkpoints] list failed:", msg);
    return err(500, msg);
  }
}

/**
 * POST /api/checkpoints/restore — rewind working tree to a checkpoint.
 *
 * Per Q9 (restore UX), this is a "files only" restore: we update the
 * working tree to the snapshot's state, but don't touch the agent's
 * own TUI conversation history (we can't — that lives inside the
 * agent). Open editor buffers handle reload separately via the
 * checkpoint-restore client-side event.
 */
export async function checkpointsRestoreHandler(
  req: Request,
): Promise<Response> {
  let body: RestoreCheckpointRequest;
  try {
    body = (await req.json()) as RestoreCheckpointRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  const { projectPath, checkpointId } = body;
  if (typeof projectPath !== "string" || projectPath.length === 0) {
    return err(400, "missing 'projectPath'");
  }
  if (typeof checkpointId !== "string" || checkpointId.length === 0) {
    return err(400, "missing 'checkpointId'");
  }

  try {
    const result = await restoreCheckpoint({ projectPath, checkpointId });
    const response: RestoreCheckpointResponse = {
      ok: true,
      sha: result.sha,
      resolvedFromCheckpointId: result.resolvedFromCheckpointId,
    };
    return Response.json(response);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("[checkpoints] restore failed:", msg);
    return err(500, msg);
  }
}

/**
 * GET /api/checkpoints/screenshot?id=<checkpointId> — serve a
 * checkpoint's preview PNG. Keyed on the checkpoint id (the row carries
 * the project uuid + filename), so the client never needs the project
 * path in the URL. 404s when the checkpoint has no screenshot.
 */
export async function checkpointScreenshotHandler(
  req: Request,
): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return err(400, "missing 'id' query param");

  const path = resolveScreenshotPath(id);
  if (!path) return new Response("Not found", { status: 404 });

  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, {
    headers: {
      "Content-Type": "image/png",
      // Screenshots are immutable per checkpoint id — cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
