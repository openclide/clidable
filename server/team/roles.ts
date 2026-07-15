/**
 * AI Team roles → skills (PLAN.md §5).
 *
 * A "role" is a specialization bound to a delegate ("handler") agent. We render
 * each ENABLED role to a SKILL.md and drop it into its leads' skill buckets, so
 * the lead description-triggers it and hands the task to the right teammate via
 * `clidable team delegate`. This REUSES the skill-bucket dir mapping
 * (skills/buckets.ts) — a role skill is just a Clidable-authored skill, landing
 * where each agent already reads skills (.claude/skills, .agents/skills,
 * .qwen/skills).
 *
 * BUILTIN_ROLES is the seed library; the project's actual roles live in
 * `.clidable/ai-team.json` (see config.ts). `coerceRoles` is the trust boundary
 * — it rejects unsafe/malformed roles (path-traversal ids, unknown handlers,
 * missing fields) so render/sync can't be broken or escaped by a hand-edited
 * config. Sync is a full RECONCILE: enabled roles are installed, while every
 * other managed role skill (disabled, lead-removed, or deleted) is pruned —
 * never touching a same-named skill that isn't ours.
 */
import { mkdir, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUCKET_PROJECT_DIRS } from "../skills/buckets";
import { readText } from "../util/fs";
import { BUILTIN_RECIPES } from "./recipes";
import {
  SKILL_BUCKET_AGENTS,
  TEAM_ROLE_SKILL_MARKER,
  bucketsForAgents,
  migrateAgentId,
} from "../../shared/types";
import type {
  RoleGlyphId,
  SkillBucket,
  TeamRole,
  TeamRoleSyncInfo,
  TerminalAgentId,
} from "../../shared/types";

/** Safe role id / skill-folder name — no path separators, no traversal. */
const ROLE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

/** The full managed marker for a role id. */
const roleMarker = (id: string): string => `${TEAM_ROLE_SKILL_MARKER}${id}`;

/** Buckets that map to at least one agent (claude, universal, qwen). */
const ACTIVE_BUCKETS: SkillBucket[] = (
  Object.keys(BUCKET_PROJECT_DIRS) as SkillBucket[]
).filter((b) => SKILL_BUCKET_AGENTS[b].length > 0);

/** Delegate ids a role's handler may reference. */
const VALID_AGENTS = new Set(Object.keys(BUILTIN_RECIPES));

/** Every lead agent across all buckets — a role's default lead set. */
const ALL_LEADS: TerminalAgentId[] = [...new Set(Object.values(SKILL_BUCKET_AGENTS).flat())];

/** Expand a lead set to whole buckets: if any agent in a bucket is selected,
 *  all of it is. The universal agents share one skills dir, so a role can't be
 *  installed for one without the others — this keeps the bucket picker and what
 *  actually lands on disk in agreement. */
function normalizeLeads(agents: TerminalAgentId[]): TerminalAgentId[] {
  // Buckets a lead touches → all their agents. Agents are partitioned across
  // buckets (each belongs to exactly one), so the expansions are disjoint and
  // need no dedup.
  return bucketsForAgents(agents).flatMap((b) => SKILL_BUCKET_AGENTS[b]);
}

