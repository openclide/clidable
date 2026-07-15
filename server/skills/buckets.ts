/**
 * The three physical skill "buckets" at project scope and how they map to the
 * `skills` CLI. Shared by the disk scanner (installed.ts) and the mutation
 * manager (manager.ts) so the path/agent mapping lives in exactly one place.
 *
 * See PLAN.md §4 and the slice-3 probe notes: at project scope the universal
 * dir (.agents/skills) is read by Codex/Cursor/Antigravity/OpenCode/Copilot/Kimi as a
 * group, so they can't be toggled independently. Qwen Code is the exception — it
 * reads only its own `.qwen/skills`, so it gets a dedicated bucket.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { SkillBucket, SkillScope } from "../../shared/types";

/** Project-scope directory for each bucket, relative to the project root. */
export const BUCKET_PROJECT_DIRS: Record<SkillBucket, string> = {
  claude: ".claude/skills",
  universal: ".agents/skills",
  qwen: ".qwen/skills",
  aider: ".aider-desk/skills",
};

/**
 * Global-scope (home-rooted) directory for each bucket. Verified: at global
 * scope the universal agents still share `~/.agents/skills` (the same bucket
 * model as project scope), so only the root differs.
 */
export const BUCKET_GLOBAL_DIRS: Record<SkillBucket, string> = {
  claude: join(homedir(), ".claude", "skills"),
  universal: join(homedir(), ".agents", "skills"),
  qwen: join(homedir(), ".qwen", "skills"),
  aider: join(homedir(), ".aider-desk", "skills"),
};

/** Absolute directory that holds a bucket's skill folders for a given scope. */
export function bucketBaseDir(
  scope: SkillScope,
  bucket: SkillBucket,
  projectPath: string,
): string {
  return scope === "global"
    ? BUCKET_GLOBAL_DIRS[bucket]
    : join(projectPath, BUCKET_PROJECT_DIRS[bucket]);
}

/**
 * Representative skills.sh `--agent` id used to install INTO each bucket.
 * Installing for any one universal agent writes the shared .agents/skills dir
 * that serves them all, so a single representative is enough.
 */
export const BUCKET_INSTALL_AGENT: Record<SkillBucket, string> = {
  claude: "claude-code",
  universal: "codex",
  qwen: "qwen-code",
  aider: "aider-desk",
};

/** Probe order so the "primary" copy (for reading SKILL.md/metadata) prefers
 *  the richest universal copy, then Claude, then Aider. */
export const BUCKET_ORDER: SkillBucket[] = ["universal", "claude", "qwen", "aider"];
