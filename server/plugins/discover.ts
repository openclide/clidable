/**
 * Discover available plugins (PLAN.md §4) from two catalogs, read directly —
 * never by scraping a CLI:
 *
 *   • Claude marketplaces (store "claude", also Cursor):
 *       ~/.claude/plugins/known_marketplaces.json → each marketplace's
 *       <installLocation>/.claude-plugin/marketplace.json, enriched with real
 *       unique-install counts from install-counts-cache.json.
 *   • Codex official catalog (store "codex"): fetched from the hosted GitHub
 *       repo openai/plugins (the `openai-curated` marketplace). Codex's
 *       marketplaces aren't fully enumerable from local files (config.toml lists
 *       only some, OpenAI bundles the rest at runtime), so we fetch the
 *       canonical catalog over HTTP — same shape as a Claude marketplace repo.
 *
 * Marketplace entries carry metadata only (no component inventory — a plugin's
 * files land locally only on install). Codex entries also lack descriptions and
 * install counts. Install routes by `store` (see manager.installMarketplacePlugin):
 * Claude → `claude plugin install`, Codex → `codex plugin add`.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { DiscoverPluginInfo, PluginStore } from "../../shared/types";
import { readJson } from "./installed";

const claudePluginsDir = () => join(homedir(), ".claude", "plugins");

/** The Codex "openai-curated" marketplace, hosted on GitHub. */
const CODEX_CATALOG_URL =
  "https://raw.githubusercontent.com/openai/plugins/HEAD/.agents/plugins/marketplace.json";
const CODEX_MARKETPLACE = "openai-curated";

interface KnownMarketplaces {
  [name: string]: { installLocation?: string };
}
interface MarketplaceSource {
  source?: string;
  url?: string;
  repo?: string;
  path?: string;
}
interface MarketplaceFile {
  plugins?: Array<{
    name?: string;
    description?: string;
    category?: string;
    source?: MarketplaceSource;
  }>;
}
interface CountsCache {
  counts?: Array<{ plugin?: string; unique_installs?: number }>;
}

/** A display "owner/repo" (or path) for a marketplace plugin's source. */
function pluginSource(src: MarketplaceSource | undefined, fallback: string): string {
  if (!src) return fallback;
  if (src.repo) return src.repo;
  if (src.url) {
    return src.url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  }
  return src.path ?? fallback;
}

type CatalogEntry = { name?: string; description?: string; category?: string };

/** Map a marketplace catalog entry → DiscoverPluginInfo. Entries carry metadata
 *  only; `components` is scanned post-install, so it's empty here. */
function toDiscoverInfo(
  p: CatalogEntry,
  o: { marketplace: string; store: PluginStore; source: string; installs: number },
): DiscoverPluginInfo {
  return {
    id: `${o.marketplace}/${p.name}`,
    name: p.name!,
    description: p.description ?? "",
    marketplace: o.marketplace,
    store: o.store,
    source: o.source,
    category: p.category ?? "",
    installs: o.installs,
    components: [],
  };
}

/** Plugins offered by the configured Claude marketplaces, with real install
 *  counts. */
async function readClaudeMarketplaces(): Promise<DiscoverPluginInfo[]> {
  const known = await readJson<KnownMarketplaces>(
    join(claudePluginsDir(), "known_marketplaces.json"),
  );
  if (!known) return [];

  const countsCache = await readJson<CountsCache>(
    join(claudePluginsDir(), "install-counts-cache.json"),
  );
  const counts = new Map<string, number>();
  for (const c of countsCache?.counts ?? []) {
    if (c.plugin && typeof c.unique_installs === "number") {
      counts.set(c.plugin, c.unique_installs);
    }
  }

  const out: DiscoverPluginInfo[] = [];
  for (const [mkt, entry] of Object.entries(known)) {
    if (!entry.installLocation) continue;
    const file = await readJson<MarketplaceFile>(
      join(entry.installLocation, ".claude-plugin", "marketplace.json"),
    );
    for (const p of file?.plugins ?? []) {
      if (!p.name) continue;
      out.push(
        toDiscoverInfo(p, {
          marketplace: mkt,
          store: "claude",
          source: pluginSource(p.source, mkt),
          installs: counts.get(`${p.name}@${mkt}`) ?? 0,
        }),
      );
    }
  }
  return out;
}

// Cache the GitHub fetch — the catalog changes rarely and the modal opens often.
let codexCache: { at: number; data: DiscoverPluginInfo[] } | null = null;
let codexInflight: Promise<DiscoverPluginInfo[]> | null = null;
const CODEX_TTL_OK = 10 * 60 * 1000;
const CODEX_TTL_FAIL = 30 * 1000; // short, so a transient failure recovers fast

/** The Codex official catalog (openai/plugins), fetched from GitHub. Cached,
 *  single-flight (concurrent callers share one fetch), and failure-tolerant:
 *  keeps the last good result, else short-caches empty so an outage doesn't
 *  re-hit GitHub on every modal open. */
async function fetchCodexCatalog(): Promise<DiscoverPluginInfo[]> {
  if (codexCache) {
    const ttl = codexCache.data.length ? CODEX_TTL_OK : CODEX_TTL_FAIL;
    if (Date.now() - codexCache.at < ttl) return codexCache.data;
  }
  if (codexInflight) return codexInflight; // single-flight on a cold/expired cache
  codexInflight = (async () => {
    try {
      const res = await fetch(CODEX_CATALOG_URL, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = (await res.json()) as MarketplaceFile;
      const data = (file.plugins ?? [])
        .filter((p) => p.name)
        .map((p) =>
          toDiscoverInfo(p, {
            marketplace: CODEX_MARKETPLACE,
            store: "codex",
            source: "openai/plugins",
            installs: 0, // Codex's catalog has no install counts
          }),
        );
      codexCache = { at: Date.now(), data };
      return data;
    } catch (e) {
      console.error("[plugins] codex catalog fetch failed:", (e as Error)?.message);
      if (codexCache?.data.length) return codexCache.data; // keep last good
      codexCache = { at: Date.now(), data: [] }; // short-cache empty (CODEX_TTL_FAIL)
      return [];
    } finally {
      codexInflight = null;
    }
  })();
  return codexInflight;
}

/** All available plugins across both ecosystems, most-installed first (Codex
 *  entries have no counts, so they sort after Claude's, then alphabetically). */
export async function listAvailablePlugins(): Promise<DiscoverPluginInfo[]> {
  const [claude, codex] = await Promise.all([
    readClaudeMarketplaces(),
    fetchCodexCatalog(),
  ]);
  return [...claude, ...codex].sort(
    (a, b) => b.installs - a.installs || a.name.localeCompare(b.name),
  );
}
