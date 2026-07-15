/**
 * Skill mutations (PLAN.md §4, slice 3). The internal API behind both the
 * GUI (/api/skills/*) and the CLI (`clidable skills …`, slice 4).
 *
 *   • ADD into a fresh bucket goes through the `skills` CLI — it clones the
 *     source and writes the skill folder. If the skill is ALREADY installed in
 *     another bucket of the same scope, we copy that folder instead: no source
 *     repo needed (global installs have no lockfile to recover it from) and no
 *     network round-trip.
 *   • REMOVE deletes the bucket folder directly. The CLI can't remove the
 *     shared universal dir per-agent (`remove -a <universal>` is a no-op — see
 *     the slice-3 probe), and a skill *is* just a folder, so a scoped rmdir is
 *     the deterministic, general mechanism. We prune the lock entry once a
 *     skill is gone from every bucket.
 */
import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runSkillsCli, summarizeCliFailure } from "./cli";
import { listInstalledSkills } from "./installed";
import { BUCKET_INSTALL_AGENT, BUCKET_ORDER, bucketBaseDir } from "./buckets";
import { hasSkillSource } from "../../shared/types";
import type { InstalledSkillInfo, SkillBucket, SkillScope } from "../../shared/types";

export interface AddSkillArgs {
  projectPath: string;
  /** "owner/repo" the skill comes from. May be unknown for already-installed
   *  skills (e.g. global scope, which has no lockfile). */
  source: string;
  /** The skill's folder name within that repo. */
  skillId: string;
  scope: SkillScope;
  /** Which buckets to install into. */
  buckets: SkillBucket[];
}

export async function addSkill(args: AddSkillArgs): Promise<void> {
  const { projectPath, source, skillId, scope, buckets } = args;
  if (buckets.length === 0) throw new Error("no target agents selected");
  const globalFlag = scope === "global" ? ["-g"] : [];
  // One bucket at a time, sequentially. Combining `-a claude-code` with a
  // universal agent in a single `skills add` makes skills.sh write only the
  // universal dir and drop the Claude copy (slice-3 probe); sequential also
  // avoids two `skills` processes racing on skills-lock.json.
  for (const bucket of buckets) {
    const dest = join(bucketBaseDir(scope, bucket, projectPath), skillId);
    if (existsSync(dest)) continue; // already in this bucket

    // Already installed in another bucket of this scope → copy the folder.
    // Works without a source repo and skips a re-clone.
    const existing = BUCKET_ORDER.map((b) =>
      join(bucketBaseDir(scope, b, projectPath), skillId),
    ).find((p) => p !== dest && existsSync(p));
    if (existing) {
      await cp(existing, dest, { recursive: true });
      continue;
    }

    // Fresh install: needs a real source repo via the CLI.
    if (!hasSkillSource(source)) {
      throw new Error("cannot install: unknown source repository");
    }
    const res = await runSkillsCli(
      ["add", source, "--skill", skillId, ...globalFlag, "-a", BUCKET_INSTALL_AGENT[bucket], "-y"],
      projectPath,
    );
    if (!res.ok) {
      throw new Error(`Couldn't install for ${bucket}: ${summarizeCliFailure(res)}`);
    }
  }
}

/**
 * Remove a skill from a single bucket (or all buckets when `bucket` is
 * omitted), within `scope`. Returns the refreshed installed list for that scope
 * (so the route doesn't have to re-scan), and prunes the (project) lock entry
 * if the skill is now gone everywhere.
 */
export async function removeSkill(
  projectPath: string,
  name: string,
  scope: SkillScope,
  bucket?: SkillBucket,
): Promise<InstalledSkillInfo[]> {
  const targets = bucket ? [bucket] : BUCKET_ORDER;
  await Promise.all(
    targets.map((b) =>
      rm(join(bucketBaseDir(scope, b, projectPath), name), {
        recursive: true,
        force: true,
      }),
    ),
  );
  const skills = await listInstalledSkills(projectPath, scope);
  if (scope === "project" && !skills.some((s) => s.name === name)) {
    await pruneLockEntry(projectPath, name);
  }
  return skills;
}

/** Drop a skill's lockfile entry. Best-effort — the lock is enrichment only. */
async function pruneLockEntry(projectPath: string, name: string): Promise<void> {
  try {
    const file = Bun.file(join(projectPath, "skills-lock.json"));
    if (!(await file.exists())) return;
    const lock = (await file.json()) as {
      version?: number;
      skills?: Record<string, unknown>;
    };
    if (lock.skills && name in lock.skills) {
      delete lock.skills[name];
      await Bun.write(file, JSON.stringify(lock, null, 2) + "\n");
    }
  } catch {
    // Failing to prune never breaks the listing.
  }
}