export const BUILTIN_ROLES: TeamRole[] = [
  {
    id: "architect",
    name: "Architect",
    description: "System design, data models, API structure.",
    glyph: "architect",
    triggerHint:
      "Use the Architect to design a system, choose a tech stack, or plan data models before coding.",
    promptTemplate:
      "You are a senior software architect. Be specific about tradeoffs and call out risks. Prefer simple, well-understood patterns over novel ones.",
    handlerAgent: "codex",
    enabledForLeads: ALL_LEADS,
    enabled: false,
    isCustom: false,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description: "Code review and second-opinion critique.",
    glyph: "reviewer",
    triggerHint:
      "Use the Reviewer to review code — a diff, a PR, or a branch — or to second-guess an architectural decision.",
    promptTemplate:
      "You are a thorough code reviewer. Identify bugs, security issues, perf risks, and naming problems. Be specific and link suggestions to code.",
    handlerAgent: "codex",
    enabledForLeads: ALL_LEADS,
    enabled: false,
    isCustom: false,
  },
  {
    id: "debugger",
    name: "Debugger",
    description: "Root-cause analysis of tricky bugs and stack traces.",
    glyph: "debugger",
    triggerHint:
      "Use the Debugger for a tricky bug, a failing or flaky test, or an unclear stack trace.",
    promptTemplate:
      "You are a debugging specialist. Form hypotheses, propose minimal repros, and rank likely causes by probability.",
    handlerAgent: "codex",
    enabledForLeads: ALL_LEADS,
    enabled: false,
    isCustom: false,
  },
  {
    id: "ui-designer",
    name: "UI/UX Designer",
    description: "Frontend layout, interactions, accessibility.",
    glyph: "ui-designer",
    triggerHint:
      "Use the UI/UX Designer for component design, layout, interactions, or accessibility.",
    promptTemplate:
      "You are a senior product designer. Focus on hierarchy, contrast, and accessibility. Suggest concrete component patterns, not abstractions.",
    handlerAgent: "claude",
    enabledForLeads: ALL_LEADS,
    enabled: false,
    isCustom: false,
  },
  {
    id: "tester",
    name: "Tester",
    description: "Test coverage, edge cases, fixtures.",
    glyph: "tester",
    triggerHint:
      "Use the Tester to write tests, find edge cases, or improve coverage.",
    promptTemplate:
      "You are a testing specialist. Identify untested edge cases. Prefer fast, deterministic tests with minimal setup.",
    handlerAgent: "codex",
    enabledForLeads: ALL_LEADS,
    enabled: false,
    isCustom: false,
  },
  {
    id: "security",
    name: "Security Auditor",
    description: "Vulnerability scanning, threat modeling, secrets hygiene.",
    glyph: "security",
    triggerHint:
      "Use the Security Auditor for HTTP endpoints, file uploads, auth flows, or anything touching secrets.",
    promptTemplate:
      "You are a security auditor. Walk OWASP top 10 against the change. Look for authz gaps, injection risks, and secret leaks.",
    handlerAgent: "antigravity",
    enabledForLeads: ALL_LEADS,
    enabled: false,
    isCustom: false,
  },
  {
    id: "performance",
    name: "Performance",
    description: "Bottleneck analysis, profiling, optimization.",
    glyph: "performance",
    triggerHint:
      "Use the Performance specialist to investigate slow code, profile a bottleneck, or plan an optimization.",
    promptTemplate:
      "You are a performance specialist. Always measure before optimizing. Identify Big-O risks, allocation patterns, and DB query costs.",
    handlerAgent: "codex",
    enabledForLeads: ALL_LEADS,
    enabled: false,
    isCustom: false,
  },
  {
    id: "documenter",
    name: "Documenter",
    description: "Docs, comments, READMEs, public-API descriptions.",
    glyph: "documenter",
    triggerHint:
      "Use the Documenter for documentation, code comments, READMEs, or public-API descriptions.",
    promptTemplate:
      "You are a technical writer. Be concise. Explain why, not just what. Use examples over abstractions.",
    handlerAgent: "claude",
    enabledForLeads: ALL_LEADS,
    enabled: false,
    isCustom: false,
  },
  {
    id: "image-creator",
    name: "Image Creator",
    description: "PNG/image assets via Codex image generation.",
    glyph: "image-creator",
    triggerHint:
      "Use the Image Creator to generate or edit PNG/image assets — icons, logos, illustrations, marketing shots, social/OG images.",
    // The delegate generates through its built-in image tool, which drops
    // output OUTSIDE the workspace (~/.codex/generated_images/<session>/) —
    // so the prompt must make the delegate copy the result into the project.
    promptTemplate:
      "You brief an image-generation teammate. The delegate prompt must be a complete art brief — subject, style, palette, background (transparent?), and target dimensions — plus the exact destination path inside this project (e.g. web/public/hero.png). End the prompt with: \"Generate the image; it lands under ~/.codex/generated_images/ in a new session folder — copy the final PNG to <destination> and confirm the saved path.\" One image per delegation.",
    handlerAgent: "codex",
    enabledForLeads: ALL_LEADS,
    enabled: false,
    isCustom: false,
    needsWrite: true,
  },
];

/* ------------------------------- validation ------------------------------ */

const asStr = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Validate + normalize ONE raw role. Returns null if it can't be trusted (no
 *  safe id, or a handler that isn't a wired delegate). Missing optional fields
 *  are defaulted; unknown extras are dropped. */
