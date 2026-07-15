/**
 * MCP server discovery — dual live registries + the bundled featured catalog
 * (architecture ported from claude-code-chat, server-side like skills/search).
 *
 *   • Browse (no query): featured catalog first — instant, offline-safe — plus
 *     the curated registry (mcp.agent-tooling.dev), TTL-cached & single-flight
 *     like the Codex plugin catalog.
 *   • Search: fan out to BOTH registries in parallel (curated + the official
 *     registry.modelcontextprotocol.io), merge with locally-filtered featured
 *     entries, dedupe by id (featured → curated → official precedence), drop
 *     `ai.smithery/*` aggregators when real alternatives exist, and rank:
 *     exact/substring/token matches + a trusted-vendor-namespace boost.
 *
 * Registry entries are translated into ready-to-install config scaffolds:
 * `remotes` → http/sse + header names; `packages` → npx / uvx / docker stdio
 * + env-var names. Values for secrets are collected at install time.
 */
import type { DiscoverMcpInfo } from "../../shared/types";
import { FEATURED_MCP_SERVERS } from "./featured";

const CURATED_BASE = "https://mcp.agent-tooling.dev/api/v1/servers";
const OFFICIAL_BASE = "https://registry.modelcontextprotocol.io/v0.1/servers";
const FETCH_TIMEOUT_MS = 8_000;
const PAGE_LIMIT = 50;

/* -------------------------------------------------------------------------- */
/*  Registry entry → DiscoverMcpInfo                                          */
/* -------------------------------------------------------------------------- */

interface RegistryRemote {
  type?: string;
  url?: string;
  headers?: Array<{ name?: string }>;
}
interface RegistryPackage {
  registryType?: string;
  identifier?: string;
  environmentVariables?: Array<{ name?: string }>;
}
interface RegistryServer {
  name?: string;
  title?: string;
  description?: string;
  repository?: { url?: string };
  websiteUrl?: string;
  remotes?: RegistryRemote[];
  packages?: RegistryPackage[];
}
interface RegistryItem {
  server?: RegistryServer;
  _meta?: Record<string, { status?: string } | undefined>;
}

/** Launch config from a server's package list: the FIRST package with a
 *  runner we can actually launch wins (the official registry serves npm, pypi,
 *  oci AND nuget). A package type we can't run (e.g. mcpb binary bundles) is
 *  skipped rather than fabricated into a broken `npx` config — null means
 *  "not installable through us". */
function stdioLaunch(
  packages: RegistryPackage[],
  fallbackName: string,
): { command: string; args: string[]; pkg: RegistryPackage } | null {
  for (const pkg of packages) {
    const id = pkg.identifier || fallbackName;
    switch (pkg.registryType) {
      case "npm":
        return { command: "npx", args: ["-y", id], pkg };
      case "pypi":
        return { command: "uvx", args: [id], pkg };
      case "oci":
      case "docker":
        return { command: "docker", args: ["run", "-i", "--rm", id], pkg };
      case "nuget":
        // .NET's MCP runner (the registry's own install snippet for nuget).
        return { command: "dnx", args: [id, "--yes"], pkg };
      default:
        continue;
    }
  }
  return null;
}

/** Generic tail segments that make a terrible card title ("mcp"). */
const GENERIC_NAME_SEGMENTS = new Set(["mcp", "server", "mcp-server", "mcp_server"]);

/** Display name: registry `title` when present; else the id's tail — unless
 *  the tail is generic ("com.paypal.mcp/mcp"), where the vendor label of the
 *  reverse-DNS namespace reads far better ("paypal"). The official registry
 *  frequently omits `title` on exactly these vendor ids. */
function displayNameFor(s: RegistryServer): string {
  if (s.title) return s.title;
  const name = s.name!;
  const slash = name.indexOf("/");
  const tail = slash === -1 ? name : name.slice(slash + 1);
  if (!GENERIC_NAME_SEGMENTS.has(tail.toLowerCase())) return tail || name;
  const vendorLabel = (slash === -1 ? "" : name.slice(0, slash)).split(".")[1];
  return vendorLabel || tail || name;
}

/** Translate one registry item into our wire shape, or null when it's not an
 *  active, installable server (no remotes AND no packages). */
