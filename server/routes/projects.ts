/**
 * /api/projects — the project registry over HTTP.
 *
 *   GET  /api/projects          → { projects } (most-recently-opened first)
 *   POST /api/projects          → open/register {projectPath} → Project
 *   POST /api/projects/touch    → bump last_opened {id}
 *   POST /api/projects/remove   → forget {id} (registry only)
 *
 * Mirrors the checkpoints route style: shallow body validation, errors as
 * `{ ok: false, error }` JSON with a matching status.
 */
import { jsonError as err } from "../http";
import {
  listProjects,
  openProject,
  removeProject,
  touchProject,
} from "../projects";
import { scaffoldProject } from "../projects/scaffold";
import { detectProject } from "../projects/detect";
import {
  devServerStatus,
  startDevServer,
  stopDevServer,
} from "../projects/dev-server";
import {
  detectLaunchPlan,
  readLaunchConfig,
  writeLaunchConfig,
} from "../projects/launch-config";
import { PROJECT_TEMPLATES } from "../../shared/types";
import type {
  CreateProjectRequest,
  DevServerRequest,
  LaunchConfig,
  LaunchConfigResponse,
  ListProjectsResponse,
  OpenProjectRequest,
  ProjectTemplateId,
  RemoveProjectRequest,
  SaveLaunchConfigRequest,
  TouchProjectRequest,
} from "../../shared/types";

// Derived from the catalog so the template list lives in exactly one place.
const TEMPLATE_IDS: ReadonlySet<ProjectTemplateId> = new Set(
  PROJECT_TEMPLATES.map((t) => t.id),
);

export function projectsListHandler(_req: Request): Response {
  try {
    const body: ListProjectsResponse = { projects: listProjects() };
    return Response.json(body);
  } catch (e) {
    return err(500, msg(e), "[projects] list failed:");
  }
}

export async function projectsOpenHandler(req: Request): Promise<Response> {
  let body: OpenProjectRequest;
  try {
    body = (await req.json()) as OpenProjectRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.projectPath !== "string" || body.projectPath.length === 0) {
    return err(400, "missing 'projectPath'");
  }
  try {
    return Response.json(await openProject(body.projectPath));
  } catch (e) {
    return err(500, msg(e), "[projects] open failed:");
  }
}

/**
 * POST /api/projects/create — scaffold a new project from a template, then
 * register it. Long-running (npm installs), so the client shows a spinner;
 * success returns the created Project, ready to open.
 */
export async function projectCreateHandler(req: Request): Promise<Response> {
  let body: CreateProjectRequest;
  try {
    body = (await req.json()) as CreateProjectRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.parentDir !== "string" || body.parentDir.length === 0) {
    return err(400, "missing 'parentDir'");
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return err(400, "missing 'name'");
  }
  if (!TEMPLATE_IDS.has(body.template)) {
    return err(400, `unknown template: ${String(body.template)}`);
  }
  try {
    const project = await scaffoldProject({
      parentDir: body.parentDir,
      name: body.name,
      template: body.template,
    });
    return Response.json(project);
  } catch (e) {
    return err(500, msg(e), "[projects] create failed:");
  }
}

export async function projectTouchHandler(req: Request): Promise<Response> {
  let body: TouchProjectRequest;
  try {
    body = (await req.json()) as TouchProjectRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.id !== "string" || body.id.length === 0) {
    return err(400, "missing 'id'");
  }
  try {
    touchProject(body.id);
    return Response.json({ ok: true });
  } catch (e) {
    return err(500, msg(e), "[projects] touch failed:");
  }
}

export async function projectRemoveHandler(req: Request): Promise<Response> {
  let body: RemoveProjectRequest;
  try {
    body = (await req.json()) as RemoveProjectRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.id !== "string" || body.id.length === 0) {
    return err(400, "missing 'id'");
  }
  try {
    removeProject(body.id);
    return Response.json({ ok: true });
  } catch (e) {
    return err(500, msg(e), "[projects] remove failed:");
  }
}

/* --- dev server (M-F) --- */

export async function projectDevStartHandler(req: Request): Promise<Response> {
  let body: DevServerRequest;
  try {
    body = (await req.json()) as DevServerRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.projectPath !== "string" || body.projectPath.length === 0) {
    return err(400, "missing 'projectPath'");
  }
  try {
    const { framework } = await detectProject(body.projectPath);
    const res = await startDevServer(body.projectPath, framework);
    return Response.json(res);
  } catch (e) {
    return err(500, msg(e), "[projects] dev-server start failed:");
  }
}

export async function projectDevStopHandler(req: Request): Promise<Response> {
  let body: DevServerRequest;
  try {
    body = (await req.json()) as DevServerRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.projectPath !== "string" || body.projectPath.length === 0) {
    return err(400, "missing 'projectPath'");
  }
  return Response.json({ ok: await stopDevServer(body.projectPath) });
}

export async function projectDevStatusHandler(req: Request): Promise<Response> {
  const projectPath = new URL(req.url).searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");
  // Framework detection lives inside devServerStatus, which only pays for it
  // when it actually needs `launchable` (i.e. when nothing is running).
  return Response.json(await devServerStatus(projectPath));
}

/* --- per-project launch config (.clidable/launch.json) --- */

export async function projectLaunchConfigGetHandler(
  req: Request,
): Promise<Response> {
  const projectPath = new URL(req.url).searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");
  try {
    const [config, { framework }] = await Promise.all([
      readLaunchConfig(projectPath),
      detectProject(projectPath),
    ]);
    const detected = await detectLaunchPlan(projectPath, framework);
    const body: LaunchConfigResponse = { config, detected };
    return Response.json(body);
  } catch (e) {
    return err(500, msg(e), "[projects] launch-config read failed:");
  }
}

export async function projectLaunchConfigSaveHandler(
  req: Request,
): Promise<Response> {
  let body: SaveLaunchConfigRequest;
  try {
    body = (await req.json()) as SaveLaunchConfigRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (typeof body.projectPath !== "string" || body.projectPath.length === 0) {
    return err(400, "missing 'projectPath'");
  }
  if (!body.config || typeof body.config !== "object") {
    return err(400, "missing 'config'");
  }
  try {
    await writeLaunchConfig(body.projectPath, body.config as LaunchConfig);
    return Response.json({ ok: true });
  } catch (e) {
    return err(500, msg(e), "[projects] launch-config save failed:");
  }
}

function msg(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}
