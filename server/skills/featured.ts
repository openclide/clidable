/**
 * Featured skills — the top of the skills.sh leaderboard, bundled so the
 * Discover tab renders instantly at rest instead of an empty search prompt
 * (skills.sh has no public "popular" endpoint to fetch live; counts refresh
 * per release, ported from claude-code-chat's `top-skills.json`).
 *
 * Wire shape = `DiscoverSkillInfo`, served by /api/skills/search when the
 * query is under the live-search threshold. Entries are deduped by skillId —
 * the UI keys and matches installed skills on the folder name.
 */
import type { DiscoverSkillInfo } from "../../shared/types";

const skill = (id: string, installs: number): DiscoverSkillInfo => {
  const parts = id.split("/");
  return {
    id,
    skillId: parts[parts.length - 1]!,
    name: parts[parts.length - 1]!,
    source: parts.slice(0, 2).join("/"),
    installs,
  };
};

export const FEATURED_SKILLS: DiscoverSkillInfo[] = [
  skill("vercel-labs/skills/find-skills", 654_260),
  skill("vercel-labs/agent-skills/vercel-react-best-practices", 234_225),
  skill("vercel-labs/agent-skills/web-design-guidelines", 187_122),
  skill("anthropics/skills/frontend-design", 184_608),
  skill("vercel-labs/agent-browser/agent-browser", 119_125),
  skill("anthropics/skills/skill-creator", 97_605),
  skill("nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max", 74_564),
  skill("microsoft/azure-skills/microsoft-foundry", 74_376),
  skill("obra/superpowers/brainstorming", 66_697),
  skill("browser-use/browser-use/browser-use", 52_773),
  skill("coreyhaines31/marketingskills/seo-audit", 50_157),
  skill("anthropics/skills/pdf", 45_709),
  skill("supabase/agent-skills/supabase-postgres-best-practices", 43_862),
  skill("coreyhaines31/marketingskills/copywriting", 42_743),
  skill("anthropics/skills/pptx", 41_526),
  skill("vercel-labs/next-skills/next-best-practices", 40_732),
  skill("squirrelscan/skills/audit-website", 37_654),
  skill("obra/superpowers/systematic-debugging", 36_470),
  skill("anthropics/skills/docx", 35_928),
  skill("obra/superpowers/writing-plans", 35_010),
  skill("shadcn/ui/shadcn", 33_897),
  skill("anthropics/skills/xlsx", 32_936),
  skill("obra/superpowers/using-superpowers", 30_937),
  skill("obra/superpowers/test-driven-development", 30_410),
];