function sanitizeRole(raw: unknown): TeamRole | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = asStr(r.id);
  if (!ROLE_ID_RE.test(id)) return null; // safe slug only — blocks path traversal
  // Migrate a renamed handler/lead (a saved "gemini" → "antigravity") BEFORE
  // validating, so a role persisted under an old agent id isn't silently dropped
  // (which would reset the built-in or delete a custom role on next save).
  const handler = typeof r.handlerAgent === "string" ? migrateAgentId(r.handlerAgent) : "";
  if (!VALID_AGENTS.has(handler)) return null;
  const leads = Array.isArray(r.enabledForLeads)
    ? (r.enabledForLeads
        .filter((a) => typeof a === "string")
        .map((a) => migrateAgentId(a as string)) as TerminalAgentId[])
    : [];
  return {
    id,
    name: asStr(r.name) || id,
    description: asStr(r.description),
    glyph: asStr(r.glyph, "reviewer") as RoleGlyphId,
    triggerHint: asStr(r.triggerHint),
    promptTemplate: asStr(r.promptTemplate),
    handlerAgent: handler as TeamRole["handlerAgent"],
    enabledForLeads: normalizeLeads(leads),
    enabled: r.enabled === true,
    isCustom: r.isCustom === true,
    needsWrite: r.needsWrite === true,
  };
}

/**
 * Merge saved roles with the built-in library. Built-in roles keep their
 * CURATED presentation (name / description / glyph / trigger / prompt) from
 * BUILTIN_ROLES — so library improvements propagate to every project — while
 * the USER's choices (enabled, handler agent, leads, codex refinements) come
 * from the saved config. Custom roles pass through untouched, and newly-added
 * built-ins appear automatically. This is why a built-in's text isn't editable
 * per-project: it's owned by the library, not frozen into each config.
 */
export function mergeWithBuiltins(saved: TeamRole[]): TeamRole[] {
  const savedById = new Map(saved.map((r) => [r.id, r]));
  const builtinIds = new Set(BUILTIN_ROLES.map((r) => r.id));
  const builtins = BUILTIN_ROLES.map((b) => {
    const s = savedById.get(b.id);
    return s
      ? {
          ...b, // curated text/glyph/id from the library
          enabled: s.enabled,
          handlerAgent: s.handlerAgent,
          enabledForLeads: s.enabledForLeads,
        }
      : b;
  });
  const custom = saved.filter((r) => !builtinIds.has(r.id));
  return [...builtins, ...custom];
}

/** Validate a raw roles array: drop invalid roles and duplicate ids. */
export function coerceRoles(raw: unknown): TeamRole[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TeamRole[] = [];
  for (const item of raw) {
    const role = sanitizeRole(item);
    if (role && !seen.has(role.id)) {
      seen.add(role.id);
      out.push(role);
    }
  }
  return out;
}

/* -------------------------------- rendering ------------------------------ */

/** Escape arbitrary text into a safe YAML double-quoted scalar so a custom
 *  role's free-text trigger can't break (or inject into) the frontmatter. */
