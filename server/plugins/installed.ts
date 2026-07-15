/**
 * Read installed plugins from the native stores (PLAN.md §4, slice 1).
 *
 * A plugin is a bundle (skills/commands/agents/hooks/mcp/lsp). Installs land in
 * two physical stores (see shared/types.ts `PluginStore`):
 *
 *   • claude → ~/.claude/plugins/installed_plugins.json  (+ settings.json
 *              `enabledPlugins`, known_marketplaces.json). Read by Cursor too.
 *   • codex  → ~/.codex/config.toml `[plugins.*]`  (+ ~/.agents/plugins/marketplace.json)
 *
 * We read these files directly — never parse `plugins`/`claude`/`codex` output.
 * Entries are merged by plugin name; per-store presence drives the agent dots.
 * The component inventory is scanned from the cached plugin folder, the way
 * `plugins discover` does it.
 */
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type {
  InstalledPluginInfo,
  PluginComponentInfo,
  PluginFileInfo,
  PluginScope,
  PluginStore,
} from "../../shared/types";
import { agentsForStores } from "../../shared/types";
import { readJson, pathExists } from "../util/fs";

const claudeDir = () => join(homedir(), ".claude");
const codexDir = () => join(homedir(), ".codex");

// readJson is re-exported for discover.ts, which imports it from here.
export { readJson };

