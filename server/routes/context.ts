/**
 * /api/context — Instructions files (PLAN.md §4). Mirrors the skills/mcp/plugins
 * routes.
 *
 *   GET  /api/context?projectPath=         → canonical AGENTS.md + per-agent coverage
 *   GET  /api/context/starter?projectPath= → a framework-detected starter AGENTS.md
 *   POST /api/context/save                 → write AGENTS.md + holdout @import pointers
 */
import { jsonError as err } from "../http";
import { scanContext } from "../context/scan";
import { saveContext } from "../context/manager";
import { buildStarter } from "../context/starter";
import { INSTRUCTION_POINTER_FILES } from "../../shared/types";
import type {
  ContextResponse,
  SaveContextRequest,
  TerminalAgentId,
} from "../../shared/types";

const POINTER_AGENTS = new Set(
  Object.keys(INSTRUCTION_POINTER_FILES) as TerminalAgentId[],
);

/** Keep only valid pointer-capable agent ids from untrusted input. */
function cleanAgents(value: unknown): TerminalAgentId[] {
  return Array.isArray(value)
    ? (value.filter(
        (a): a is TerminalAgentId =>
          typeof a === "string" && POINTER_AGENTS.has(a as TerminalAgentId),
      ))
    : [];
}

export async function contextGetHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");
  try {
    const body: ContextResponse = await scanContext(projectPath);
    return Response.json(body);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[context] scan failed:");
  }
}

export async function contextStarterHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");
  try {
    const content = await buildStarter(projectPath);
    return Response.json({ content });
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[context] starter failed:");
  }
}

export async function contextSaveHandler(req: Request): Promise<Response> {
  let body: Partial<SaveContextRequest>;
  try {
    body = (await req.json()) as Partial<SaveContextRequest>;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (typeof body.content !== "string") return err(400, "missing 'content'");
  try {
    const result = await saveContext({
      projectPath: body.projectPath,
      content: body.content,
      pointers: cleanAgents(body.pointers),
      convert: cleanAgents(body.convert),
    });
    return Response.json(result);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[context] save failed:");
  }
}
