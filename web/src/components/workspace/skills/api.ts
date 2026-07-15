/**
 * Client wrapper for /api/skills (PLAN.md §4, slice 1 — read path).
 *
 * Fetches the real installed skills (skills.sh on-disk state) and maps the
 * server's `InstalledSkillInfo` onto the UI's `InstalledSkill` shape so the
 * existing Skills modal renders them with zero component churn. The glyph is a
 * pure UI affordance (real skills carry no glyph), derived from the name.
 */
import { getJson, postJson } from "../../../lib/http";
import type { AgentId } from "../../welcome/data";
import type {
  DiscoverSkillInfo,
  InstalledSkillInfo,
  SkillBucket,
  SkillScope,
} from "@shared/types";
import type { DiscoverSkill, InstalledSkill, SkillGlyphId } from "./data";

const GLYPH_KEYWORDS: Array<[RegExp, SkillGlyphId]> = [
  [/react|component|\bui\b|frontend|css|tailwind|design/, "ui"],
  [/postgres|sql|database|\bdb\b|migration/, "db"],
  [/test|spec|vitest|jest/, "test"],
  [/type|tsconfig|strict/, "type-strict"],
  [/commit|conventional/, "commit"],
  [/deploy|vercel|ship|release/, "deploy"],
  [/lint|eslint|format|prettier/, "lint"],
  [/security|auth|owasp|secure/, "security"],
  [/codemod|refactor/, "codemod"],
  [/deno/, "deno"],
];

const ALL_GLYPHS: SkillGlyphId[] = [
  "spark", "db", "commit", "test", "type-strict", "ui",
  "deploy", "lint", "security", "codemod", "sql", "deno",
];

/** Deterministic glyph for a skill: keyword match first, else hashed fallback. */
function glyphForSkill(name: string): SkillGlyphId {
  const n = name.toLowerCase();
  for (const [re, glyph] of GLYPH_KEYWORDS) if (re.test(n)) return glyph;
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) | 0;
  return ALL_GLYPHS[Math.abs(hash) % ALL_GLYPHS.length]!;
}

function toUiSkill(info: InstalledSkillInfo): InstalledSkill {
  return {
    id: info.name,
    name: info.name,
    description: info.description || "No description provided.",
    source: info.source ?? "local",
    glyph: glyphForSkill(info.name),
    triggerHint: info.description || "No trigger description in SKILL.md.",
    content: info.content,
    files: info.files,
    version: info.version ?? "",
    agents: info.agents as AgentId[],
    scope: info.scope,
  };
}

export async function fetchInstalledSkills(
  projectPath: string,
  scope: SkillScope = "project",
): Promise<InstalledSkill[]> {
  const qs = new URLSearchParams({ projectPath, scope });
  const data = await getJson<{ skills: InstalledSkillInfo[] }>(
    `/api/skills?${qs}`,
    "skills list failed",
  );
  return data.skills.map(toUiSkill);
}

/** Map a skills.sh search hit onto the UI's DiscoverSkill shape. Search hits
 *  carry no SKILL.md body, so content/files are empty (detail degrades to a
 *  metadata-only view until the skill is installed). */
function toUiDiscoverSkill(info: DiscoverSkillInfo): DiscoverSkill {
  return {
    // id = folder name so it matches installed skills' `name` for the badge.
    id: info.skillId,
    name: info.name,
    description: info.source
      ? `Agent skill from ${info.source}.`
      : "Agent skill from the skills.sh registry.",
    source: info.source || "skills.sh",
    glyph: glyphForSkill(info.name),
    triggerHint: "",
    content: "",
    files: [],
    installs: info.installs,
  };
}

export async function searchSkills(query: string): Promise<DiscoverSkill[]> {
  const data = await getJson<{ skills: DiscoverSkillInfo[] }>(
    `/api/skills/search?q=${encodeURIComponent(query)}`,
    "skills search failed",
  );
  return data.skills.map(toUiDiscoverSkill);
}

/** The bundled featured list (top of the skills.sh leaderboard) — the Discover
 *  tab's instant rest state. Served by the search route below its live-search
 *  threshold. */
export function fetchFeaturedSkills(): Promise<DiscoverSkill[]> {
  return searchSkills("");
}

async function postSkills(
  path: string,
  body: unknown,
): Promise<InstalledSkill[]> {
  const data = await postJson<{ skills: InstalledSkillInfo[] }>(path, body);
  return data.skills.map(toUiSkill);
}

/** Install a skill into the given buckets; returns the refreshed installed list. */
export function installSkill(req: {
  projectPath: string;
  source: string;
  skillId: string;
  scope: SkillScope;
  buckets: SkillBucket[];
}): Promise<InstalledSkill[]> {
  return postSkills("/api/skills/add", req);
}

/** Remove a skill from one bucket (or everywhere when `bucket` omitted). */
export function removeSkill(req: {
  projectPath: string;
  name: string;
  scope: SkillScope;
  bucket?: SkillBucket;
}): Promise<InstalledSkill[]> {
  return postSkills("/api/skills/remove", req);
}
