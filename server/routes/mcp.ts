/**
 * /api/mcp — MCP server management (PLAN.md §4).
 *
 *   GET /api/mcp?projectPath=&scope=  → { servers } configured across agents
 *
 * Read-only for now (slice 1). Add/remove (upsertServer/removeServer) land in a
 * later slice. Mirrors the projects/skills route style.
 */
import { jsonError as err } from "../http";
import { addMcpServer, listMcpServers, removeMcpServer } from "../mcp/manager";
import { browseMcpServers, searchMcpServers } from "../mcp/search";
import { MCP_AGENT_TYPE } from "../../shared/types";
import type {
  AddMcpRequest,
  DiscoverMcpResponse,
  ListMcpResponse,
  McpScope,
  RemoveMcpRequest,
  TerminalAgentId,
} from "../../shared/types";

const SUPPORTED = new Set(Object.keys(MCP_AGENT_TYPE));

/** Keep only agents add-mcp actually supports (others would be silently
 *  no-op'd by the manager, making a request look like it succeeded). */
function validAgents(agents: unknown): TerminalAgentId[] {
  return Array.isArray(agents)
    ? (agents.filter((a) => typeof a === "string" && SUPPORTED.has(a)) as TerminalAgentId[])
    : [];
}

export async function mcpListHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");
  const scope: McpScope =
    url.searchParams.get("scope") === "global" ? "global" : "project";
  try {
    const body: ListMcpResponse = {
      servers: await listMcpServers(projectPath, scope),
    };
    return Response.json(body);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[mcp] list failed:");
  }
}

/** GET /api/mcp/discover[?q=] — the featured+curated catalog at rest, a
 *  dual-registry live search from 2 chars (same threshold as skills). */
export async function mcpDiscoverHandler(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  try {
    const servers = q.length >= 2 ? await searchMcpServers(q) : await browseMcpServers();
    return Response.json({ servers } satisfies DiscoverMcpResponse);
  } catch (e) {
    return err(502, (e as Error)?.message ?? String(e), "[mcp] discover failed:");
  }
}

export async function mcpAddHandler(req: Request): Promise<Response> {
  let body: AddMcpRequest;
  try {
    body = (await req.json()) as AddMcpRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (!body.name) return err(400, "missing 'name'");
  const agents = validAgents(body.agents);
  if (agents.length === 0) return err(400, "missing or unsupported 'agents'");
  const scope: McpScope = body.scope === "global" ? "global" : "project";
  try {
    const servers = await addMcpServer({
      projectPath: body.projectPath,
      scope,
      name: body.name,
      agents,
      spec: body.config,
    });
    return Response.json({ servers } satisfies ListMcpResponse);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[mcp] add failed:");
  }
}

export async function mcpRemoveHandler(req: Request): Promise<Response> {
  let body: RemoveMcpRequest;
  try {
    body = (await req.json()) as RemoveMcpRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (!body.name) return err(400, "missing 'name'");
  // Require explicit agents over the HTTP route — omitting them would remove
  // the server from every agent (the manager's CLI-only default).
  const agents = validAgents(body.agents);
  if (agents.length === 0) return err(400, "missing or unsupported 'agents'");
  const scope: McpScope = body.scope === "global" ? "global" : "project";
  try {
    const servers = await removeMcpServer({
      projectPath: body.projectPath,
      scope,
      name: body.name,
      agents,
    });
    return Response.json({ servers } satisfies ListMcpResponse);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[mcp] remove failed:");
  }
}
