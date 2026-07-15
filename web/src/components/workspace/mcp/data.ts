import type { AgentId } from "../../welcome/data";
import type { SkillFile } from "../skills/data";

export type McpGlyphId =
  | "github"
  | "db"
  | "filesystem"
  | "vercel"
  | "browser"
  | "linear"
  | "slack"
  | "stripe"
  | "sentry"
  | "generic";

export type McpTransport = "stdio" | "http" | "sse";

export type McpStatus = "connected" | "disconnected" | "starting" | "errored";

export interface McpTool {
  name: string;
  description: string;
}

export interface McpResource {
  name: string;
  description: string;
}

export interface McpEnvVar {
  name: string;
  /** Mock-only — real secret values would never round-trip through the UI. */
  preview?: string;
}

export interface McpHttpHeader {
  name: string;
  preview?: string;
}

interface BaseMcp {
  id: string;
  name: string;
  description: string;
  source: string;
  glyph: McpGlyphId;
  transport: McpTransport;

  // stdio transport
  command?: string;
  args?: string[];

  // http / sse transport
  url?: string;
  headers?: McpHttpHeader[];

  envVars: McpEnvVar[];
  tools: McpTool[];
  resources?: McpResource[];
  readme: string;
  files: SkillFile[];
}

export interface InstalledMcp extends BaseMcp {
  version: string;
  agents: AgentId[];
  /** Where it's configured: in the repo, or under $HOME for all projects. */
  scope: "project" | "global";
  status: McpStatus;
}

/** A Discover catalog/registry entry. No install counts — unlike skills.sh,
 *  no MCP registry publishes them, and we don't fake data. */
export type DiscoverMcp = BaseMcp;

export type AnyMcp = InstalledMcp | DiscoverMcp;

export function isInstalledMcp(m: AnyMcp): m is InstalledMcp {
  return "version" in m;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

export const STATUS_LABELS: Record<McpStatus, string> = {
  connected: "connected",
  disconnected: "disconnected",
  starting: "starting",
  errored: "errored",
};
