/**
 * /api/skills — Agent Skills management (PLAN.md §4).
 *
 *   GET /api/skills?projectPath=&scope=  → { skills } installed on disk
 *   GET /api/skills/search?q=            → { skills } from skills.sh registry
 *
 * Mutations (add/remove via the `skills` CLI) land in a later slice. Mirrors
 * the projects/checkpoints route style: shallow validation,
 * `{ ok:false, error }`.
 */
import { jsonError as err } from "../http";
import { listInstalledSkills } from "../skills/installed";
import { FEATURED_SKILLS } from "../skills/featured";
import { searchSkills } from "../skills/search";
import { addSkill, removeSkill } from "../skills/manager";
import type {
  AddSkillRequest,
  ListSkillsResponse,
  RemoveSkillRequest,
  SearchSkillsResponse,
  SkillBucket,
  SkillScope,
} from "../../shared/types";

const BUCKETS: ReadonlySet<SkillBucket> = new Set(["claude", "universal", "aider", "qwen"]);

export async function skillsListHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");
  const scope: SkillScope =
    url.searchParams.get("scope") === "global" ? "global" : "project";
  try {
    const body: ListSkillsResponse = {
      skills: await listInstalledSkills(projectPath, scope),
    };
    return Response.json(body);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[skills] list failed:");
  }
}

export async function skillsSearchHandler(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  // Below the live-search threshold (skills.sh requires ≥2 chars), serve the
  // bundled featured list — the Discover tab's instant rest state.
  if (q.length < 2) {
    return Response.json({
      skills: FEATURED_SKILLS,
      searchType: "featured",
    } satisfies SearchSkillsResponse);
  }
  try {
    const { skills, searchType } = await searchSkills(q);
    return Response.json({ skills, searchType } satisfies SearchSkillsResponse);
  } catch (e) {
    // Degrade like MCP search does: skills.sh down → featured matches are
    // still useful (and were on screen local-first a moment earlier). Only
    // error when nothing matches locally either.
    const needle = q.toLowerCase();
    const local = FEATURED_SKILLS.filter(
      (s) =>
        s.skillId.toLowerCase().includes(needle) ||
        s.source.toLowerCase().includes(needle),
    );
    if (local.length > 0) {
      return Response.json({
        skills: local,
        searchType: "featured",
      } satisfies SearchSkillsResponse);
    }
    return err(502, (e as Error)?.message ?? String(e), "[skills] search failed:");
  }
}

export async function skillsAddHandler(req: Request): Promise<Response> {
  let body: AddSkillRequest;
  try {
    body = (await req.json()) as AddSkillRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (!body.source) return err(400, "missing 'source'");
  if (!body.skillId) return err(400, "missing 'skillId'");
  const scope: SkillScope = body.scope === "global" ? "global" : "project";
  const buckets = Array.isArray(body.buckets)
    ? body.buckets.filter((b) => BUCKETS.has(b))
    : [];
  if (buckets.length === 0) return err(400, "no valid 'buckets'");
  try {
    await addSkill({ ...body, scope, buckets });
    const list: ListSkillsResponse = {
      skills: await listInstalledSkills(body.projectPath, scope),
    };
    return Response.json(list);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[skills] add failed:");
  }
}

export async function skillsRemoveHandler(req: Request): Promise<Response> {
  let body: RemoveSkillRequest;
  try {
    body = (await req.json()) as RemoveSkillRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (!body.name) return err(400, "missing 'name'");
  if (body.bucket && !BUCKETS.has(body.bucket)) {
    return err(400, `unknown bucket: ${body.bucket}`);
  }
  const scope: SkillScope = body.scope === "global" ? "global" : "project";
  try {
    // removeSkill returns the refreshed list for the scope — no second scan.
    const list: ListSkillsResponse = {
      skills: await removeSkill(body.projectPath, body.name, scope, body.bucket),
    };
    return Response.json(list);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[skills] remove failed:");
  }
}