function yamlScalar(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ").trim()}"`;
}

/** Render a role to SKILL.md content (YAML frontmatter + body). */
export function renderRoleSkill(role: TeamRole): string {
  return `---
name: ${yamlScalar(role.id)}
description: ${yamlScalar(role.triggerHint)}
---

<!-- ${roleMarker(role.id)} — managed by Clidable. Edit roles in Clidable, not this file. -->

${role.promptTemplate}

When this applies, hand the task to your **${role.name}** teammate instead of
doing it yourself — run one command and relay the result:

\`\`\`bash
clidable team delegate ${role.handlerAgent}${role.needsWrite ? " --write" : ""} "<a complete, self-contained description of the task>"
\`\`\`

- Write a full prompt: the teammate runs in its own context and sees only what you pass.
- For long or open-ended work add \`--background\`, then poll \`clidable team status\` and read \`clidable team result\`.
- Relay the teammate's answer faithfully; don't silently rewrite it.
${
  role.needsWrite
    ? `- \`--write\` gives the teammate write access to this workspace (this role saves files). Don't drop the flag.
`
    : ""
}`;
}

/** Buckets a role installs into, from its enabled leads. */
export function bucketsForRole(role: TeamRole): SkillBucket[] {
  return Array.isArray(role.enabledForLeads) ? bucketsForAgents(role.enabledForLeads) : [];
}

/* ---------------------------------- sync --------------------------------- */

async function listSubdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Buckets where a role's managed skill is currently installed on disk — lets
 *  the GUI show install/remove diffs like the Skills manager. */
export async function roleInstalledBuckets(
  projectPath: string,
  roleId: string,
): Promise<SkillBucket[]> {
  if (!ROLE_ID_RE.test(roleId)) return [];
  const out: SkillBucket[] = [];
  for (const b of ACTIVE_BUCKETS) {
    const existing = await readText(join(projectPath, BUCKET_PROJECT_DIRS[b], roleId, "SKILL.md"));
    if (existing?.includes(roleMarker(roleId))) out.push(b);
  }
  return out;
}

/** Delete a role's skill folder: remove SKILL.md, then the dir if now empty. */
async function dropSkillDir(dir: string): Promise<void> {
  await rm(join(dir, "SKILL.md"), { force: true });
  await rmdir(dir).catch(() => {}); // ignore if not empty/missing
}

/** Remove a role's skill folder, but ONLY when its SKILL.md is one Clidable
 *  wrote (carries our marker) — a hand-written same-named skill is never
 *  touched. Use when the caller hasn't already checked ownership. */
async function removeManagedSkill(dir: string, roleId: string): Promise<void> {
  const existing = await readText(join(dir, "SKILL.md"));
  if (existing?.includes(roleMarker(roleId))) await dropSkillDir(dir);
}

/**
 * Reconcile ONE role's skill with its config: install into its desired buckets
 * (enabled → its leads' buckets; disabled → none) and remove OUR skill from the
 * rest — never touching a same-named skill that isn't ours. This is the per-role
 * apply behind the leads picker, mirroring the Skills manager.
 */
export async function syncRole(
  projectPath: string,
  role: TeamRole,
): Promise<TeamRoleSyncInfo> {
  if (!ROLE_ID_RE.test(role.id)) return { role: role.id, written: 0, skipped: [] };
  const want = new Set(role.enabled ? bucketsForRole(role) : []);
  const content = renderRoleSkill(role);
  let written = 0;
  const skipped: string[] = [];
  for (const b of ACTIVE_BUCKETS) {
    const dir = join(projectPath, BUCKET_PROJECT_DIRS[b], role.id);
    const file = join(dir, "SKILL.md");
    const existing = await readText(file);
    const isOurs = existing?.includes(roleMarker(role.id)) ?? false;
    if (want.has(b)) {
      if (existing !== null && !isOurs) {
        skipped.push(file); // a hand-written skill owns this path — leave it
        continue;
      }
      await mkdir(dir, { recursive: true });
      await writeFile(file, content, "utf8");
      written += 1;
    } else if (isOurs) {
      await dropSkillDir(dir); // ownership already known — skip the re-read
    }
  }
  return { role: role.id, written, skipped };
}

/**
 * Reconcile ALL role skills with the config: each role via syncRole, plus prune
 * managed skills for roles deleted from the config entirely.
 */
export async function syncRoles(
  projectPath: string,
  roles: TeamRole[],
): Promise<TeamRoleSyncInfo[]> {
  const safe = roles.filter((r) => ROLE_ID_RE.test(r.id));
  const known = new Set(safe.map((r) => r.id));

  // Prune OUR managed skills whose role id is no longer in the config (deleted).
  for (const b of ACTIVE_BUCKETS) {
    const base = join(projectPath, BUCKET_PROJECT_DIRS[b]);
    for (const name of await listSubdirs(base)) {
      if (known.has(name)) continue;
      await removeManagedSkill(join(base, name), name);
    }
  }

  return Promise.all(safe.map((role) => syncRole(projectPath, role)));
}

/** Remove a role's managed skill from every bucket — used when a role is
 *  deleted (per-role Apply can't, since the role is gone from the config).
 *  Scoped to this id, and never touches a same-named skill that isn't ours. */
export async function uninstallRole(projectPath: string, roleId: string): Promise<void> {
  if (!ROLE_ID_RE.test(roleId)) return;
  for (const b of ACTIVE_BUCKETS) {
    await removeManagedSkill(join(projectPath, BUCKET_PROJECT_DIRS[b], roleId), roleId);
  }
}
