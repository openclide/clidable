/**
 * MCP server management (PLAN.md §4), backed by the `add-mcp` library's typed
 * in-process API — no CLI/re-exec. Lists/edits each agent's own config file.
 *
 * `listInstalledServers` returns servers per-agent; we aggregate by server name
 * across our supported agents → which agents have it. Slice 1 is read-only;
 * add/remove (upsertServer/removeServer) land in a later slice.
 */
import {
  agents as ADD_MCP_AGENTS,
  listInstalledServers,
  removeServer,
  upsertServer,
  type AgentType,
  type McpServerConfig,
} from "add-mcp";
import { MCP_AGENT_TYPE, MCP_GLOBAL_ONLY_AGENTS } from "../../shared/types";
import type {
  McpScope,
  McpServerInfo,
  McpServerSpec,
  McpTransportType,
  TerminalAgentId,
} from "../../shared/types";

const MCP_AGENT_TYPES = Object.values(MCP_AGENT_TYPE) as AgentType[];

/** add-mcp AgentType → our agent id (reverse of MCP_AGENT_TYPE). */
const TO_OUR_AGENT = new Map<string, TerminalAgentId>(
  Object.entries(MCP_AGENT_TYPE).map(([ours, mcp]) => [mcp, ours as TerminalAgentId]),
);

/** True when add-mcp's target for this agent has no project-local config path,
 *  so a project-scope write would silently hit its single global file. Derived
 *  from add-mcp itself (authoritative). */
function isGlobalOnlyMcp(agent: TerminalAgentId): boolean {
  const type = MCP_AGENT_TYPE[agent];
  return !!type && ADD_MCP_AGENTS[type as AgentType]?.localConfigPath === undefined;
}

// Drift guard: MCP_GLOBAL_ONLY_AGENTS (used by the frontend, which can't import
// add-mcp) must match add-mcp's reality. Warn if a future add-mcp bump changes a
// target's project support out from under the UI restriction.
for (const agent of Object.keys(MCP_AGENT_TYPE) as TerminalAgentId[]) {
  if (isGlobalOnlyMcp(agent) !== MCP_GLOBAL_ONLY_AGENTS.has(agent)) {
    console.warn(
      `[mcp] project-scope support for "${agent}" changed in add-mcp — update MCP_GLOBAL_ONLY_AGENTS in shared/types.ts`,
    );
  }
}

export async function listMcpServers(
  projectPath: string,
  scope: McpScope,
): Promise<McpServerInfo[]> {
  const perAgent = await listInstalledServers({
    global: scope === "global",
    cwd: projectPath,
    agents: MCP_AGENT_TYPES,
  });

  // name → { config (first seen), agents that have it }
  const byName = new Map<
    string,
    { config: Record<string, unknown>; agents: Set<TerminalAgentId> }
  >();
  for (const agent of perAgent) {
    const ours = TO_OUR_AGENT.get(agent.agentType);
    if (!ours) continue;
    for (const s of agent.servers) {
      let entry = byName.get(s.serverName);
      if (!entry) byName.set(s.serverName, (entry = { config: s.config, agents: new Set() }));
      entry.agents.add(ours);
    }
  }

  const servers = [...byName.entries()].map(([name, { config, agents }]) =>
    toServerInfo(name, config, [...agents], scope),
  );
  servers.sort((a, b) => a.name.localeCompare(b.name));
  return servers;
}

function toServerInfo(
  name: string,
  config: Record<string, unknown>,
  agents: TerminalAgentId[],
  scope: McpScope,
): McpServerInfo {
  const url = typeof config.url === "string" ? config.url : null;
  const command = typeof config.command === "string" ? config.command : null;
  const transport: McpTransportType = url
    ? config.type === "sse"
      ? "sse"
      : "http"
    : "stdio";
  const headers = isRecord(config.headers) ? Object.keys(config.headers) : [];
  const env = isRecord(config.env) ? Object.keys(config.env) : [];
  return {
    name,
    transport,
    command,
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    url,
    headerNames: headers,
    envNames: env,
    agents,
    scope,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/* --- mutations (slice 2) --- */

/** Translate a UI server spec into add-mcp's McpServerConfig. */
function specToConfig(spec: McpServerSpec): McpServerConfig {
  if (spec.transport === "stdio") {
    return { command: spec.command, args: spec.args, env: spec.env };
  }
  return { type: spec.transport, url: spec.url, headers: spec.headers };
}

/** Find an existing server's full config (incl. secrets) from any agent that
 *  has it in this scope — so the matrix can copy it onto another agent without
 *  the secret values ever leaving the server. */
async function findExistingConfig(
  projectPath: string,
  scope: McpScope,
  name: string,
): Promise<McpServerConfig | undefined> {
  // Prefer the requested scope, but fall back to the other so the matrix can
  // copy a server's config across scopes (e.g. project → global).
  for (const global of [scope === "global", scope !== "global"]) {
    const perAgent = await listInstalledServers({
      global,
      cwd: projectPath,
      agents: MCP_AGENT_TYPES,
    });
    for (const agent of perAgent) {
      for (const s of agent.servers) {
        if (s.serverName === name) return s.config as McpServerConfig;
      }
    }
  }
  return undefined;
}

/** Add a server to the given agents, then return the refreshed list. Uses the
 *  provided `spec`, or copies the config from an agent that already has it. */
export async function addMcpServer(args: {
  projectPath: string;
  scope: McpScope;
  name: string;
  agents: TerminalAgentId[];
  spec?: McpServerSpec;
}): Promise<McpServerInfo[]> {
  const { projectPath, scope, name, agents, spec } = args;
  if (agents.length === 0) throw new Error("no target agents selected");
  // Refuse a project-scope write for a global-only agent BEFORE touching disk —
  // add-mcp would silently write it to the global config (leaking any secrets
  // into every project), and the server would then never appear in the project
  // list. Fail fast so nothing partial lands.
  if (scope === "project") {
    const globalOnly = agents.filter(isGlobalOnlyMcp);
    if (globalOnly.length > 0) {
      throw new Error(
        `${globalOnly.join(", ")} can only be configured globally — switch the scope to Global.`,
      );
    }
  }
  const config = spec
    ? specToConfig(spec)
    : await findExistingConfig(projectPath, scope, name);
  if (!config) throw new Error(`no config available for "${name}" to install`);
  const local = scope === "project";
  for (const a of agents) {
    const mcpType = MCP_AGENT_TYPE[a];
    if (!mcpType) continue; // agent not supported by add-mcp
    const r = upsertServer(mcpType as AgentType, name, config, { local, cwd: projectPath });
    if (!r.success) throw new Error(r.error ?? `failed to add "${name}" for ${a}`);
  }
  return listMcpServers(projectPath, scope);
}

/** Remove a server from the given agents (or all supported), return the list. */
export async function removeMcpServer(args: {
  projectPath: string;
  scope: McpScope;
  name: string;
  agents?: TerminalAgentId[];
}): Promise<McpServerInfo[]> {
  const { projectPath, scope, name } = args;
  const local = scope === "project";
  // At project scope, skip global-only agents: they have no project config, and
  // removeServer with local:true would target (and delete from) their global
  // file instead — the mirror of the add-side hazard.
  const targets = (
    args.agents ?? ([...TO_OUR_AGENT.values()] as TerminalAgentId[])
  ).filter((a) => !(local && isGlobalOnlyMcp(a)));
  for (const a of targets) {
    const mcpType = MCP_AGENT_TYPE[a];
    if (!mcpType) continue;
    removeServer(mcpType as AgentType, name, { local, cwd: projectPath });
  }
  return listMcpServers(projectPath, scope);
}