export function parseRegistryEntry(item: RegistryItem): DiscoverMcpInfo | null {
  const s = item.server ?? (item as RegistryServer);
  if (!s?.name) return null;
  const status =
    item._meta?.["io.modelcontextprotocol.registry/official"]?.status ?? "active";
  if (status !== "active") return null;

  const remotes = s.remotes ?? [];
  const packages = s.packages ?? [];
  if (remotes.length === 0 && packages.length === 0) return null;

  const base = {
    id: s.name,
    name: displayNameFor(s),
    description: s.description ?? "",
    url: s.repository?.url || s.websiteUrl || "",
  };

  // Prefer a remote (zero-install) over a local package, like the registries'
  // own install snippets do.
  const remote = remotes.find((r) => r.url);
  if (remote) {
    return {
      ...base,
      transport: remote.type === "sse" ? "sse" : "http",
      command: null,
      args: [],
      serverUrl: remote.url!,
      headerNames: (remote.headers ?? [])
        .map((h) => h.name)
        .filter((n): n is string => !!n),
      envNames: [],
    };
  }

  // null when packages is empty (a url-less remote passes the emptiness guard
  // above but misses the remote branch) or no package has a runnable type.
  const launch = stdioLaunch(packages, s.name);
  if (!launch) return null;
  const envNames = (launch.pkg.environmentVariables ?? [])
    .map((ev) => ev.name)
    .filter((n): n is string => !!n);
  let args = launch.args;
  // Docker doesn't forward the CLI process env into the container — each var
  // needs an explicit `-e NAME` (value inherited from the process env the
  // agent sets from the install-time config).
  if (launch.command === "docker" && envNames.length > 0) {
    const image = args[args.length - 1]!;
    args = [...args.slice(0, -1), ...envNames.flatMap((n) => ["-e", n]), image];
  }
  return {
    ...base,
    transport: "stdio",
    command: launch.command,
    args,
    serverUrl: null,
    headerNames: [],
    envNames,
  };
}

/* -------------------------------------------------------------------------- */
/*  Ranking                                                                   */
/* -------------------------------------------------------------------------- */

/** Official/vendor namespaces boosted above look-alike community servers. */
const TRUSTED_PREFIXES = [
  "com.supabase/", "io.github.github/", "com.stripe/", "com.vercel/",
  "io.github.vercel/", "com.notion/", "app.linear/", "com.atlassian/",
  "com.cloudflare.", "io.github.getsentry/", "io.github.mongodb-js/",
  "io.github.railwayapp/", "com.postman/", "com.slack/", "com.neon/",
  "com.figma/", "dev.firecrawl/", "com.netlify/", "com.resend/", "ai.exa/",
  "com.airtable/", "com.apify/", "com.mux/", "com.render/",
];
const SMITHERY_PREFIX = "ai.smithery/";

/** Query-relevance score: exact id > id substring > name > description, plus
 *  per-token hits, a trusted-namespace boost, and a smithery demotion. */
export function rankRegistryResult(query: string, entry: DiscoverMcpInfo): number {
  const q = query.trim().toLowerCase();
  const id = entry.id.toLowerCase();
  const name = entry.name.toLowerCase();
  const desc = entry.description.toLowerCase();
  const haystack = `${id} ${name} ${desc}`;
  let score = 0;

  if (q) {
    if (id === q) score += 800;
    if (id.includes(q)) score += 350;
    if (name.includes(q)) score += 250;
    if (desc.includes(q)) score += 120;

    const tokens = q.split(/[^a-z0-9]+/).filter(Boolean);
    const haystackTokens = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean));
    for (const t of tokens) {
      if (haystackTokens.has(t)) score += 60;
      else if (t.length >= 3 && haystack.includes(t)) score += 20;
    }
  }

  if (TRUSTED_PREFIXES.some((p) => id.startsWith(p))) score += 500;
  if (id.startsWith(SMITHERY_PREFIX)) score -= 500;
  return score;
}

/* -------------------------------------------------------------------------- */
/*  Registry fetches                                                          */
/* -------------------------------------------------------------------------- */

async function fetchRegistry(base: string, query?: string): Promise<DiscoverMcpInfo[]> {
  const url =
    `${base}?version=latest&limit=${PAGE_LIMIT}` +
    (query ? `&search=${encodeURIComponent(query)}` : "");
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`registry ${new URL(base).host} failed (${res.status})`);
  const data = (await res.json()) as { servers?: RegistryItem[] };
  return (data.servers ?? [])
    .map((item) => {
      // Untrusted network JSON: one malformed entry must not reject the
      // whole registry's results.
      try {
        return parseRegistryEntry(item);
      } catch {
        return null;
      }
    })
    .filter((e): e is DiscoverMcpInfo => e !== null);
}

// Browse cache for the curated registry — TTL + single-flight, like the Codex
// plugin catalog (plugins/discover.ts): the modal opens often, the catalog
// changes rarely, and an outage must not re-hit the network on every open.
// `ok` (not data presence) picks the TTL: a failure that kept last-good data
// still retries on the short TTL, and every failure is stamped so sequential
// opens during an outage don't each block on a fresh fetch.
let curatedCache: { at: number; ok: boolean; data: DiscoverMcpInfo[] } | null = null;
let curatedInflight: Promise<DiscoverMcpInfo[]> | null = null;
const CURATED_TTL_OK = 10 * 60 * 1000;
const CURATED_TTL_FAIL = 30 * 1000;

