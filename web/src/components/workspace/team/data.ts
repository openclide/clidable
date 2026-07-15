import type { AgentId } from "../../welcome/data";
import type { RoleGlyphId, TeamRole } from "@shared/types";

// The role model is shared with the server (single source of truth); the GUI
// binds to it directly. `Role` is the local alias the team components import.
export type { TeamRole as Role, RoleGlyphId } from "@shared/types";

export const ROLE_GLYPH_OPTIONS: RoleGlyphId[] = [
  "architect",
  "reviewer",
  "debugger",
  "ui-designer",
  "tester",
  "security",
  "performance",
  "documenter",
  "marketer",
  "pm",
  "image-creator",
];

/* -------------------------------------------------------------------------- */
/*  Lead-serializer disk paths (Advanced section)                             */
/* -------------------------------------------------------------------------- */

/**
 * Where a role's generated SKILL.md lands for each lead. Every lead now reads
 * skills (PLAN.md §5, after the qwen/kimi skills fix), so this mirrors the
 * skill buckets: Claude → .claude/skills, Qwen → .qwen/skills, and the rest
 * share the universal .agents/skills folder.
 */
export function leadInstallPath(leadId: AgentId, roleId: string): string | null {
  const file = (dir: string): string => `${dir}/${roleId}/SKILL.md`;
  switch (leadId) {
    case "claude":
      return file(".claude/skills");
    case "qwen":
      return file(".qwen/skills");
    case "codex":
    case "cursor":
    case "antigravity":
    case "opencode":
    case "copilot":
    case "kimi":
      return file(".agents/skills");
    default:
      return null;
  }
}

export function findRoleById(roles: TeamRole[], id: string): TeamRole | undefined {
  return roles.find((r) => r.id === id);
}
