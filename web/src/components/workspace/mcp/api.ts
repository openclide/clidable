/**
 * Client wrapper for /api/mcp (PLAN.md §4, slice 1 — read path).
 *
 * Maps the server's `McpServerInfo` (config-level, from add-mcp) onto the UI's
 * `InstalledMcp` shape so the existing modal renders with no component churn.
 * Fields add-mcp can't know (tools, live status, version, readme) are stubbed —
 * MCP is config management, not a runtime. `status: "connected"` means
 * "configured for the agent", not a live socket.
 */
import { getJson, postJson } from "../../../lib/http";
import type { AgentId } from "../../welcome/data";
import type {
  DiscoverMcpInfo,
  McpServerInfo,
  McpScope,
  McpServerSpec,
  TerminalAgentId,
} from "@shared/types";
import type {
  DiscoverMcp,
  InstalledMcp,
  McpGlyphId,
  McpHttpHeader,
  McpEnvVar,
} from "./data";

const GLYPH_KEYWORDS: Array<[RegExp, McpGlyphId]> = [
  [/github/, "github"],
  [/postgres|mysql|sqlite|\bsql\b|database|\bdb\b|neon|supabase/, "db"],
  [/filesystem|\bfs\b|\bfile/, "filesystem"],
  [/vercel/, "vercel"],
  [/playwright|puppeteer|browser|chrome/, "browser"],
  [/linear/, "linear"],
  [/slack/, "slack"],
  [/stripe/, "stripe"],
  [/sentry/, "sentry"],
];

function glyphForMcp(name: string, source: string): McpGlyphId {
  const hay = `${name} ${source}`.toLowerCase();
  for (const [re, glyph] of GLYPH_KEYWORDS) if (re.test(hay)) return glyph;
  return "generic";
}

function toUiMcp(info: McpServerInfo): InstalledMcp {
  const pkg = info.args.find((a) => !a.startsWith("-"));
  const source = info.url ?? pkg ?? info.command ?? info.name;
  const description =
    info.url ?? (`${info.command ?? ""} ${info.args.join(" ")}`.trim() || info.name);
  return {
    id: info.name,
    name: info.name,
    description,
    source,
    glyph: glyphForMcp(info.name, source),
    transport: info.transport,
    command: info.command ?? undefined,
    args: info.args,
    url: info.url ?? undefined,
    headers: info.headerNames.map((name): McpHttpHeader => ({ name })),
    envVars: info.envNames.map((name): McpEnvVar => ({ name })),
    tools: [],
    readme: "",
    files: [],
    version: "",
    agents: info.agents as AgentId[],
    scope: info.scope,
    status: "connected",
  };
}

/** Config-safe server name for a Discover entry. Registry ids like
 *  "com.stripe/mcp" contain '/' and '.' — codex rejects such names in
 *  config.toml, and other agents' files get awkward keys. The UI id IS this
 *  sanitized name (it's what installs get named), so the installed badge, the
 *  per-scope agent matrix, and the detail upgrade all match after install. */
export function mcpConfigName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

/** Map a Discover catalog/registry entry onto the UI shape. Registries carry
 *  config-level metadata only — tools/readme/files stay empty until installed
 *  (the detail view already renders those sections conditionally). */
function toUiDiscoverMcp(info: DiscoverMcpInfo): DiscoverMcp {
  const source =
    info.url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "") ||
    info.serverUrl ||
    info.args.find((a) => !a.startsWith("-")) ||
    info.id;
  return {
    id: mcpConfigName(info.id),
    name: info.name,
    description: info.description || info.id,
    source,
    glyph: glyphForMcp(info.name, `${info.id} ${source}`),
    transport: info.transport,
    command: info.command ?? undefined,
    args: info.args,
    url: info.serverUrl ?? undefined,
    headers: info.headerNames.map((name): McpHttpHeader => ({ name })),
    envVars: info.envNames.map((name): McpEnvVar => ({ name })),
    tools: [],
    readme: "",
    files: [],
  };
}

/** Discover catalog: featured+curated at rest (no/short query), a live
 *  dual-registry search from 2 chars. */
export async function fetchDiscoverMcps(query = ""): Promise<DiscoverMcp[]> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const data = await getJson<{ servers: DiscoverMcpInfo[] }>(
    `/api/mcp/discover${qs}`,
    "mcp discover failed",
  );
  return data.servers.map(toUiDiscoverMcp);
}

export async function fetchInstalledMcps(
  projectPath: string,
  scope: McpScope = "project",
): Promise<InstalledMcp[]> {
  const qs = new URLSearchParams({ projectPath, scope });
  const data = await getJson<{ servers: McpServerInfo[] }>(
    `/api/mcp?${qs}`,
    "mcp list failed",
  );
  return data.servers.map(toUiMcp);
}

async function postMcp(path: string, body: unknown): Promise<InstalledMcp[]> {
  const data = await postJson<{ servers: McpServerInfo[] }>(path, body);
  return data.servers.map(toUiMcp);
}

/** Add a server to the given agents. Omit `config` to copy from an agent that
 *  already has it (the per-agent matrix on an installed server). */
export function installMcp(req: {
  projectPath: string;
  scope: McpScope;
  name: string;
  agents: TerminalAgentId[];
  config?: McpServerSpec;
}): Promise<InstalledMcp[]> {
  return postMcp("/api/mcp/add", req);
}

/** Remove a server from the given agents (or all when omitted). */
export function removeMcp(req: {
  projectPath: string;
  scope: McpScope;
  name: string;
  agents?: TerminalAgentId[];
}): Promise<InstalledMcp[]> {
  return postMcp("/api/mcp/remove", req);
}
