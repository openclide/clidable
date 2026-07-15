/**
 * Client for /api/team roles (PLAN.md §5). The modal edits roles, persists them
 * to the project's .clidable/ai-team.json (save), and installs the enabled
 * roles' skills into the project (sync).
 */
import { getJson, postJson } from "../../../lib/http";
import type { TeamRole, TeamRolesResponse, TeamSyncResponse } from "@shared/types";

/** The project's roles + the delegate agents available to assign. */
export async function fetchTeamRoles(projectPath: string): Promise<TeamRolesResponse> {
  const qs = new URLSearchParams({ projectPath });
  return getJson<TeamRolesResponse>(`/api/team/roles?${qs}`, "loading team roles failed");
}

/** Persist the project's roles. */
export async function saveTeamRoles(
  projectPath: string,
  roles: TeamRole[],
): Promise<TeamRolesResponse> {
  return postJson<TeamRolesResponse>(
    "/api/team/roles",
    { projectPath, roles },
    "saving team roles failed",
  );
}

/** Apply role skills to the project: one role (`roleId`, like the Skills
 *  matrix's per-skill Apply) or, when omitted, reconcile the whole project. */
export async function syncTeamRoles(
  projectPath: string,
  roleId?: string,
): Promise<TeamSyncResponse> {
  return postJson<TeamSyncResponse>("/api/team/sync", { projectPath, roleId }, "team apply failed");
}

/** Remove a role's skill from the project. Used on delete — the per-role Apply
 *  can't, since the role is already gone from the config. */
export async function uninstallTeamRole(projectPath: string, roleId: string): Promise<void> {
  await postJson<{ ok: true }>(
    "/api/team/uninstall",
    { projectPath, roleId },
    "removing team role failed",
  );
}
