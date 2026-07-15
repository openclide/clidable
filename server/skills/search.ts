/**
 * Skill discovery via the public skills.sh search API (PLAN.md §4, slice 2).
 *
 * This is the same unauthenticated endpoint the `skills find` CLI hits
 * (`SKILLS_API_URL || 'https://skills.sh'` + `/api/search`) — NOT the
 * key-gated `/api/v1/...`. We proxy it server-side so the browser never deals
 * with CORS and we get one caching seam. Single-word queries fuzzy-match;
 * multi-word queries use semantic search (skills.sh decides, echoed back).
 */
import type { DiscoverSkillInfo } from "../../shared/types";

const SEARCH_BASE = process.env.SKILLS_API_URL || "https://skills.sh";

interface RawHit {
  id: string;
  skillId?: string;
  name: string;
  source?: string;
  installs?: number;
}

export async function searchSkills(
  query: string,
  limit = 20,
): Promise<{ skills: DiscoverSkillInfo[]; searchType?: string }> {
  const url =
    `${SEARCH_BASE}/api/search` +
    `?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`skills.sh search failed (${res.status})`);
  const data = (await res.json()) as {
    skills?: RawHit[];
    searchType?: string;
  };
  const skills = (data.skills ?? [])
    // Drop malformed hits so the UI never renders a blank/`undefined` card.
    .filter((s) => typeof s?.id === "string" && typeof s?.name === "string")
    .map((s) => ({
      id: s.id,
      skillId: s.skillId ?? s.id.split("/").pop() ?? s.id,
      name: s.name,
      source: s.source ?? "",
      installs: s.installs ?? 0,
    }));
  return { skills, searchType: data.searchType };
}
