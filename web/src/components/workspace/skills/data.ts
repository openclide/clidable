import type { AgentId } from "../../welcome/data";

export type SkillGlyphId =
  | "spark"
  | "db"
  | "commit"
  | "test"
  | "type-strict"
  | "ui"
  | "deploy"
  | "lint"
  | "security"
  | "codemod"
  | "sql"
  | "deno";

// Legacy scope union still used by the MCP/Plugins mock cards. Real installed
// skills use the shared "project" | "global" scope (see InstalledSkill.scope).
export type SkillScope = "user" | "project";

export interface SkillFile {
  path: string;
  /** Bytes — formatted for display via `formatBytes`. */
  size: number;
}

interface BaseSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  glyph: SkillGlyphId;
  /** The YAML frontmatter `description` field — what the agent matches against. */
  triggerHint: string;
  /** Full SKILL.md body. */
  content: string;
  /** Files in the skill folder. SKILL.md is always present. */
  files: SkillFile[];
}

export interface InstalledSkill extends BaseSkill {
  version: string;
  agents: AgentId[];
  /** Where it's installed: in the repo, or under $HOME for all projects. */
  scope: "project" | "global";
}

export interface DiscoverSkill extends BaseSkill {
  /** Total installs from the skills.sh registry. */
  installs: number;
}

export type AnySkill = InstalledSkill | DiscoverSkill;

export function isInstalledSkill(s: AnySkill): s is InstalledSkill {
  return "version" in s;
}

/** Compact decimal formatter — 12_400 → "12.4k". */
export function formatInstalls(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Compact byte formatter — 1247 → "1.2 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
