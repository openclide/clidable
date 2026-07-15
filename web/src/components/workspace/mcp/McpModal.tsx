import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../ui/Modal";
import { McpCard } from "./McpCard";
import { McpDetail } from "./McpDetail";
import { AddCustomForm, type McpInstallRequest } from "./AddCustomForm";
import {
  fetchDiscoverMcps,
  fetchInstalledMcps,
  installMcp,
  removeMcp,
} from "./api";
import type { McpScope, McpServerSpec } from "@shared/types";
import type { AnyMcp, DiscoverMcp, InstalledMcp } from "./data";
import type { AgentId } from "../../welcome/data";

/** Live registry search kicks in at this query length (matches skills). */
const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 250;

type Tab = "installed" | "discover" | "custom";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "installed", label: "Installed" },
  { id: "discover", label: "Discover" },
  { id: "custom", label: "Add custom" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Active project root — MCP configs are read/written here. */
  projectPath?: string;
}

export function McpModal({ open, onClose, projectPath }: Props) {
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The exact Discover entry the user clicked. Detail resolution must NOT
  // re-find by id across catalog/search lists — ids collide across sources,
  // and results landing after the click would silently swap the open detail.
  const [selectedDiscover, setSelectedDiscover] = useState<DiscoverMcp | null>(null);
  // Scope the detail opens on (the row the user clicked, or "project" default).
  const [detailScope, setDetailScope] = useState<McpScope>("project");
  const [projectMcps, setProjectMcps] = useState<InstalledMcp[]>([]);
  const [globalMcps, setGlobalMcps] = useState<InstalledMcp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Discover: the featured+curated catalog at rest, live registry results
  // while searching. Catalog and search keep separate error/loading states so
  // neither clobbers the other; `catalog === null` means "still loading".
  const [catalog, setCatalog] = useState<DiscoverMcp[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [discoverResults, setDiscoverResults] = useState<DiscoverMcp[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // Load both scopes (the list shows them together, tagged).
  const reload = async () => {
    if (!projectPath) return;
    const [proj, glob] = await Promise.all([
      fetchInstalledMcps(projectPath, "project"),
      fetchInstalledMcps(projectPath, "global"),
    ]);
    setProjectMcps(proj);
    setGlobalMcps(glob);
  };

  useEffect(() => {
    if (!open || !projectPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    reload()
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectPath]);

  // Fetch the rest-state catalog on open (server-cached; featured renders even
  // when the curated registry is unreachable — only the local server being
  // down fails this).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCatalogError(null);
    // Keep a previously-loaded catalog through the refetch; only an
    // empty/failed previous state goes back to null → "Loading catalog…"
    // (the modal stays mounted across close/reopen, so state persists).
    setCatalog((prev) => (prev && prev.length > 0 ? prev : null));
    fetchDiscoverMcps()
      .then((servers) => !cancelled && setCatalog(servers))
      .catch((e) => {
        if (cancelled) return;
        // Don't clobber good data with a failed refetch; with nothing to
        // show, leave "loading" and let the error state own the pane.
        setCatalog((prev) => prev ?? []);
        setCatalogError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Live dual-registry search on the Discover tab (debounced). Below the
  // threshold the locally-filtered catalog covers it.
  const searching = tab === "discover" && query.trim().length >= SEARCH_MIN_CHARS;
  useEffect(() => {
    if (!searching) {
      setDiscoverResults([]);
      setDiscoverError(null);
      setDiscoverLoading(false);
      return;
    }
    let cancelled = false;
    // Clear the previous query's results up front: stale hits must never
    // render under the new query's "Search results" header (the catalog-local
    // fallback covers the loading window), and a failed fetch must land on an
    // EMPTY list so the error state is reachable.
    setDiscoverResults([]);
    setDiscoverLoading(true);
    setDiscoverError(null);
    const handle = setTimeout(() => {
      fetchDiscoverMcps(query.trim())
        .then((servers) => !cancelled && setDiscoverResults(servers))
        .catch((e) => !cancelled && setDiscoverError((e as Error).message))
        .finally(() => !cancelled && setDiscoverLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searching, query]);

  // Installed list shows both scopes, project first, each row tagged.
  const allInstalled = useMemo(
    () => [...projectMcps, ...globalMcps],
    [projectMcps, globalMcps],
  );
  // Installed rows first (a detail upgrades to the live installed shape once
  // installed), else the captured clicked object — never a find() over the
  // discover lists, whose ids collide across sources.
  const selected = selectedId
    ? allInstalled.find((m) => m.id === selectedId) ??
      (selectedDiscover?.id === selectedId ? selectedDiscover : null)
    : null;
  const installed = useFiltered(allInstalled, query);
  // While a search is in flight, show catalog matches instantly (local-first);
  // registry results replace them when they land.
  const catalogLoading = catalog === null;
  const catalogLocal = useFiltered(catalog ?? [], query);
  const discover = searching
    ? discoverLoading && discoverResults.length === 0
      ? catalogLocal
      : discoverResults
    : catalogLocal;
  const installedIds = useMemo(
    () => new Set(allInstalled.map((m) => m.id)),
    [allInstalled],
  );

  /* --- mutations (per-agent install/remove for the selected server) --- */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);

  // Agents the selected server has per scope (live). Memoized so the detail
  // matrix's reseed effect doesn't fire on unrelated re-renders.
  const installedByScope = useMemo<Record<McpScope, AgentId[]>>(
    () => ({
      project: projectMcps.find((m) => m.id === selectedId)?.agents ?? [],
      global: globalMcps.find((m) => m.id === selectedId)?.agents ?? [],
    }),
    [projectMcps, globalMcps, selectedId],
  );

  const runMutation = async (key: string, fn: () => Promise<unknown>) => {
    if (!projectPath || busyKey) return;
    setBusyKey(key);
    setMutError(null);
    try {
      await fn();
    } catch (e) {
      setMutError((e as Error).message);
    } finally {
      await reload().catch(() => {});
      setBusyKey(null);
    }
  };

  // Build a server spec from a (Discover catalog) server + collected secrets.
  const catalogSpec = (
    server: AnyMcp,
    secrets: Record<string, string>,
  ): McpServerSpec =>
    server.transport === "stdio"
      ? { transport: "stdio", command: server.command, args: server.args ?? [], env: secrets }
      : { transport: server.transport, url: server.url, headers: secrets };

  // Detail Install/Apply, scoped. Fresh server (Discover): install the catalog
  // config (+ secrets) to the chosen agents in `scope`. Installed server: copy
  // onto newly-checked agents (config copied server-side, across scopes if
  // needed) and remove unchecked ones — within `scope`.
  const applyServer = (
    server: AnyMcp,
    scope: McpScope,
    toInstall: AgentId[],
    toRemove: AgentId[],
    secrets: Record<string, string>,
  ) =>
    runMutation(`${server.id}:apply`, async () => {
      const installedAnywhere =
        projectMcps.some((m) => m.id === server.id) ||
        globalMcps.some((m) => m.id === server.id);
      if (toInstall.length) {
        await installMcp({
          projectPath: projectPath!,
          scope,
          name: server.id,
          agents: toInstall,
          // Fresh server has no on-disk config to copy → use the catalog config.
          config: installedAnywhere ? undefined : catalogSpec(server, secrets),
        });
      }
      if (toRemove.length) {
        await removeMcp({ projectPath: projectPath!, scope, name: server.id, agents: toRemove });
      }
    });

  // Install a server defined in the Add-custom (manual) form, then jump to Installed.
  const addCustom = async (req: McpInstallRequest) => {
    if (!projectPath) throw new Error("no active project");
    await installMcp({
      projectPath,
      scope: req.scope,
      name: req.name,
      agents: req.agents,
      config: req.config,
    });
    await reload();
    setTab("installed");
  };

  // Open a server's detail, defaulting the scope toggle to where it was
  // clicked. Discover clicks pass the entry itself so the detail is pinned to
  // the exact clicked object.
  const openServer = (
    id: string,
    scope: McpScope = "project",
    discoverEntry: DiscoverMcp | null = null,
  ) => {
    setSelectedId(id);
    setSelectedDiscover(discoverEntry);
    setDetailScope(scope);
  };

  const setTabAndResetSearch = (next: Tab) => {
    setTab(next);
    setQuery("");
  };

  const handleClose = () => {
    onClose();
    setMutError(null);
    setTimeout(() => {
      setSelectedId(null);
      setSelectedDiscover(null);
    }, 200);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="xl"
      title={
        selected ? (
          <DetailTitle
            name={selected.name}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <ListTitle />
        )
      }
    >
      {mutError && (
        <MutationError message={mutError} onDismiss={() => setMutError(null)} />
      )}
      {selected ? (
        <div className="max-h-[68vh] min-h-[480px] overflow-y-auto pr-1">
          <McpDetail
            server={selected}
            installedByScope={installedByScope}
            defaultScope={detailScope}
            busyKey={busyKey}
            onApply={(scope, toInstall, toRemove, secrets) =>
              applyServer(selected, scope, toInstall, toRemove, secrets)
            }
          />
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <SegmentedTabs
              value={tab}
              onChange={setTabAndResetSearch}
              counts={{ installed: allInstalled.length }}
            />
            {tab !== "custom" && (
              <div className="ml-auto flex min-w-0 max-w-[260px] flex-1 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-1.5">
                <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/40">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search servers…"
                  className="
                    min-w-0 flex-1 bg-transparent
                    text-[12px] text-foreground
                    placeholder:text-foreground/30
                    outline-none
                  "
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="
                      shrink-0 text-foreground/40
                      hover:text-foreground/80
                      transition-colors
                    "
                  >
                    <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                      <path d="M6 6l12 12M6 18L18 6" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="max-h-[60vh] min-h-[480px] overflow-y-auto pr-1">
            {tab === "installed" && (
              <InstalledList
                items={installed}
                query={query}
                loading={loading}
                error={error}
                onBrowse={() => setTabAndResetSearch("discover")}
                onSelect={openServer}
              />
            )}
            {tab === "discover" && (
              <DiscoverList
                items={discover}
                installedIds={installedIds}
                searching={searching}
                loading={searching ? discoverLoading : catalogLoading}
                error={searching ? discoverError : catalogError}
                query={query}
                onInstall={(server) => openServer(server.id, "project", server)}
                onSelect={(server) => openServer(server.id, "project", server)}
              />
            )}
            {tab === "custom" && <AddCustomForm onInstall={addCustom} />}
          </div>
        </>
      )}
    </Modal>
  );
}

function ListTitle() {
  return (
    <span className="flex items-center gap-2">
      <span
        className="
          flex size-6 items-center justify-center rounded-lg
          border border-white/[0.08] bg-white/[0.04]
          text-foreground/75
        "
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 8V4M15 8V4" />
          <path d="M6 8h12v4a6 6 0 01-12 0V8z" />
          <path d="M12 18v3" />
        </svg>
      </span>
      <span>MCP servers</span>
    </span>
  );
}

function DetailTitle({
  name,
  onBack,
}: {
  name: string;
  onBack: () => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="
          flex items-center gap-1.5 rounded-md
          px-1.5 py-1 text-foreground/65
          hover:bg-white/[0.06] hover:text-foreground
          transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        "
        aria-label="Back to MCP list"
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        <span>MCP</span>
      </button>
      <span aria-hidden className="text-foreground/25">/</span>
      <span className="truncate font-mono text-[12.5px] text-foreground/85">
        {name}
      </span>
    </span>
  );
}

function SegmentedTabs({
  value,
  onChange,
  counts,
}: {
  value: Tab;
  onChange: (next: Tab) => void;
  counts?: Partial<Record<Tab, number>>;
}) {
  const activeIndex = TABS.findIndex((t) => t.id === value);
  return (
    <div className="relative flex h-8 shrink-0 items-center rounded-xl bg-white/[0.025] p-0.5">
      <span
        aria-hidden
        className="
          absolute inset-y-0.5 rounded-lg
          bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]
          transition-[transform,width] duration-250 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        "
        style={{
          left: 2,
          width: `calc((100% - 4px) / ${TABS.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {TABS.map((t) => {
        const count = counts?.[t.id];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`
              relative z-[1] flex h-full items-center gap-1.5 rounded-lg px-3
              text-[12px] tracking-tight
              transition-colors duration-200
              ${value === t.id ? "text-foreground" : "text-foreground/55 hover:text-foreground/85"}
            `}
          >
            <span>{t.label}</span>
            {count !== undefined && (
              <span
                className={`
                  shrink-0 rounded-full px-1.5 py-px text-[10px] tabular-nums
                  ${value === t.id ? "bg-white/[0.12] text-foreground/80" : "bg-white/[0.05] text-foreground/45"}
                `}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function InstalledList({
  items,
  query,
  loading,
  error,
  onBrowse,
  onSelect,
}: {
  items: InstalledMcp[];
  query: string;
  loading: boolean;
  error: string | null;
  onBrowse: () => void;
  onSelect: (id: string, scope: "project" | "global") => void;
}) {
  if (loading && items.length === 0) {
    return (
      <EmptyState
        title="Loading servers…"
        body="Reading MCP config from this project's agents."
      />
    );
  }
  if (error) {
    return <EmptyState title="Couldn't load servers." body={error} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={query ? "No installed servers match." : "No MCP servers installed yet."}
        body={
          query
            ? "Try different keywords or clear the search."
            : "Browse the Discover tab to find servers, or add your own."
        }
        cta={query ? undefined : { label: "Browse servers", onClick: onBrowse }}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((s) => (
        <li key={`${s.scope}:${s.id}`}>
          <McpCard
            variant="installed"
            server={s}
            onSelect={() => onSelect(s.id, s.scope)}
          />
        </li>
      ))}
    </ul>
  );
}

function DiscoverList({
  items,
  installedIds,
  searching,
  loading,
  error,
  query,
  onInstall,
  onSelect,
}: {
  items: DiscoverMcp[];
  installedIds: Set<string>;
  searching: boolean;
  loading: boolean;
  error: string | null;
  query: string;
  onInstall: (server: DiscoverMcp) => void;
  onSelect: (server: DiscoverMcp) => void;
}) {
  if (loading && items.length === 0) {
    return (
      <EmptyState
        title={searching ? "Searching registries…" : "Loading catalog…"}
        body={
          searching
            ? "Querying the MCP registries for matching servers."
            : "Fetching the featured server catalog."
        }
      />
    );
  }
  if (error && items.length === 0) {
    return (
      <EmptyState
        title={searching ? "Search failed." : "Couldn't load the catalog."}
        body={error}
      />
    );
  }
  if (items.length === 0) {
    // A short (sub-threshold) query that filters the catalog to nothing is a
    // filter miss, not a catalog problem — don't blame the catalog for it.
    const filterMiss = searching || query.trim().length > 0;
    return (
      <EmptyState
        title={filterMiss ? "No servers match that search." : "Catalog unavailable."}
        body={
          filterMiss
            ? "Try different keywords."
            : "The catalog came back empty — try reopening the modal."
        }
      />
    );
  }
  return (
    <>
      <p className="mb-2.5 text-[10.5px] uppercase tracking-wider text-foreground/35">
        {searching ? "Search results" : "Popular servers"}
      </p>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {items.map((s) => (
          <li key={s.id}>
            <McpCard
              variant="discover"
              server={s}
              installed={installedIds.has(s.id)}
              onInstall={() => onInstall(s)}
              onSelect={() => onSelect(s)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div
        className="
          flex size-10 items-center justify-center rounded-2xl
          border border-white/[0.08] bg-white/[0.03]
          text-foreground/40
        "
      >
        <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 8V4M15 8V4" />
          <path d="M6 8h12v4a6 6 0 01-12 0V8z" />
          <path d="M12 18v3" />
        </svg>
      </div>
      <p className="text-sm font-medium text-foreground/85">{title}</p>
      <p className="max-w-[320px] text-[11.5px] text-foreground/45">{body}</p>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="
            mt-2 rounded-lg
            border border-white/[0.1] bg-white/[0.04]
            px-3 py-1.5 text-[11.5px] text-foreground/85
            hover:border-white/[0.2] hover:bg-white/[0.07]
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
          "
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

function MutationError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-200">
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="shrink-0 text-rose-200/70 hover:text-rose-100"
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      </button>
    </div>
  );
}

function useFiltered<T extends { name: string; description: string }>(
  items: T[],
  q: string,
): T[] {
  return useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(needle) ||
        i.description.toLowerCase().includes(needle),
    );
  }, [items, q]);
}
