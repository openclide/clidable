/**
 * AI Team per-project config (PLAN.md §5) — `<project>/.clidable/ai-team.json`.
 *
 * Holds the project's roles. Until the user saves once, there's no file and we
 * fall back to the built-in seed library, so a fresh project already has a
 * sensible team. The GUI reads via loadRoles, edits, and writes via saveRoles.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJson } from "../util/fs";
import { BUILTIN_ROLES, coerceRoles, mergeWithBuiltins } from "./roles";
import type { TeamRole } from "../../shared/types";

const CONFIG_REL = ".clidable/ai-team.json";

interface TeamConfig {
  roles?: unknown;
}

const configPath = (projectPath: string): string => join(projectPath, CONFIG_REL);

/** The project's roles: the built-in library (curated text always current),
 *  with the user's saved choices (enabled / handler / leads) merged in and any
 *  custom roles appended. A missing config → the plain built-in seed. The roles
 *  are validated on load so a malformed/hand-edited file can't break render/sync. */
export async function loadRoles(projectPath: string): Promise<TeamRole[]> {
  const cfg = await readJson<TeamConfig>(configPath(projectPath));
  return Array.isArray(cfg?.roles) ? mergeWithBuiltins(coerceRoles(cfg.roles)) : BUILTIN_ROLES;
}

/** Persist the project's roles. */
export async function saveRoles(projectPath: string, roles: TeamRole[]): Promise<void> {
  const file = configPath(projectPath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ roles }, null, 2)}\n`, "utf8");
}
