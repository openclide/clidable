/**
 * /api/team — AI Team delegation + roles (PLAN.md §5).
 *
 *   POST /api/team/delegate    → run one agent (foreground answer, or start a job)
 *   GET  /api/team/jobs        → list the project's jobs
 *   GET  /api/team/job         → one job by ref (or the newest)
 *   POST /api/team/cancel      → cancel a running job
 *   GET  /api/team/roles       → the project's roles + assignable agents
 *   POST /api/team/roles       → save the project's roles
 *   POST /api/team/sync        → install enabled roles' skills into the project
 *   POST /api/team/uninstall   → remove one role's skill from the project (delete)
 *
 * Server-mediated: `clidable team …` is a client to this server, which OWNS the
 * delegate process — the basis for background jobs, status, and cancel.
 */
import { jsonError as err } from "../http";
import { runDelegate, DELEGATE_ERROR_STATUS, type DelegateErrorCode } from "../team/run";
import { jobManager } from "../team/jobs";
import { BUILTIN_RECIPES } from "../team/recipes";
import { loadRoles, saveRoles } from "../team/config";
import { coerceRoles, roleSkillState, syncRole, syncRoles, uninstallRole } from "../team/roles";
import type {
  DelegateAgentId,
  DelegateRequest,
  DelegateResponse,
  TeamJobResponse,
  TeamJobsResponse,
  TeamRole,
  TeamRolesResponse,
  TeamSyncResponse,
} from "../../shared/types";

/** Delegate-capable agent ids, for the role handler picker. */
const delegateAgents = (): DelegateAgentId[] => Object.keys(BUILTIN_RECIPES) as DelegateAgentId[];

function isSupportedAgent(v: unknown): v is DelegateAgentId {
  return typeof v === "string" && v in BUILTIN_RECIPES;
}

/** Non-negative integer depth, defensively coerced — a string/negative/NaN
 *  must NOT silently become a value that defeats the fork-bomb guard. */
