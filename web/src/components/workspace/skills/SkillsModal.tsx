import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "../../ui/Modal";
import { SkillCard } from "./SkillCard";
import { SkillDetail } from "./SkillDetail";
import { AddCustomForm } from "./AddCustomForm";
import {
  fetchFeaturedSkills,
  fetchInstalledSkills,
  installSkill,
  removeSkill,
  searchSkills,
} from "./api";
import {
  type AnySkill,
  type DiscoverSkill,
  type InstalledSkill,
} from "./data";
import {
  bucketsForAgents,
  hasSkillSource,
  type SkillBucket,
  type SkillScope,
} from "@shared/types";

/** Quick searches offered on the Discover tab at rest (no fake data). */
const SUGGESTED_SEARCHES = ["react", "next.js", "tailwind", "postgres", "testing", "security"];

/** Live-search kicks in at this query length (skills.sh requires ≥2). */
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
  /** Active project root — skills are scanned/installed here. */
  projectPath?: string;
}

export function SkillsModal({ open, onClose, projectPath }: Props) {
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  // The exact Discover entry the user clicked. Ids are bare folder names that
  // collide across repos (several "pdf"s), so detail resolution must never
  // re-find by id across featured/search lists — results landing after the
  // click would silently swap the open detail (and its install source).
  const [selectedDiscover, setSelectedDiscover] = useState<DiscoverSkill | null>(null);
  // Scope the detail matrix opens on (the row the user clicked from).
  const [detailScope, setDetailScope] = useState<SkillScope>("project");
  const [projectSkills, setProjectSkills] = useState<InstalledSkill[]>([]);
  const [globalSkills, setGlobalSkills] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Discover (skills.sh live search) — separate from the local installed filter.
  const [discoverResults, setDiscoverResults] = useState<DiscoverSkill[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  // Featured (bundled top of the skills.sh leaderboard) — the rest state.
  const [featured, setFeatured] = useState<DiscoverSkill[]>([]);

  // Load installed skills for BOTH scopes (the list shows them together,
  // tagged). Re-runs on open / project change / after a mutation.
  // Returns both scopes' installed skills (or null if no project). Callers set
  // state themselves so they can guard against a stale/cancelled load.
  const reload = useCallback(async () => {
    if (!projectPath) return null;
    const [proj, glob] = await Promise.all([
      fetchInstalledSkills(projectPath, "project"),
      fetchInstalledSkills(projectPath, "global"),
    ]);
    return { proj, glob };
  }, [projectPath]);

  useEffect(() => {
    if (!open || !projectPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    reload()
      .then((r) => {
        if (cancelled || !r) return; // ignore stale loads (project switched/closed)
        setProjectSkills(r.proj);
        setGlobalSkills(r.glob);
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, reload]);

  // Fetch the featured list once per open — it's the bundled leaderboard, so
  // this is a local round-trip, but keep the fetch cancellable anyway.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchFeaturedSkills()
      .then((skills) => !cancelled && setFeatured(skills))
      .catch(() => {}); // featured is best-effort — the search box still works
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Live-search the skills.sh registry on the Discover tab (debounced). Below
  // the threshold we show the featured set instead, so the box stays cheap.
  const searching = tab === "discover" && query.trim().length >= SEARCH_MIN_CHARS;
  useEffect(() => {
    if (!searching) {
      setDiscoverResults([]);
      setDiscoverError(null);
      setDiscoverLoading(false);
      return;
    }
    let cancelled = false;
    // Clear the previous query's results up front (mirrors McpModal): stale
    // hits must never render under the new query's header, and the
    // featured-local-first fallback covers the loading window.
    setDiscoverResults([]);
    setDiscoverLoading(true);
    setDiscoverError(null);
    const handle = setTimeout(() => {
      searchSkills(query.trim())
        .then((skills) => !cancelled && setDiscoverResults(skills))
        .catch((e) => !cancelled && setDiscoverError((e as Error).message))
        .finally(() => !cancelled && setDiscoverLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searching, query]);

  // Installed list shows BOTH scopes, project first, each row tagged.
  const allInstalled = useMemo(
    () => [...projectSkills, ...globalSkills],
    [projectSkills, globalSkills],
  );

  // Installed rows first (a detail upgrades to the installed shape, with
  // content, once installed), else the captured clicked object — never a
  // find() over featured/search lists, whose folder-name ids collide.
  const selectedSkill = selectedSkillId
    ? allInstalled.find((s) => s.id === selectedSkillId) ??
      (selectedDiscover?.id === selectedSkillId ? selectedDiscover : null)
    : null;

  // Buckets the selected skill occupies, per scope — drives the detail matrix.
  const installedByScope = useMemo(
    () => ({
      project: bucketsForAgents(
        projectSkills.find((s) => s.id === selectedSkillId)?.agents ?? [],
      ),
      global: bucketsForAgents(
        globalSkills.find((s) => s.id === selectedSkillId)?.agents ?? [],
      ),
    }),
    [projectSkills, globalSkills, selectedSkillId],
  );

  // Installed filters locally. Discover: the featured leaderboard at rest;
  // while a live search is in flight, featured matches show instantly
  // (local-first) and the skills.sh results replace them when they land.
  const installed = useFiltered(allInstalled, query);
  const featuredLocal = useFiltered(featured, query);
  const discover = searching
    ? discoverLoading && discoverResults.length === 0
      ? featuredLocal
      : discoverResults
    : featuredLocal;
  const installedIds = useMemo(
    () => new Set(allInstalled.map((s) => s.id)),
    [allInstalled],
  );

  /* --- mutations (install / remove) --- */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);

  const runMutation = async (
    key: string,
    fn: () => Promise<unknown>,
  ): Promise<void> => {
    if (!projectPath || busyKey) return;
    setBusyKey(key);
    setMutError(null);
    try {
      await fn();
    } catch (e) {
      setMutError((e as Error).message);
    } finally {
      // Always refresh from disk — even on error a multi-step apply may have
      // partially changed state, and the UI must reflect what's actually there.
      const r = await reload().catch(() => null);
      if (r) {
        setProjectSkills(r.proj);
        setGlobalSkills(r.glob);
      }
      setBusyKey(null);
    }
  };

  // One-click install from a Discover card → project scope, all buckets.
  const quickInstall = (s: DiscoverSkill) =>
    runMutation(`${s.id}:install`, () =>
      installSkill({
        projectPath: projectPath!,
        source: s.source,
        skillId: s.id,
        scope: "project",
        buckets: ["claude", "universal", "qwen"],
      }),
    );

  // Apply a scope's bucket selection: install newly-checked, remove unchecked.
  const applyBuckets = (
    s: AnySkill,
    scope: SkillScope,
    toInstall: SkillBucket[],
    toRemove: SkillBucket[],
  ) =>
    runMutation(`${s.id}:apply`, async () => {
      if (toInstall.length) {
        await installSkill({
          projectPath: projectPath!,
          source: s.source,
          skillId: s.id,
          scope,
          buckets: toInstall,
        });
      }
      for (const bucket of toRemove) {
        await removeSkill({ projectPath: projectPath!, name: s.id, scope, bucket });
      }
    });

  const openSkill = (
    id: string,
    fromScope: SkillScope,
    discoverEntry: DiscoverSkill | null = null,
  ) => {
    setSelectedSkillId(id);
    setSelectedDiscover(discoverEntry);
    setDetailScope(fromScope);
  };

  const setTabAndResetSearch = (next: Tab) => {
    setTab(next);
    setQuery("");
  };

  // When the modal closes, reset the detail nav so reopening lands on the list.
  const handleClose = () => {
    onClose();
    setMutError(null);
    // Slight defer so the close animation doesn't show the list flicker.
    setTimeout(() => {
      setSelectedSkillId(null);
      setSelectedDiscover(null);
    }, 200);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="xl"
      title={
        selectedSkill ? (
          <DetailHeaderTitle
            skillName={selectedSkill.name}
            onBack={() => setSelectedSkillId(null)}
          />
        ) : (
          <ListHeaderTitle />
        )
      }
    >
      {mutError && (
        <MutationError message={mutError} onDismiss={() => setMutError(null)} />
      )}
      {selectedSkill ? (
        <div className="max-h-[68vh] min-h-[480px] overflow-y-auto pr-1">
          <SkillDetail
            skill={selectedSkill}
            installedByScope={installedByScope}
            defaultScope={detailScope}
            installable={hasSkillSource(selectedSkill.source)}
            busyKey={busyKey}
            onApply={(scope, toInstall, toRemove) =>
              applyBuckets(selectedSkill, scope, toInstall, toRemove)
            }
          />
        </div>
      ) : (
        <>
          {/* Toolbar — tabs + search */}
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
                  placeholder="Search skills…"
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

          {/* Tab content. Constrained max-height with internal scroll. */}
          <div className="max-h-[60vh] min-h-[480px] overflow-y-auto pr-1">
            {tab === "installed" && (
              <InstalledList
                items={installed}
                query={query}
                loading={loading}
                error={error}
                onBrowse={() => setTabAndResetSearch("discover")}
                onSelect={openSkill}
              />
            )}
            {tab === "discover" && (
              <DiscoverList
                items={discover}
                installedIds={installedIds}
                searching={searching}
                loading={discoverLoading}
                error={discoverError}
                busyKey={busyKey}
                onInstall={quickInstall}
                onSelect={(skill) => openSkill(skill.id, "project", skill)}
                onPickSuggestion={setQuery}
              />
            )}
            {tab === "custom" && <AddCustomForm />}
          </div>
        </>
      )}
    </Modal>
  );
}

function ListHeaderTitle() {
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
          <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" />
        </svg>
      </span>
      <span>Skills</span>
    </span>
  );
}

function DetailHeaderTitle({
  skillName,
  onBack,
}: {
  skillName: string;
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
        aria-label="Back to skills list"
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        <span>Skills</span>
      </button>
      <span aria-hidden className="text-foreground/25">
        /
      </span>
      <span className="truncate font-mono text-[12.5px] text-foreground/85">
        {skillName}
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
  items: InstalledSkill[];
  query: string;
  loading: boolean;
  error: string | null;
  onBrowse: () => void;
  onSelect: (id: string, scope: SkillScope) => void;
}) {
  if (loading && items.length === 0) {
    return (
      <EmptyState
        title="Loading skills…"
        body="Reading installed skills from this project."
      />
    );
  }
  if (error) {
    return (
      <EmptyState title="Couldn't load skills." body={error} />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={query ? "No installed skills match." : "No skills installed yet."}
        body={
          query
            ? "Try different keywords or clear the search."
            : "Browse the Discover tab to find skills, or add your own."
        }
        cta={query ? undefined : { label: "Browse skills", onClick: onBrowse }}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((s) => (
        <li key={`${s.scope}:${s.id}`}>
          <SkillCard
            variant="installed"
            skill={s}
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
  busyKey,
  onInstall,
  onSelect,
  onPickSuggestion,
}: {
  items: DiscoverSkill[];
  installedIds: Set<string>;
  searching: boolean;
  loading: boolean;
  error: string | null;
  busyKey: string | null;
  onInstall: (skill: DiscoverSkill) => void;
  onSelect: (skill: DiscoverSkill) => void;
  onPickSuggestion: (query: string) => void;
}) {
  if (loading && items.length === 0) {
    return (
      <EmptyState title="Searching skills.sh…" body="Finding matching skills." />
    );
  }
  if (error) {
    return <EmptyState title="Search failed." body={error} />;
  }
  // At rest with nothing to show (featured failed to load): fall back to the
  // search prompt — the box and chips still work.
  if (!searching && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-foreground/40">
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </div>
        <p className="text-sm font-medium text-foreground/85">
          Search the skills.sh registry
        </p>
        <p className="max-w-[320px] text-[11.5px] text-foreground/45">
          34,000+ community skills. Type above, or try one of these:
        </p>
        <SuggestionChips onPick={onPickSuggestion} />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No skills match that search."
        body="Try different keywords."
      />
    );
  }
  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <p className="text-[10.5px] uppercase tracking-wider text-foreground/35">
          {searching ? "Search results" : "Popular on skills.sh"}
        </p>
        {!searching && (
          <span className="ml-auto">
            <SuggestionChips onPick={onPickSuggestion} compact />
          </span>
        )}
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {items.map((s) => (
          <li key={s.id}>
            <SkillCard
              variant="discover"
              skill={s}
              installed={installedIds.has(s.id)}
              installing={busyKey === `${s.id}:install`}
              onInstall={() => onInstall(s)}
              onSelect={() => onSelect(s)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function SuggestionChips({
  onPick,
  compact = false,
}: {
  onPick: (query: string) => void;
  compact?: boolean;
}) {
  return (
    <span
      className={
        compact
          ? "flex flex-wrap items-center gap-1"
          : "mt-1 flex flex-wrap justify-center gap-1.5"
      }
    >
      {SUGGESTED_SEARCHES.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onPick(q)}
          className={`
            rounded-full border border-white/[0.1] bg-white/[0.04]
            text-foreground/75
            hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-foreground
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
            ${compact ? "px-2 py-0.5 text-[10.5px]" : "px-3 py-1 text-[11.5px]"}
          `}
        >
          {q}
        </button>
      ))}
    </span>
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
          <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" />
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
    <div
      className="
        mb-3 flex items-start gap-2 rounded-xl
        border border-rose-400/30 bg-rose-500/10
        px-3 py-2 text-[11.5px] text-rose-200
      "
    >
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