async function listDir(dir: string, dirsOnly = false): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => (dirsOnly ? e.isDirectory() : true)).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Recursively list files under `root`, paths relative to it (for the detail view). */
async function walkFiles(root: string): Promise<PluginFileInfo[]> {
  const out: PluginFileInfo[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs, childRel);
      } else if (e.isFile()) {
        try {
          out.push({ path: childRel, size: (await stat(abs)).size });
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  await walk(root, "");
  out.sort((a, b) => {
    const aManifest = a.path.endsWith("plugin.json");
    const bManifest = b.path.endsWith("plugin.json");
    if (aManifest !== bManifest) return aManifest ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return out;
}

/** Read the plugin manifest's `description`. The manifest location varies:
 *  Claude/Codex nest it under a vendor subdir; Antigravity (`agy`) keeps
 *  `plugin.json` at the plugin root (the "" segment, checked first). */
async function readDescription(dir: string): Promise<string> {
  for (const m of ["", ".plugin", ".claude-plugin", ".codex-plugin"]) {
    const meta = await readJson<{ description?: unknown }>(join(dir, m, "plugin.json"));
    if (meta && typeof meta.description === "string") return meta.description;
  }
  return "";
}

/** Scan a plugin's cached folder for the artifacts it bundles. */
async function scanComponents(dir: string): Promise<PluginComponentInfo[]> {
  const out: PluginComponentInfo[] = [];
  for (const f of await listDir(join(dir, "commands"))) {
    if (f.endsWith(".md")) out.push({ type: "command", name: "/" + f.replace(/\.md$/, "") });
  }
  for (const d of await listDir(join(dir, "skills"), true)) {
    out.push({ type: "skill", name: d });
  }
  for (const f of await listDir(join(dir, "agents"))) {
    if (f.endsWith(".md")) out.push({ type: "agent", name: f.replace(/\.md$/, "") });
  }
  if (await pathExists(join(dir, "hooks", "hooks.json"))) {
    out.push({ type: "hook", name: "hooks" });
  }
  const mcp = await readJson<{ mcpServers?: Record<string, unknown> }>(join(dir, ".mcp.json"));
  if (mcp?.mcpServers && Object.keys(mcp.mcpServers).length > 0) {
    for (const name of Object.keys(mcp.mcpServers)) out.push({ type: "mcp", name });
  } else if (await pathExists(join(dir, ".mcp.json"))) {
    out.push({ type: "mcp", name: "mcp" });
  }
  // Antigravity (`agy`) plugins put hooks + MCP at the plugin root as
  // `hooks.json` / `mcp_config.json` (vs Claude's `hooks/hooks.json` / `.mcp.json`).
  // Guarded so a plugin carrying both layouts isn't counted twice.
  if (out.every((c) => c.type !== "hook") && (await pathExists(join(dir, "hooks.json")))) {
    out.push({ type: "hook", name: "hooks" });
  }
  if (out.every((c) => c.type !== "mcp")) {
    const agyMcp = await readJson<{ mcpServers?: Record<string, unknown> }>(
      join(dir, "mcp_config.json"),
    );
    if (agyMcp?.mcpServers && Object.keys(agyMcp.mcpServers).length > 0) {
      for (const name of Object.keys(agyMcp.mcpServers)) out.push({ type: "mcp", name });
    } else if (await pathExists(join(dir, "mcp_config.json"))) {
      out.push({ type: "mcp", name: "mcp" });
    }
  }
  if (await pathExists(join(dir, ".lsp.json"))) out.push({ type: "lsp", name: "lsp" });
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Store readers → a flat per-store row, later merged by name                */
/* -------------------------------------------------------------------------- */

/** One plugin as seen in a single store — before the merge-by-name. Exported
 *  so the manager can resolve each store's exact `name@marketplace` ref + scope
 *  for native remove/enable (they can differ between stores). */
export interface PluginStoreRow {
  name: string;
  marketplace: string | null;
  source: string | null;
  version: string | null;
  store: PluginStore;
  enabled: boolean;
  scope: PluginScope;
  installPath: string | null;
}

const SCOPE_RANK: Record<PluginScope, number> = { local: 3, project: 2, user: 1 };
function asScope(s: string | undefined): PluginScope {
  return s === "project" || s === "local" ? s : "user";
}

/** Split a "name@marketplace" ledger key (names may contain no '@'). */
function splitKey(key: string): { name: string; marketplace: string | null } {
  const at = key.lastIndexOf("@");
  return at === -1
    ? { name: key, marketplace: null }
    : { name: key.slice(0, at), marketplace: key.slice(at + 1) };
}

interface InstalledRecord {
  scope?: string;
  projectPath?: string;
  installPath?: string;
  version?: string;
}
interface InstalledLedger {
  plugins?: Record<string, InstalledRecord[]>;
}
interface KnownMarketplaces {
  [name: string]: { source?: { source?: string; repo?: string; path?: string } };
}

function marketplaceSource(km: KnownMarketplaces | null, mkt: string | null): string | null {
  const src = mkt ? km?.[mkt]?.source : undefined;
  if (!src) return null;
  if (src.source === "github" && src.repo) return src.repo;
  return src.path ?? null;
}

export async function readClaudeStore(projectPath: string): Promise<PluginStoreRow[]> {
  const ledger = await readJson<InstalledLedger>(
    join(claudeDir(), "plugins", "installed_plugins.json"),
  );
  if (!ledger?.plugins) return [];
  const km = await readJson<KnownMarketplaces>(
    join(claudeDir(), "plugins", "known_marketplaces.json"),
  );
  const settings = await readJson<{ enabledPlugins?: Record<string, boolean> }>(
    join(claudeDir(), "settings.json"),
  );
  const enabledMap = settings?.enabledPlugins ?? {};

  const out: PluginStoreRow[] = [];
  for (const [key, records] of Object.entries(ledger.plugins)) {
    // user-scope plugins apply everywhere; project/local only to their project.
    const relevant = records.filter(
      (r) => asScope(r.scope) === "user" || r.projectPath === projectPath,
    );
    if (relevant.length === 0) continue;
    // Most specific scope wins (local > project > user) for the badge.
    const best = relevant.reduce((a, b) =>
      SCOPE_RANK[asScope(b.scope)] > SCOPE_RANK[asScope(a.scope)] ? b : a,
    );
    const { name, marketplace } = splitKey(key);
    out.push({
      name,
      marketplace,
      source: marketplaceSource(km, marketplace),
      version: best.version ?? null,
      store: "claude",
      enabled: enabledMap[key] !== false, // present-and-true, or absent → enabled
      scope: asScope(best.scope),
      installPath: best.installPath ?? null,
    });
  }
  return out;
}

/** Parse the `[plugins."name@mkt"]` tables out of ~/.codex/config.toml. We only
 *  need the table keys + their `enabled` flag, so a line scan beats pulling in a
 *  full TOML parser (and matches "read the files directly"). */
export async function readCodexStore(): Promise<PluginStoreRow[]> {
  const file = Bun.file(join(codexDir(), "config.toml"));
  if (!(await file.exists())) return [];
  let text: string;
  try {
    text = await file.text();
  } catch {
    return [];
  }

  // ~/.agents/plugins/marketplace.json maps vercel-installed plugins → cache path.
  const mkt = await readJson<{
    plugins?: Array<{ name?: string; source?: { path?: string } }>;
  }>(join(homedir(), ".agents", "plugins", "marketplace.json"));
  const pathByName = new Map<string, string>();
  for (const p of mkt?.plugins ?? []) {
    if (p.name && p.source?.path) pathByName.set(p.name, p.source.path);
  }

  const rows: Array<{ key: string; enabled: boolean }> = [];
  let curKey: string | null = null;
  let curEnabled = true;
  const flush = () => {
    if (curKey) rows.push({ key: curKey, enabled: curEnabled });
    curKey = null;
    curEnabled = true;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const header =
      line.match(/^\[plugins\."(.+?)"\]$/) ?? line.match(/^\[plugins\.([^.\]"]+)\]$/);
    if (header) {
      flush();
      curKey = header[1]!;
      continue;
    }
    if (line.startsWith("[")) {
      flush(); // left the [plugins.*] table
      continue;
    }
    if (curKey) {
      const m = line.match(/^enabled\s*=\s*(true|false)/);
      if (m) curEnabled = m[1] === "true";
    }
  }
  flush();

  return rows.map(({ key, enabled }) => {
    const { name, marketplace } = splitKey(key);
    const rel = pathByName.get(name);
    return {
      name,
      marketplace,
      source: null,
      version: null,
      store: "codex" as const,
      enabled,
      scope: "user" as const, // codex installs are user-level
      installPath: rel
        ? isAbsolute(rel)
          ? rel
          : join(homedir(), rel.replace(/^\.\//, ""))
        : null,
    };
  });
}

/** Antigravity (`agy`) plugins are plain directories, each with a `plugin.json`
 *  marker, discovered by scanning two roots: the workspace `.agents/plugins/`
 *  (also `_agents/plugins/`) and the global `~/.gemini/config/plugins/`. We read
 *  them directly — no CLI. There is no per-plugin enabled flag in the on-disk
 *  layout, so a present directory is an active plugin. */
export async function readAntigravityStore(projectPath: string): Promise<PluginStoreRow[]> {
  const roots: Array<{ dir: string; scope: PluginScope }> = [
    { dir: join(projectPath, ".agents", "plugins"), scope: "project" },
    { dir: join(projectPath, "_agents", "plugins"), scope: "project" },
    { dir: join(homedir(), ".gemini", "config", "plugins"), scope: "user" },
  ];
  const rows: PluginStoreRow[] = [];
  const seen = new Set<string>(); // one row per name even if it appears in >1 root
  for (const { dir, scope } of roots) {
    for (const name of await listDir(dir, true)) {
      const pluginDir = join(dir, name);
      // `plugin.json` is the required marker; its `name` field is optional and
      // defaults to the directory name.
      if (!(await pathExists(join(pluginDir, "plugin.json")))) continue;
      const manifest = await readJson<{ name?: unknown }>(join(pluginDir, "plugin.json"));
      const pluginName =
        manifest && typeof manifest.name === "string" && manifest.name ? manifest.name : name;
      if (seen.has(pluginName)) continue;
      seen.add(pluginName);
      rows.push({
        name: pluginName,
        marketplace: null,
        source: null,
        version: null,
        store: "antigravity",
        enabled: true,
        scope,
        installPath: pluginDir,
      });
    }
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/*  Merge by name → the unified list                                          */
/* -------------------------------------------------------------------------- */

export async function listInstalledPlugins(
  projectPath: string,
): Promise<InstalledPluginInfo[]> {
  // The stores touch disjoint files (~/.claude, ~/.codex, .agents/plugins +
  // ~/.gemini/config/plugins) — read in parallel.
  const [claudeRows, codexRows, antigravityRows] = await Promise.all([
    readClaudeStore(projectPath),
    readCodexStore(),
    readAntigravityStore(projectPath),
  ]);
  const raws = [...claudeRows, ...codexRows, ...antigravityRows];

  const byName = new Map<string, PluginStoreRow[]>();
  for (const r of raws) {
    const group = byName.get(r.name);
    if (group) group.push(r);
    else byName.set(r.name, [r]);
  }

  const plugins = await Promise.all(
    [...byName.entries()].map(async ([name, group]) => {
      const stores = [...new Set(group.map((g) => g.store))];
      // Prefer the claude record for metadata (richest: source/version/path).
      const primary = group.find((g) => g.store === "claude") ?? group[0]!;
      const installPath = group.find((g) => g.installPath)?.installPath ?? null;
      const [components, files, description] = installPath
        ? await Promise.all([
            scanComponents(installPath),
            walkFiles(installPath),
            readDescription(installPath),
          ])
        : [[] as PluginComponentInfo[], [] as PluginFileInfo[], ""];
      return {
        name,
        description,
        marketplace: primary.marketplace,
        source: primary.source,
        version: primary.version,
        stores,
        agents: agentsForStores(stores),
        enabled: group.some((g) => g.enabled),
        scope: primary.scope,
        components,
        files,
      } satisfies InstalledPluginInfo;
    }),
  );

  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return plugins;
}