function coerceDepth(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function errorResponse(e: unknown): Response {
  // Codes come from run.ts's DelegateErrorCode; the shared status map keeps
  // them from drifting (a renamed code would otherwise fall through to 500).
  const code = (e as { code?: DelegateErrorCode })?.code;
  const status = (code && DELEGATE_ERROR_STATUS[code]) ?? 500;
  return err(status, (e as Error)?.message ?? String(e), "[team] failed:");
}

export async function teamDelegateHandler(req: Request): Promise<Response> {
  let body: Partial<DelegateRequest>;
  try {
    body = (await req.json()) as Partial<DelegateRequest>;
  } catch {
    return err(400, "invalid JSON body");
  }

  if (!isSupportedAgent(body.agent)) {
    return err(400, `unsupported delegate agent: ${String(body.agent)}`);
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return err(400, "missing 'prompt'");
  }
  if (typeof body.projectPath !== "string" || !body.projectPath) {
    return err(400, "missing 'projectPath'");
  }
  const input = {
    agent: body.agent,
    prompt: body.prompt,
    projectPath: body.projectPath,
    depth: coerceDepth(body.depth),
    write: body.write === true,
    // Resolved (and refused, if unknown) in prepareDelegate — the one seam both
    // the foreground and background paths pass through.
    role: typeof body.role === "string" && body.role ? body.role : undefined,
  };

  try {
    if (body.background) {
      const job = await jobManager.start(input);
      const res: TeamJobResponse = { ok: true, job: job.toInfo() };
      return Response.json(res);
    }
    const result = await runDelegate(input);
    const res: DelegateResponse = {
      ok: true,
      agent: result.agent,
      answer: result.answer,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };
    return Response.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}

export function teamJobsHandler(req: Request): Response {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("projectPath") ?? undefined;
  const res: TeamJobsResponse = {
    ok: true,
    jobs: jobManager.list(projectPath).map((j) => j.toInfo()),
  };
  return Response.json(res);
}

export function teamJobHandler(req: Request): Response {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");
  const ref = url.searchParams.get("ref") ?? undefined;
  const job = jobManager.find(projectPath, ref);
  if (!job) {
    return err(404, ref ? `no job matching "${ref}"` : "no jobs for this project yet");
  }
  const res: TeamJobResponse = { ok: true, job: job.toInfo() };
  return Response.json(res);
}

export async function teamCancelHandler(req: Request): Promise<Response> {
  let body: { projectPath?: string; ref?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  const job = jobManager.find(body.projectPath, body.ref);
  if (!job) {
    return err(404, body.ref ? `no job matching "${body.ref}"` : "no jobs to cancel");
  }
  if (!job.cancel() && job.isRunning()) {
    return err(500, "failed to cancel job");
  }
  // Let the kill/finalize settle so the returned info reflects the new state.
  await job.done;
  const res: TeamJobResponse = { ok: true, job: job.toInfo() };
  return Response.json(res);
}

/* ---------------------------------- roles --------------------------------- */

/** role id → where its skill is installed, and where that install is outdated —
 *  drives the GUI's per-role install/remove/update diffs. Read once per role:
 *  installed and stale come from the same file read. */
async function skillStateMaps(
  projectPath: string,
  roles: TeamRole[],
): Promise<Pick<TeamRolesResponse, "installed" | "stale">> {
  const entries = await Promise.all(
    roles.map(async (r) => [r.id, await roleSkillState(projectPath, r)] as const),
  );
  return {
    installed: Object.fromEntries(entries.map(([id, s]) => [id, s.installed])),
    stale: Object.fromEntries(entries.map(([id, s]) => [id, s.stale])),
  };
}

export async function teamRolesHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");
  const roles = await loadRoles(projectPath);
  const res: TeamRolesResponse = {
    ok: true,
    roles,
    agents: delegateAgents(),
    ...(await skillStateMaps(projectPath, roles)),
  };
  return Response.json(res);
}

export async function teamRolesSaveHandler(req: Request): Promise<Response> {
  let body: { projectPath?: string; roles?: TeamRole[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (!Array.isArray(body.roles)) return err(400, "missing 'roles' array");
  // Validate before persisting: reject unsafe ids (path traversal), unknown
  // handler agents, and duplicate ids rather than writing a config that would
  // break sync. coerceRoles drops the bad ones; a size mismatch means invalid.
  const roles = coerceRoles(body.roles);
  if (roles.length !== body.roles.length) {
    return err(400, "one or more roles are invalid (bad id, unknown handler agent, or duplicate id)");
  }
  const projectPath = body.projectPath;
  await saveRoles(projectPath, roles);
  const res: TeamRolesResponse = {
    ok: true,
    roles,
    agents: delegateAgents(),
    ...(await skillStateMaps(projectPath, roles)),
  };
  return Response.json(res);
}

export async function teamSyncHandler(req: Request): Promise<Response> {
  let body: { projectPath?: string; roleId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  const projectPath = body.projectPath;
  const roles = await loadRoles(projectPath);
  // A roleId scopes the apply to one role (the leads-picker Apply, like the
  // Skills matrix); otherwise the whole project is reconciled.
  if (body.roleId) {
    const role = roles.find((r) => r.id === body.roleId);
    if (!role) return err(404, `no role "${body.roleId}"`);
    const res: TeamSyncResponse = { ok: true, results: [await syncRole(projectPath, role)] };
    return Response.json(res);
  }
  const res: TeamSyncResponse = { ok: true, results: await syncRoles(projectPath, roles) };
  return Response.json(res);
}

/** Remove a single role's skill from disk. Used when the GUI deletes a role:
 *  per-role Apply can't, since the role is already gone from the config. Scoped
 *  to the id, so it never reconciles (or re-installs) the other roles. */
export async function teamUninstallHandler(req: Request): Promise<Response> {
  let body: { projectPath?: string; roleId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (!body.roleId) return err(400, "missing 'roleId'");
  await uninstallRole(body.projectPath, body.roleId);
  return Response.json({ ok: true });
}
