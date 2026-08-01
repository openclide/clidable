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

/**
 * The seed library.
 *
 * Two texts per role, for two different readers — conflating them is how the
 * Image Creator ended up telling its delegate to go brief someone else:
 *
 * - `triggerHint` becomes the SKILL.md frontmatter `description`, and is the
 *   ONLY thing the lead sees before deciding to load the skill. Written to
 *   Anthropic's documented shape: third person, state what the role does AND
 *   when to use it, key use case first, in the words a user would actually say.
 *   Never "Use the X to…" — the lead is matching a capability, not reading an
 *   instruction, and second-person phrasing is a documented discovery problem.
 *   Kept to a few hundred characters: Claude Code truncates the combined
 *   description text and, once the whole listing overflows its budget, silently
 *   drops the descriptions of least-invoked skills — which strips the very
 *   keywords a vague description needs to ever match.
 *
 * - `promptTemplate` is sent to the DELEGATE ahead of the task. Written as
 *   directives to the specialist, concrete enough to change what comes back:
 *   what to lead with, what to rank by, what to check that a generalist skips,
 *   and permission to report "nothing found" instead of padding.
 */
export const BUILTIN_ROLES: TeamRole[] = [
  {
    id: "architect",
    name: "Architect",
    description: "System design, data models, API structure.",
    glyph: "architect",
    triggerHint:
      "Designs system architecture, data models, and API structure, and weighs tech-stack tradeoffs. Use when planning a new system or feature, choosing a stack, designing a database schema or API surface, deciding how components should fit together, or when the user asks for the Architect.",
    promptTemplate: `You are a senior software architect. Produce a design, not a survey of options.

- Lead with one recommendation and the two or three tradeoffs that decided it.
- Name the failure modes the design must survive, and say how it survives them.
- Prefer boring, well-understood patterns; justify any novel one explicitly.
- State what you would NOT build yet, and what would later force a rewrite.
- Make your assumptions about scale, consistency, and failure handling explicit — the lead may know they are wrong.`,
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
      "Reviews code for bugs, security flaws, performance risks, and unclear naming, and gives a second opinion on design decisions. Use when reviewing a diff, pull request, branch, or file, when asked to critique or second-guess an approach, or when the user asks for a code review or for the Reviewer.",
    promptTemplate: `You are reviewing someone else's code. Report findings; do not rewrite the code.

- Order by severity: correctness bugs first, then security, performance, clarity.
- For each finding give file:line, what breaks, and the concrete input or state that triggers it. A finding without a failure case is an opinion — label it as one.
- Read what the change REMOVED as carefully as what it added; a deleted guard is invisible in the new code.
- Check the callers of anything whose signature, return shape, or preconditions moved.
- If the change is sound, say so plainly. Do not manufacture findings to look thorough.`,
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
      "Finds the root cause of bugs, crashes, stack traces, and failing or flaky tests. Use when something breaks and the cause is unclear, when a test passes sometimes and fails other times, when an error message or stack trace needs interpreting, or when the user asks for the Debugger.",
    promptTemplate: `You are debugging. Find the cause before proposing a fix.

- Rank the plausible causes by probability and give the evidence for each.
- Propose the smallest experiment that distinguishes the top two, and say what each outcome would prove.
- Trace the actual data path. An error message names where it surfaced, rarely where it started.
- For flaky failures look first at shared state, ordering, timing, and cleanup between runs.
- Say explicitly when the evidence is insufficient and name what you would need to see. A confident wrong diagnosis costs more than an honest "not yet determined".`,
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
      "Designs frontend layout, component structure, interaction states, and accessibility. Use when building or reworking a screen or component, fixing spacing, hierarchy, or contrast, choosing a component pattern, working on UI or UX, or when the user asks for the UI/UX Designer.",
    promptTemplate: `You design interfaces. Give buildable specifications, not adjectives.

- Specify every state: default, hover, focus, active, disabled, loading, empty, and error. The empty and error states are part of the design, not an afterthought.
- Name real values — sizes, weights, spacing, colours — rather than "generous" or "subtle".
- Treat accessibility as a requirement: contrast ratio, visible focus, keyboard order, labels for screen readers, and touch targets large enough to hit.
- Reuse the existing components and design tokens in the project; justify any new one.
- Describe hierarchy in terms of what the user is trying to do first.`,
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
      "Writes tests and finds untested edge cases, fixtures, and failure modes. Use when adding or improving tests, deciding what a change needs covered, chasing a coverage gap, hardening code against inputs it does not handle yet, or when the user asks for the Tester.",
    promptTemplate: `You write tests. A few sharp tests beat many shallow ones.

- Start from what the code must guarantee, then find the inputs that violate it.
- Cover boundaries, empty and zero values, unicode, concurrency, and error paths — the happy path is the case least likely to be broken.
- Each test should fail for exactly one reason, and its name should state that reason.
- Keep them deterministic and fast: no sleeps, no network, no shared mutable fixtures, no dependence on test order.
- Name the risks you did NOT cover. Silence about a gap reads as coverage.`,
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
      "Audits code for security vulnerabilities, authorization gaps, injection risks, and leaked secrets, and threat-models changes. Use when touching authentication, HTTP endpoints, file uploads, user input, credentials, or untrusted data, or when the user asks for a security review or for the Security Auditor.",
    promptTemplate: `You are auditing for security. Assume the input is hostile and the caller is untrusted.

- Look for injection, authorization gaps, SSRF, path traversal, unsafe deserialization, and exposed secrets — but report the concrete attack path, not the category name.
- Trace where untrusted data enters and every place it is interpreted: a shell, a query, a path, a template, a parser.
- Check the error paths and what leaks through messages, logs, and timing.
- Separate "exploitable now" from "hardening for later", and rank by exploitability, not by tidiness.
- If you find nothing exploitable, say so. A padded report buries the real finding in the next one.`,
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
      "Investigates slow code, profiles bottlenecks, and plans optimizations backed by measurement. Use when something is slow, when a query, loop, or render looks expensive, when planning an optimization, or when the user asks about Performance or for the performance specialist.",
    promptTemplate: `You work on performance. Measure before optimizing.

- Say what to measure and how, before proposing any change.
- Identify the DOMINANT cost — algorithmic complexity, allocation, I/O, or round trips — and ignore anything that cannot move it. A 10x win on 2% of the time is noise.
- Quantify the expected impact of each suggestion, even roughly, so it can be ranked.
- Flag when the honest answer is "this is already fast enough"; unnecessary optimization costs readability permanently.
- Where speed trades against clarity, present it as a decision rather than making it silently.`,
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
      "Writes documentation, code comments, READMEs, and public-API descriptions. Use when documenting a feature or API, writing or updating a README or changelog, explaining how something works, fixing comments that no longer match the code, or when the user asks for the Documenter.",
    promptTemplate: `You write technical documentation. Explain why, not just what.

- Open with what the reader is trying to accomplish, not with what the thing is.
- Show a working example before the abstract description.
- Document the surprising parts: gotchas, failure modes, and constraints that are not visible from the signature.
- Omit anything a competent reader infers from the code itself — restating the obvious trains readers to skim.
- Match the surrounding documentation's voice and terminology exactly; a new synonym for an existing concept is a bug.`,
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
      "Generates PNG and image assets — icons, logos, illustrations, mascots, marketing shots, and social or OG images. Use when the project needs an image that does not exist yet, when an asset needs regenerating at a new size or style, or when the user asks for the Image Creator.",
    // The delegate generates through its built-in image tool, which drops output
    // OUTSIDE the workspace (~/.codex/generated_images/<session>/), so it must be
    // told to copy the result in. This is the one role where writing the
    // delegation well takes real instruction, hence the leadHint.
    promptTemplate: `You generate image assets. Produce exactly one image per request.

- Your image tool writes to ~/.codex/generated_images/ in a new session folder, which is OUTSIDE this project. The task names a destination path inside the project — copy the final PNG there yourself and confirm the saved path in your reply. An image left in the session folder is a failed delegation.
- Follow the brief's subject, style, palette, background, and dimensions exactly. Where the brief is silent, choose something plain and say what you chose.
- If the brief is too vague to execute, say what is missing instead of guessing.`,
    leadHint: `Write the delegation as a complete art brief — subject, style, palette, background (transparent?), and target dimensions — and include the exact destination path inside this project (e.g. \`web/public/hero.png\`). Request one image per delegation.`,
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
  const leadHint = asStr(r.leadHint).trim();
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
    // Optional: omitted entirely rather than stored as "" (or as whitespace,
    // which renderRoleSkill would turn into an empty "Writing the brief."
    // section) so a role without one round-trips through save/load unchanged.
    ...(leadHint ? { leadHint } : {}),
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

/**
 * Short content fingerprint stamped into the managed marker.
 *
 * Without it an installed skill is undetectably STALE: the marker alone proves
 * only "Clidable wrote this", so a file rendered by an older version looks
 * identical to a current one, the GUI reports the role up to date, and the Apply
 * button stays disabled. That is how a fix to the rendered command line reaches
 * nobody who already synced — which is exactly what happened when `--role` was
 * added. Eight hex chars is ~4 billion buckets; a collision costs one skipped
 * rewrite, not corruption.
 */
function fingerprint(content: string): string {
  return Bun.hash(content).toString(16).padStart(8, "0").slice(0, 8);
}

/** Pull the fingerprint out of an installed file's marker. `null` when the file
 *  predates fingerprinting (no `#…`) — which must read as stale, not current. */
function installedFingerprint(content: string, roleId: string): string | null {
  const m = content.match(
    new RegExp(`${TEAM_ROLE_SKILL_MARKER}${roleId}#([0-9a-f]{8})\\b`),
  );
  return m?.[1] ?? null;
}

/** Render a role to SKILL.md content (YAML frontmatter + body). */
export function renderRoleSkill(role: TeamRole): string {
  const content = renderRoleSkillContent(role);
  return content.replace(MARKER_SLOT, markerLine(role.id, fingerprint(content)));
}

/** Placeholder occupying the marker's line while the content is hashed — the
 *  marker can't be part of its own fingerprint. */
const MARKER_SLOT = " MARKER ";

const markerLine = (id: string, fp: string): string =>
  `<!-- ${roleMarker(id)}#${fp} — managed by Clidable. Edit roles in Clidable, not this file. -->`;

/** Everything the fingerprint covers: frontmatter + body, marker slotted out.
 *  Any change a user would need re-synced must be inside this string. */
function renderRoleSkillContent(role: TeamRole): string {
  return `---
name: ${yamlScalar(role.id)}
description: ${yamlScalar(role.triggerHint)}
---

${MARKER_SLOT}

Your **${role.name}** teammate handles this: ${role.description}

When it applies, hand the task over instead of doing it yourself — run one
command and relay the result:

\`\`\`bash
clidable team delegate ${role.handlerAgent} --role ${role.id}${role.needsWrite ? " --write" : ""} "<a complete, self-contained description of the task>"
\`\`\`

- Write a full prompt: the teammate runs in its own context and sees only what you pass.
- Keep \`--role ${role.id}\` — that flag is what gives the teammate its ${role.name} instructions. Without it you get a generic agent.
- For long or open-ended work add \`--background\`, then poll \`clidable team status\` and read \`clidable team result\`.
- Relay the teammate's answer faithfully; don't silently rewrite it.
${
  role.needsWrite
    ? `- \`--write\` gives the teammate write access to this workspace (this role saves files). Don't drop the flag.
`
    : ""
}${
  role.leadHint
    ? `
**Writing the brief.** ${role.leadHint}
`
    : ""
}`;
}

/**
 * Compose what the DELEGATE actually receives: the role's persona followed by
 * the lead's task.
 *
 * The sibling of renderRoleSkill — that one renders a role for the LEAD (which
 * is told to hand the work off), this one renders it for the specialist (which
 * does the work). Both are needed, and only one used to exist: `promptTemplate`
 * was interpolated into the skill body and never sent anywhere, so the delegate
 * got a bare task and every role produced identical behaviour.
 *
 * The delegate is told the task came from another agent and that its reply is
 * relayed verbatim — a peer, not a human, is reading the answer (the
 * cross-agent identification convention in CLAUDE.md). An empty promptTemplate
 * (possible on a custom role) degrades to the bare task rather than emitting a
 * stray separator.
 */
export function composeDelegatePrompt(role: TeamRole, task: string): string {
  const persona = role.promptTemplate.trim();
  const body = task.trim();
  if (!persona) return body;
  return `${persona}

---

The following task was delegated to you by another AI coding agent acting as the
team lead. Answer it completely and on your own — your reply is relayed back
verbatim, so state everything the lead needs.

${body}`;
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
/**
 * Where a role's skill is installed, and where what's installed is OUT OF DATE.
 *
 * `installed` alone can't drive the Apply button: a skill rendered by an older
 * Clidable carries the same marker as a current one, so the bucket sets match,
 * Apply greys out, and the GUI reports "up to date" while the file on disk still
 * holds the old instructions. Comparing fingerprints is what makes a shipped fix
 * reach projects that synced before it.
 */
export async function roleSkillState(
  projectPath: string,
  role: TeamRole,
): Promise<{ installed: SkillBucket[]; stale: SkillBucket[] }> {
  const installed: SkillBucket[] = [];
  const stale: SkillBucket[] = [];
  if (!ROLE_ID_RE.test(role.id)) return { installed, stale };
  const current = fingerprint(renderRoleSkillContent(role));
  for (const b of ACTIVE_BUCKETS) {
    const existing = await readText(join(projectPath, BUCKET_PROJECT_DIRS[b], role.id, "SKILL.md"));
    if (!existing?.includes(roleMarker(role.id))) continue;
    installed.push(b);
    // A pre-fingerprint file returns null here and is therefore stale, which is
    // the point — those are exactly the ones carrying outdated instructions.
    if (installedFingerprint(existing, role.id) !== current) stale.push(b);
  }
  return { installed, stale };
}

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
