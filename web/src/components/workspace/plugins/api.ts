/**
 * Client wrapper for /api/plugins (PLAN.md §4, slice 1 — read path).
 *
 * Maps the server's `InstalledPluginInfo` onto the UI's `InstalledPlugin` shape
 * so the existing modal renders unchanged. Fields the server doesn't carry
 * (glyph, readme) are derived/stubbed — glyph from a keyword heuristic, readme
 * left empty until the detail view reads it. Mutations land in later slices.
 */
import { getJson, postJson } from "../../../lib/http";
import type { AgentId } from "../../welcome/data";
import type {
  DiscoverPluginInfo,
  InstalledPluginInfo,
  PluginScope,
  PluginStore,
} from "@shared/types";
import type { DiscoverPlugin, InstalledPlugin, PluginGlyphId } from "./data";

const GLYPH_KEYWORDS: Array<[RegExp, PluginGlyphId]> = [
  [/security|secret|owasp|audit|threat|semgrep|snyk/, "security"],
  [/review|pr-|lint/, "review"],
  [/postgres|mysql|sqlite|\bsql\b|database|\bdb\b|neon|supabase|prisma/, "db"],
  [/shadcn/, "shadcn"],
  [/design|ui|frontend|tailwind|css/, "ui"],
  [/typescript|\bts\b|type-/, "ts"],
  [/monorepo|turbo|workspace|nx\b/, "monorepo"],
  [/forge|next-forge|scaffold/, "forge"],
  [/stack|react|next|vue|svelte/, "stack"],
  [/vibe|yolo|fun/, "vibe"],
];

function glyphForPlugin(name: string, source: string): PluginGlyphId {
  const hay = `${name} ${source}`.toLowerCase();
  for (const [re, glyph] of GLYPH_KEYWORDS) if (re.test(hay)) return glyph;
  return "essentials";
}

/** Compose a fallback description from the component inventory when the
 *  manifest carries none (e.g. "4 commands · 2 skills · hooks"). */
function describeComponents(info: InstalledPluginInfo): string {
  const counts = new Map<string, number>();
  for (const c of info.components) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  const parts = [...counts.entries()].map(([type, n]) =>
    n === 1 ? type : `${n} ${type}s`,
  );
  return parts.length ? parts.join(" · ") : "Plugin bundle.";
}

function toUiPlugin(info: InstalledPluginInfo): InstalledPlugin {
  const source = info.marketplace ?? info.source ?? "local";
  return {
    id: info.name,
    name: info.name,
    description: info.description || describeComponents(info),
    source,
    glyph: glyphForPlugin(info.name, `${info.marketplace ?? ""} ${info.source ?? ""}`),
    components: info.components,
    readme: "",
    files: info.files,
    version: info.version ?? "",
    agents: info.agents as AgentId[],
    stores: info.stores,
    enabled: info.enabled,
    scope: info.scope,
  };
}

export async function fetchInstalledPlugins(
  projectPath: string,
): Promise<InstalledPlugin[]> {
  const qs = new URLSearchParams({ projectPath });
  const data = await getJson<{ plugins: InstalledPluginInfo[] }>(
    `/api/plugins?${qs}`,
    "plugins list failed",
  );
  return data.plugins.map(toUiPlugin);
}

async function postPlugins(path: string, body: unknown): Promise<InstalledPlugin[]> {
  const data = await postJson<{ plugins: InstalledPluginInfo[] }>(path, body);
  return data.plugins.map(toUiPlugin);
}

/** Remove a plugin from the given stores; returns the refreshed list. */
export function removePlugin(req: {
  projectPath: string;
  name: string;
  stores: PluginStore[];
}): Promise<InstalledPlugin[]> {
  return postPlugins("/api/plugins/remove", req);
}

/** Install a plugin from a source into the given stores; returns the refreshed
 *  list. `plugins add` installs every plugin found at `source`. */
export function installPlugin(req: {
  projectPath: string;
  source: string;
  scope: PluginScope;
  stores: PluginStore[];
}): Promise<InstalledPlugin[]> {
  return postPlugins("/api/plugins/add", req);
}

/* -------------------------------------------------------------------------- */
/*  Discover                                                                  */
/* -------------------------------------------------------------------------- */

const CATEGORY_GLYPH: Record<string, PluginGlyphId> = {
  development: "stack",
  productivity: "essentials",
  database: "db",
  security: "security",
  monitoring: "review",
  design: "ui",
  deployment: "forge",
  testing: "ts",
  learning: "vibe",
  location: "monorepo",
  math: "ts",
};

function toUiDiscover(d: DiscoverPluginInfo): DiscoverPlugin {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    source: d.source,
    glyph: CATEGORY_GLYPH[d.category] ?? glyphForPlugin(d.name, d.source),
    components: d.components,
    readme: "",
    files: [],
    installs: d.installs,
    category: d.category,
    marketplace: d.marketplace,
    store: d.store,
  };
}

/** Available plugins from the configured Claude marketplaces (Discover). */
export async function fetchDiscoverPlugins(): Promise<DiscoverPlugin[]> {
  const data = await getJson<{ plugins: DiscoverPluginInfo[] }>(
    "/api/plugins/discover",
    "plugins discover failed",
  );
  return data.plugins.map(toUiDiscover);
}

/** Install a specific plugin from a marketplace (Discover). Routes by `store`:
 *  Claude → Claude+Cursor, Codex → Codex. Returns the refreshed installed list. */
export function installMarketplacePlugin(req: {
  projectPath: string;
  name: string;
  marketplace: string;
  store: PluginStore;
  scope: PluginScope;
}): Promise<InstalledPlugin[]> {
  return postPlugins("/api/plugins/install", req);
}