async function fetchCuratedCatalog(): Promise<DiscoverMcpInfo[]> {
  if (curatedCache) {
    const ttl = curatedCache.ok ? CURATED_TTL_OK : CURATED_TTL_FAIL;
    if (Date.now() - curatedCache.at < ttl) return curatedCache.data;
  }
  if (curatedInflight) return curatedInflight;
  curatedInflight = (async () => {
    try {
      const data = await fetchRegistry(CURATED_BASE);
      curatedCache = { at: Date.now(), ok: true, data };
      return data;
    } catch (e) {
      console.error("[mcp] curated registry fetch failed:", (e as Error)?.message);
      // Keep last-good data but stamp the failure, so the short TTL governs
      // the next retry instead of a fetch per open for the whole outage.
      curatedCache = { at: Date.now(), ok: false, data: curatedCache?.data ?? [] };
      return curatedCache.data;
    } finally {
      curatedInflight = null;
    }
  })();
  return curatedInflight;
}

/* -------------------------------------------------------------------------- */
/*  Browse + search                                                           */
/* -------------------------------------------------------------------------- */

/** Dedupe by id, first occurrence wins (callers order by precedence). */
function dedupeById(entries: DiscoverMcpInfo[]): DiscoverMcpInfo[] {
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

/** How long browse waits for a cold curated-registry fetch before answering
 *  with the featured list alone. The fetch keeps running (single-flight) and
 *  warms the cache, so the next open gets the extras instantly. */
const BROWSE_CURATED_BUDGET_MS = 1_500;

/** The rest-state catalog: featured first (instant even fully offline), plus
 *  TRUSTED extras from the curated registry. The registry's unfiltered default
 *  page is a recency feed (arbitrary new publications), and it lists some
 *  featured products under different ids (com.context7/context7 vs the
 *  featured io.github.upstash/context7) — so extras must pass the trusted
 *  prefixes AND not collide with a featured entry by id, vendor namespace, or
 *  display name, or the "Popular servers" pane fills with junk + dupe cards.
 *  A slow/cold registry never delays the bundled entries past the budget. */
export async function browseMcpServers(): Promise<DiscoverMcpInfo[]> {
  const curated = await Promise.race([
    fetchCuratedCatalog(),
    new Promise<DiscoverMcpInfo[]>((resolve) =>
      setTimeout(() => resolve([]), BROWSE_CURATED_BUDGET_MS),
    ),
  ]);
  const featuredIds = new Set(FEATURED_MCP_SERVERS.map((f) => f.id));
  const featuredNamespaces = new Set(
    FEATURED_MCP_SERVERS.map((f) => f.id.split("/")[0]!.toLowerCase()),
  );
  const featuredNames = new Set(
    FEATURED_MCP_SERVERS.map((f) => f.name.toLowerCase()),
  );
  const extras = curated
    .filter((c) => {
      const id = c.id.toLowerCase();
      return (
        TRUSTED_PREFIXES.some((p) => id.startsWith(p)) &&
        !featuredIds.has(c.id) &&
        !featuredNamespaces.has(id.split("/")[0]!) &&
        !featuredNames.has(c.name.toLowerCase())
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...FEATURED_MCP_SERVERS, ...extras];
}

/** Live search across both registries + the featured catalog. Tolerates one
 *  registry being down; throws only when both fail AND nothing matched
 *  locally (so the UI can distinguish "no results" from "search broken"). */
export async function searchMcpServers(query: string): Promise<DiscoverMcpInfo[]> {
  const q = query.trim().toLowerCase();
  // Local pool = featured + whatever the browse cache already knows, so a
  // server visible in the rest-state list stays findable by name during a
  // registry outage (the cache is a peek — never a fetch — on this path).
  const local = dedupeById([
    ...FEATURED_MCP_SERVERS,
    ...(curatedCache?.data ?? []),
  ]).filter(
    (s) =>
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  );

  const settled = await Promise.allSettled([
    fetchRegistry(CURATED_BASE, query),
    fetchRegistry(OFFICIAL_BASE, query),
  ]);
  const remote = settled
    .filter((r): r is PromiseFulfilledResult<DiscoverMcpInfo[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);
  if (remote.length === 0 && settled.every((r) => r.status === "rejected")) {
    if (local.length === 0) {
      throw new Error((settled[0] as PromiseRejectedResult).reason?.message ?? "registry search failed");
    }
    return local; // degraded: registries down, featured matches still useful
  }

  let merged = dedupeById([...local, ...remote]);

  // Drop smithery aggregator shims whenever any real alternative matched.
  if (merged.some((s) => !s.id.startsWith(SMITHERY_PREFIX))) {
    merged = merged.filter((s) => !s.id.startsWith(SMITHERY_PREFIX));
  }

  return merged.sort(
    (a, b) =>
      rankRegistryResult(query, b) - rankRegistryResult(query, a) ||
      a.id.localeCompare(b.id),
  );
}
