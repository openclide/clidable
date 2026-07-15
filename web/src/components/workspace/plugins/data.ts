import type { SkillFile } from "../skills/data";
import type { AgentId } from "../../welcome/data";
import type {
  PluginComponentInfo,
  PluginComponentType,
  PluginScope,
  PluginStore,
} from "@shared/types";

export type { PluginComponentType, PluginScope, PluginStore };

export type PluginGlyphId =
  | "essentials"
  | "review"
  | "security"
  | "ui"
  | "db"
  | "stack"
  | "forge"
  | "shadcn"
  | "ts"
  | "monorepo"
  | "vibe";

/** A bundled component (command/skill/agent/hook/mcp/lsp). Same shape as the
 *  server's `PluginComponentInfo`. */
export type PluginComponent = PluginComponentInfo;

/** The two install stores (Claude + Cursor share one; Codex its own). Single
 *  display table for the add-custom form and the per-store matrix. */
export const PLUGIN_STORES: Array<{ id: PluginStore; label: string; agents: AgentId[] }> = [
  { id: "claude", label: "Claude & Cursor", agents: ["claude", "cursor"] },
  { id: "codex", label: "Codex", agents: ["codex"] },
  { id: "antigravity", label: "Antigravity", agents: ["antigravity"] },
];

/** Install scopes (shared by the add-custom form and the Discover install). */
export const PLUGIN_SCOPES: Array<{ id: PluginScope; hint: string }> = [
  { id: "user", hint: "every project" },
  { id: "project", hint: "this repo · committed" },
  { id: "local", hint: "this repo · gitignored" },
];

/**
 * Agents with no plugin store Clidable can manage — surfaced as a detail-view
 * footnote. Antigravity IS supported (its own `agy plugin` store, read from
 * `.agents/plugins/` + `~/.gemini/config/plugins/`), so it's no longer listed.
 */
export const UNSUPPORTED_TARGETS = [
  "OpenCode",
  "Qwen Code",
  "Kimi CLI",
  "GitHub Copilot",
];

interface BasePlugin {
  id: string;
  name: string;
  description: string;
  source: string;
  glyph: PluginGlyphId;
  components: PluginComponent[];
  readme: string;
  files: SkillFile[];
}

/** A plugin installed in one or both native stores (merged by name). */
export interface InstalledPlugin extends BasePlugin {
  version: string;
  /** Agents that have it, derived from stores (claude store → claude+cursor). */
  agents: AgentId[];
  stores: PluginStore[];
  enabled: boolean;
  scope: PluginScope;
}

export interface DiscoverPlugin extends BasePlugin {
  installs: number;
  /** Category from the marketplace (drives the glyph), "" if none. */
  category: string;
  /** Marketplace it lives in — needed to install it natively. */
  marketplace: string;
  /** Store it installs into (claude = Claude+Cursor, codex = Codex). */
  store: PluginStore;
}

export type AnyPlugin = InstalledPlugin | DiscoverPlugin;

export function isInstalledPlugin(p: AnyPlugin): p is InstalledPlugin {
  return "version" in p;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** Group a plugin's components by type, preserving insertion order. */
export function groupComponents(
  components: PluginComponent[],
): Array<{ type: PluginComponentType; items: PluginComponent[] }> {
  const order: PluginComponentType[] = [
    "command",
    "skill",
    "agent",
    "hook",
    "mcp",
    "lsp",
  ];
  const buckets = new Map<PluginComponentType, PluginComponent[]>();
  for (const c of components) {
    if (!buckets.has(c.type)) buckets.set(c.type, []);
    buckets.get(c.type)!.push(c);
  }
  return order
    .filter((t) => buckets.has(t))
    .map((t) => ({ type: t, items: buckets.get(t)! }));
}

export const COMPONENT_LABELS: Record<PluginComponentType, string> = {
  command: "Commands",
  skill: "Skills",
  agent: "Agents",
  hook: "Hooks",
  mcp: "MCP servers",
  lsp: "LSP servers",
};
