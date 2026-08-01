/**
 * AI Team per-project config (PLAN.md §5) — `<project>/.clidable/ai-team.json`.
 *
 * Holds the project's roles. Until the user saves once, there's no file and we
 * fall back to the built-in seed library, so a fresh project already has a
 * sensible team. The GUI reads via loadRoles, edits, and writes via saveRoles.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readJson } from "../util/fs";
import { BUILTIN_ROLES, coerceRoles, mergeWithBuiltins } from "./roles";
import type { TeamRole } from "../../shared/types";

const CONFIG_REL = ".clidable/ai-team.json";

interface TeamConfig {
  roles?: unknown;
}

const configPath = (dir: string): string => join(dir, CONFIG_REL);

/**
 * Find the directory whose team config governs `startDir`, walking upward.
 *
 * A lead agent delegates with `projectPath = process.cwd()`, and agents routinely
 * `cd` into a subdirectory mid-session. Reading only `startDir` meant a
 * delegation from `<project>/web` silently fell back to the built-in library, so
 * `--role` naming a CUSTOM role failed with "unknown role" while the same
 * command one directory up worked. Every agent that reads project files resolves
 * a root this way (Codex and Kimi both walk up to the nearest `.git`).
 *
 * Stops at the project root — the first directory holding `.git` — so an
 * unrelated config in a parent of the repo can never be picked up.
 */
async function findConfigDir(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  for (;;) {
    if (await Bun.file(configPath(dir)).exists()) return dir;
    // `.git` is a directory in a normal clone and a FILE in a worktree/submodule,
    // so test for existence of either rather than assuming a directory.
    if (await exists(join(dir, ".git"))) return null; // project root, no config
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The project's roles: the built-in library (curated text always current),
 *  with the user's saved choices (enabled / handler / leads) merged in and any
 *  custom roles appended. A missing config → the plain built-in seed. The roles
 *  are validated on load so a malformed/hand-edited file can't break render/sync. */
export async function loadRoles(projectPath: string): Promise<TeamRole[]> {
  const dir = await findConfigDir(projectPath);
  if (!dir) return BUILTIN_ROLES;
  const cfg = await readJson<TeamConfig>(configPath(dir));
  return Array.isArray(cfg?.roles) ? mergeWithBuiltins(coerceRoles(cfg.roles)) : BUILTIN_ROLES;
}

/** Persist the project's roles. Writes to the config that already governs this
 *  directory when there is one, so saving from a subdirectory updates the
 *  project's config rather than starting a second one beside it. */
export async function saveRoles(projectPath: string, roles: TeamRole[]): Promise<void> {
  const file = configPath((await findConfigDir(projectPath)) ?? projectPath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ roles }, null, 2)}\n`, "utf8");
}
