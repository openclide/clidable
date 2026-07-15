import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../ui/Modal";
import { PluginCard } from "./PluginCard";
import { PluginDetail } from "./PluginDetail";
import { AddCustomForm } from "./AddCustomForm";
import {
  fetchDiscoverPlugins,
  fetchInstalledPlugins,
  installMarketplacePlugin,
} from "./api";
import {
  type AnyPlugin,
  type DiscoverPlugin,
  type InstalledPlugin,
  type PluginScope,
} from "./data";

type Tab = "installed" | "discover" | "custom";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "installed", label: "Installed" },
  { id: "discover", label: "Discover" },
  { id: "custom", label: "Add custom" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  projectPath: string;
}

export function PluginsModal({ open, onClose, projectPath }: Props) {
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [discoverPlugins, setDiscoverPlugins] = useState<DiscoverPlugin[]>([]);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load installed + available plugins whenever the modal opens (or the project
  // changes). Discover reads the marketplace files; both are local + fast.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchInstalledPlugins(projectPath), fetchDiscoverPlugins()])
      .then(([inst, disc]) => {
        if (cancelled) return;
        setInstalledPlugins(inst);
        setDiscoverPlugins(disc);
      })
      .catch((e: unknown) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, projectPath]);

  const installed = useFiltered(installedPlugins, query);
  const discover = useFiltered(discoverPlugins, query);
  const selected: AnyPlugin | null = useMemo(() => {
    if (!selectedId) return null;
    return (
      installedPlugins.find((p) => p.id === selectedId) ??
      discoverPlugins.find((p) => p.id === selectedId) ??
      null
    );
  }, [selectedId, installedPlugins, discoverPlugins]);
  // Flag Discover entries installed per (store, name) — the SAME plugin name can
  // exist in both the Claude and Codex catalogs, so a bare-name key would mark
  // the wrong store's card installed.
  const installedKeys = useMemo(
    () => new Set(installedPlugins.flatMap((p) => p.stores.map((s) => `${s}:${p.name}`))),
    [installedPlugins],
  );
  const discoverKey = (p: DiscoverPlugin) => `${p.store}:${p.name}`;

  // Install a plugin from a marketplace (Discover) → refresh installed so the
  // card flips to "Installed".
  const handleDiscoverInstall = async (
    p: DiscoverPlugin,
    scope: PluginScope = "user",
  ) => {
    if (installingKey) return;
    setInstallingKey(discoverKey(p));
    setError(null);
    try {
      setInstalledPlugins(
        await installMarketplacePlugin({
          projectPath,
          name: p.name,
          marketplace: p.marketplace,
          store: p.store,
          scope,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstallingKey(null);
    }
  };

  const setTabAndResetSearch = (next: Tab) => {
    setTab(next);
    setQuery("");
  };

  // After an add settles: refresh either way (a partial multi-store install
  // still changed disk), and jump to Installed only on full success.
  const handleDone = async (ok: boolean) => {
    try {
      setInstalledPlugins(await fetchInstalledPlugins(projectPath));
    } catch (e) {
      setError((e as Error).message);
    }
    if (ok) setTabAndResetSearch("installed");
  };

  // After a remove from the detail matrix: adopt the refreshed list, and if the
  // open plugin is gone from every store, return to the list.
  const handleMutated = (list: InstalledPlugin[]) => {
    setInstalledPlugins(list);
    if (selectedId && !list.some((p) => p.id === selectedId)) setSelectedId(null);
  };

  const handleClose = () => {
    onClose();
    setTimeout(() => setSelectedId(null), 200);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="xl"
      title={
        selected ? (
          <DetailTitle
            pluginName={selected.name}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <ListTitle />
        )
      }
    >
      {selected ? (
        <div className="max-h-[68vh] min-h-[480px] overflow-y-auto pr-1">
          <PluginDetail
            plugin={selected}
            projectPath={projectPath}
            onMutated={handleMutated}
            onInstall={handleDiscoverInstall}
            installing={installingKey === `${(selected as DiscoverPlugin).store}:${selected.name}`}
            alreadyInstalled={installedKeys.has(`${(selected as DiscoverPlugin).store}:${selected.name}`)}
          />
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <SegmentedTabs
              value={tab}
              onChange={setTabAndResetSearch}
              counts={{ installed: installedPlugins.length }}
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
                  placeholder="Search plugins…"
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
            {/* The list tabs share one loading/error state; the custom form
                renders regardless. */}
            {tab === "custom" ? (
              <AddCustomForm projectPath={projectPath} onDone={handleDone} />
            ) : loading ? (
              <StatusState title="Loading plugins…" />
            ) : error ? (
              <StatusState title="Couldn't load plugins." body={error} tone="error" />
            ) : tab === "installed" ? (
              <InstalledList
                items={installed}
                query={query}
                onBrowse={() => setTabAndResetSearch("discover")}
                onSelect={setSelectedId}
              />
            ) : (
              <DiscoverList
                items={discover}
                installedKeys={installedKeys}
                installingKey={installingKey}
                query={query}
                onInstall={handleDiscoverInstall}
                onSelect={setSelectedId}
              />
            )}
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
          <path d="M14 4.5a2.5 2.5 0 11-5 0H4.5v4.6a2.5 2.5 0 110 5V19h4.6a2.5 2.5 0 115 0H19v-4.6a2.5 2.5 0 110-5V4.5z" />
        </svg>
      </span>
      <span>Plugins</span>
    </span>
  );
}

function DetailTitle({
  pluginName,
  onBack,
}: {
  pluginName: string;
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
        aria-label="Back to plugins list"
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        <span>Plugins</span>
      </button>
      <span aria-hidden className="text-foreground/25">/</span>
      <span className="truncate font-mono text-[12.5px] text-foreground/85">
        {pluginName}
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
  onBrowse,
  onSelect,
}: {
  items: InstalledPlugin[];
  query: string;
  onBrowse: () => void;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title={query ? "No installed plugins match." : "No plugins installed yet."}
        body={
          query
            ? "Try different keywords or clear the search."
            : "Browse the Discover tab to find plugins, or add your own."
        }
        cta={query ? undefined : { label: "Browse plugins", onClick: onBrowse }}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((p) => (
        <li key={p.id}>
          <PluginCard
            variant="installed"
            plugin={p}
            onSelect={() => onSelect(p.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function DiscoverList({
  items,
  installedKeys,
  installingKey,
  query,
  onInstall,
  onSelect,
}: {
  items: DiscoverPlugin[];
  installedKeys: Set<string>;
  installingKey: string | null;
  query: string;
  onInstall: (p: DiscoverPlugin) => void;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No plugins match that search."
        body="Try different keywords."
      />
    );
  }
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {items.map((p) => {
        const key = `${p.store}:${p.name}`;
        return (
          <li key={p.id}>
            <PluginCard
              variant="discover"
              plugin={p}
              installed={installedKeys.has(key)}
              installing={installingKey === key}
              onInstall={() => onInstall(p)}
              onSelect={() => onSelect(p.id)}
            />
          </li>
        );
      })}
    </ul>
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
          <path d="M14 4.5a2.5 2.5 0 11-5 0H4.5v4.6a2.5 2.5 0 110 5V19h4.6a2.5 2.5 0 115 0H19v-4.6a2.5 2.5 0 110-5V4.5z" />
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

function StatusState({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body?: string;
  tone?: "neutral" | "error";
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p
        className={`text-sm font-medium ${tone === "error" ? "text-rose-200" : "text-foreground/85"}`}
      >
        {title}
      </p>
      {body && <p className="max-w-[360px] text-[11.5px] text-foreground/45">{body}</p>}
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
