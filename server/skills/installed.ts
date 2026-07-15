/**
 * Read installed Agent Skills from disk (PLAN.md §4, slice 1).
 *
 * skills.sh (the `skills` CLI) is the projection engine — it copies a skill
 * folder into each agent's location. We never parse its CLI output; instead we
 * read the truth directly:
 *
 *   • the three project-scope bucket dirs (.claude/skills, .agents/skills,
 *     .aider-desk/skills) tell us which agents a skill serves, and
 *   • <project>/skills-lock.json tells us where each skill came from.
 *
 * A skill's per-agent state is therefore *derived* (which bucket dirs contain
 * its folder), not stored — matching how `skills list` itself reports it.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  InstalledSkillInfo,
  SkillBucket,
  SkillFileInfo,
  SkillScope,
  TerminalAgentId,
} from "../../shared/types";
import { agentsForBuckets, TEAM_ROLE_SKILL_MARKER } from "../../shared/types";
import { BUCKET_ORDER, bucketBaseDir } from "./buckets";

interface LockEntry {
  source?: string;
  sourceType?: string;
}
interface LockFile {
  version?: number;
  skills?: Record<string, LockEntry>;
}

async function readLock(projectPath: string): Promise<LockFile["skills"]> {
  try {
    const file = Bun.file(join(projectPath, "skills-lock.json"));
    if (!(await file.exists())) return {};
    const parsed = (await file.json()) as LockFile;
    return parsed.skills ?? {};
  } catch {
    return {}; // malformed lock → fall back to pure disk scan
  }
}

async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return []; // dir doesn't exist
  }
}

/** Recursively list files under `root`, returning paths relative to it. */
async function walkFiles(root: string): Promise<SkillFileInfo[]> {
  const out: SkillFileInfo[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs, childRel);
      } else if (e.isFile()) {
        try {
          const s = await stat(abs);
          out.push({ path: childRel, size: s.size });
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  await walk(root, "");
  // SKILL.md first, then alphabetical — stable, readable order in the UI.
  out.sort((a, b) => {
    if (a.path === "SKILL.md") return -1;
    if (b.path === "SKILL.md") return 1;
    return a.path.localeCompare(b.path);
  });
  return out;
}

/** Minimal YAML-frontmatter reader — pulls scalar `name`/`description` without
 *  a YAML dependency. Skills frontmatter is flat key: value pairs. */
function parseFrontmatter(content: string): { description: string } {
  if (!content.startsWith("---")) return { description: "" };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { description: "" };
  const block = content.slice(3, end);
  let description = "";
  for (const line of block.split("\n")) {
    const m = line.match(/^description:\s*(.*)$/);
    if (m) {
      description = m[1]!.trim().replace(/^["']|["']$/g, "");
      break;
    }
  }
  return { description };
}

async function readMetadataVersion(folder: string): Promise<string | null> {
  try {
    const file = Bun.file(join(folder, "metadata.json"));
    if (!(await file.exists())) return null;
    const meta = (await file.json()) as { version?: unknown };
    return typeof meta.version === "string" ? meta.version : null;
  } catch {
    return null;
  }
}

async function readSkillMd(folder: string): Promise<string> {
  try {
    const file = Bun.file(join(folder, "SKILL.md"));
    return (await file.exists()) ? await file.text() : "";
  } catch {
    return "";
  }
}

/**
 * List skills installed in a project. `scope: "global"` is not yet scanned
 * (each agent has its own ~/.<agent>/skills dir) — returns [] for now.
 */
export async function listInstalledSkills(
  projectPath: string,
  scope: SkillScope = "project",
): Promise<InstalledSkillInfo[]> {
  // name → buckets it appears in (within the chosen scope's roots)
  const byName = new Map<string, Set<SkillBucket>>();
  for (const bucket of BUCKET_ORDER) {
    const dir = bucketBaseDir(scope, bucket, projectPath);
    for (const name of await listSubdirs(dir)) {
      let set = byName.get(name);
      if (!set) byName.set(name, (set = new Set()));
      set.add(bucket);
    }
  }

  // The lockfile only exists at project scope; global installs aren't tracked.
  const lock = scope === "project" ? await readLock(projectPath) : {};

  const skills = await Promise.all(
    [...byName.entries()].map(async ([name, bucketSet]) => {
      const buckets = BUCKET_ORDER.filter((b) => bucketSet.has(b));
      // Read metadata from the first present bucket in priority order.
      const primary = join(bucketBaseDir(scope, buckets[0]!, projectPath), name);
      const [content, version, files] = await Promise.all([
        readSkillMd(primary),
        readMetadataVersion(primary),
        walkFiles(primary),
      ]);
      const { description } = parseFrontmatter(content);
      const lockEntry = lock?.[name];
      const sourceType =
        lockEntry?.sourceType === "github" || lockEntry?.sourceType === "well-known"
          ? lockEntry.sourceType
          : null;
      return {
        name,
        source: lockEntry?.source ?? null,
        sourceType,
        description,
        version,
        content,
        files,
        buckets,
        agents: agentsForBuckets(buckets),
        scope,
      } satisfies InstalledSkillInfo;
    }),
  );

  // Hide Clidable-managed AI Team role skills — they're owned by the Team
  // manager (which would otherwise fight the Skills manager over the same files).
  return skills
    .filter((s) => !s.content.includes(TEAM_ROLE_SKILL_MARKER))
    .sort((a, b) => a.name.localeCompare(b.name));
}
