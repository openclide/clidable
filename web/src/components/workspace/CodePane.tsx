/**
 * Code mode body — sidebar on the left with a Files | Changes toggle,
 * editor stack or diff view on the right. Mounted when SidePane is in
 * "code" mode.
 *
 * Layout:
 *   ┌─────────────────────┬──────────────────────────┐
 *   │ [Files] [Changes]   │  Files panel:            │
 *   │                     │    EditorTabs + Stack    │
 *   │  (tree or list)     │  Changes panel:          │
 *   │                     │    GitDiffPane           │
 *   └─────────────────────┴──────────────────────────┘
 *
 * State scope: per-project everything. Open tabs and the diff
 * selection both survive a project switch + return so the user comes
 * back to where they were.
 *
 * Both sides of the cross-fade stay mounted across panel switches —
 * losing the editor tab stack (or the diff cache + open file) every
 * time you peek at the other panel would be jarring. Inactive
 * subtrees get `opacity-0 pointer-events-none` and an `aria-hidden`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MockProject } from "../welcome/data";
import { subscribeToFileChanges } from "../../lib/file-watch-client";
import { invalidateRoot } from "../../lib/code-mirror/diff-cache";
import { ChangesList, type GitStatusEntry } from "./ChangesList";
import {
  subscribeRevealChanges,
  useDiffBase,
} from "../../lib/diff-base-store";
import { EditorStack } from "./EditorStack";
import { EditorTabs } from "./EditorTabs";
import { FileExplorer } from "./FileExplorer";
import { GitDiffPane } from "./GitDiffPane";
import { TerminalGlyph } from "./TerminalGlyph";

export interface Tab {
  path: string;
  dirty: boolean;
}

interface ProjectTabs {
  tabs: Tab[];
  activeIndex: number;
}

interface ActiveDiff {
  path: string;
  badge: string;
}

type Panel = "files" | "changes";

const EMPTY: ProjectTabs = { tabs: [], activeIndex: -1 };

const STATUS_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  "??": "Untracked",
};

interface Props {
  project: MockProject;
  /** Desktop: whether the file explorer column is shown (toggled from the
   *  SidePane toolbar). Ignored on mobile, where it's a slide-over drawer. */
  explorerOpen?: boolean;
  /** Dev-server terminal sheet state + toggle — surfaced in the mobile chrome
   *  row (on desktop it lives in the SidePane toolbar instead). */
  termOpen?: boolean;
  onToggleTerminal?: () => void;
}

export function CodePane({
  project,
  explorerOpen = true,
  termOpen = false,
  onToggleTerminal,
}: Props) {
  /* ---- Files-panel state: open editor tabs per project ---- */
  const [tabState, setTabState] = useState<Map<string, ProjectTabs>>(
    () => new Map(),
  );
  const currentTabs = tabState.get(project.id) ?? EMPTY;
  const activeTab =
    currentTabs.activeIndex >= 0
      ? currentTabs.tabs[currentTabs.activeIndex]
      : null;

  /* ---- Changes-panel state: diff selection + refresh nonces ---- */
  const [diffSelectionByProject, setDiffSelectionByProject] = useState<
    Map<string, ActiveDiff>
  >(() => new Map());
  const [diffNonceByProject, setDiffNonceByProject] = useState<
    Map<string, number>
  >(() => new Map());
  const [statusNonceByProject, setStatusNonceByProject] = useState<
    Map<string, number>
  >(() => new Map());

  const diffSelection = diffSelectionByProject.get(project.id) ?? null;
  const diffNonce = diffNonceByProject.get(project.id) ?? 0;
  const statusNonce = statusNonceByProject.get(project.id) ?? 0;
  // Comparison base from the shared store (set by the SincePicker or
  // the composer's compare action). `undefined`/`null` → diff against
  // the project's real-git HEAD; an object → a shadow-repo checkpoint.
  const diffBase = useDiffBase(project.path) ?? null;

  /* ---- Panel toggle ---- */
  const [panel, setPanel] = useState<Panel>("files");

  // The composer's "compare against this checkpoint" action fires a
  // reveal intent; pull this pane to the Changes panel in response.
  // (SidePane handles switching to Code mode; WorkspaceScreen handles
  // switching the previewed project.) One CodePane instance persists
  // across project switches, so reacting to any reveal is correct —
  // the previewed project is about to be the revealed one.
  //
  // We also remember the revealed project path so the next status
  // load for *that* project auto-selects its first changed file (one
  // click to a visible diff instead of two). Stored in a ref because
  // the consumption happens in an async load callback.
  const pendingAutoSelectRef = useRef<string | null>(null);
  useEffect(() => {
    return subscribeRevealChanges((projectPath) => {
      setPanel("changes");
      pendingAutoSelectRef.current = projectPath;
    });
  }, []);

  /* ---- Tab list mutations ---- */
  const updateTabs = useCallback(
    (mut: (prev: ProjectTabs) => ProjectTabs) => {
      setTabState((prev) => {
        const next = new Map(prev);
        const before = next.get(project.id) ?? EMPTY;
        next.set(project.id, mut(before));
        return next;
      });
    },
    [project.id],
  );

  const openFile = useCallback(
    (path: string) => {
      updateTabs((prev) => {
        const existing = prev.tabs.findIndex((t) => t.path === path);
        if (existing >= 0) return { ...prev, activeIndex: existing };
        return {
          tabs: [...prev.tabs, { path, dirty: false }],
          activeIndex: prev.tabs.length,
        };
      });
    },
    [updateTabs],
  );

  const activateTab = useCallback(
    (index: number) => {
      updateTabs((prev) =>
        index < 0 || index >= prev.tabs.length
          ? prev
          : { ...prev, activeIndex: index },
      );
    },
    [updateTabs],
  );

  const closeTab = useCallback(
    (index: number) => {
      updateTabs((prev) => {
        if (index < 0 || index >= prev.tabs.length) return prev;
        const tab = prev.tabs[index];
        if (
          tab?.dirty &&
          !window.confirm(
            `Discard unsaved changes to ${displayName(tab.path)}?`,
          )
        ) {
          return prev;
        }
        const tabs = [...prev.tabs.slice(0, index), ...prev.tabs.slice(index + 1)];
        let activeIndex: number;
        if (tabs.length === 0) activeIndex = -1;
        else if (index < prev.activeIndex) activeIndex = prev.activeIndex - 1;
        else if (index === prev.activeIndex)
          activeIndex = Math.min(index, tabs.length - 1);
        else activeIndex = prev.activeIndex;
        return { tabs, activeIndex };
      });
    },
    [updateTabs],
  );

  const closeActive = useCallback(() => {
    if (currentTabs.activeIndex < 0) return;
    closeTab(currentTabs.activeIndex);
  }, [closeTab, currentTabs.activeIndex]);

  const setDirty = useCallback(
    (path: string, dirty: boolean) => {
      updateTabs((prev) => {
        const idx = prev.tabs.findIndex((t) => t.path === path);
        if (idx < 0) return prev;
        const existing = prev.tabs[idx];
        if (!existing || existing.dirty === dirty) return prev;
        const tabs = [...prev.tabs];
        tabs[idx] = { ...existing, dirty };
        return { ...prev, tabs };
      });
    },
    [updateTabs],
  );

  /* ---- Diff selection + refresh ---- */
  const onPickChange = useCallback(
    (entry: GitStatusEntry) => {
      const badge = pickBadge(entry);
      setDiffSelectionByProject((prev) => {
        const next = new Map(prev);
        next.set(project.id, { path: entry.path, badge });
        return next;
      });
    },
    [project.id],
  );

  // After ChangesList loads, auto-select the first changed file if a
  // compare-reveal for this project is pending — so the diff appears
  // in one click. Matching on project.path ensures we only act on the
  // load for the revealed project, not a stale one.
  const onEntriesLoaded = useCallback(
    (entries: GitStatusEntry[]) => {
      if (pendingAutoSelectRef.current !== project.path) return;
      pendingAutoSelectRef.current = null;
      const first = entries[0];
      if (first) onPickChange(first);
    },
    [project.path, onPickChange],
  );

  const bumpDiff = useCallback(() => {
    // Drop the LRU before bumping the nonce — otherwise the re-fetch
    // path inside GitDiffPane short-circuits to stale content.
    invalidateRoot(project.path);
    setDiffNonceByProject((prev) => {
      const next = new Map(prev);
      next.set(project.id, (next.get(project.id) ?? 0) + 1);
      return next;
    });
  }, [project.id, project.path]);

  const bumpStatus = useCallback(() => {
    setStatusNonceByProject((prev) => {
      const next = new Map(prev);
      next.set(project.id, (next.get(project.id) ?? 0) + 1);
      return next;
    });
  }, [project.id]);

  const onRefreshChanges = useCallback(() => {
    // ChangesList already kicked off its own status reload when the
    // user clicked refresh; we only need to refresh the diff side.
    bumpDiff();
  }, [bumpDiff]);

  // Auto-refresh on entering the Changes panel. Bumps both the diff
  // and the status fetch so edits made in the Files panel (or by an
  // agent in the terminal) show up the moment the user switches over.
  const prevPanelRef = useRef<Panel>(panel);
  useEffect(() => {
    if (prevPanelRef.current !== "changes" && panel === "changes") {
      bumpDiff();
      bumpStatus();
    }
    prevPanelRef.current = panel;
  }, [panel, bumpDiff, bumpStatus]);

  // Auto-refresh on any file event. The watcher fires for agent edits
  // via PTY, checkpoint restores, manual file mutations from a
  // terminal — every disk write surfaces here. The editor handles its
  // own buffer reload via useDocument; we bump the diff + status
  // nonces so the changes-list and any open diff see the new state.
  //
  // We don't filter on which path changed: any change might affect
  // the status or the diff (a new file shows up; a delete removes a
  // row; an unrelated edit doesn't bump anything visible but the
  // re-fetch is cheap and idempotent). The active event (project
  // became live or WS reconnected) gets the same refresh treatment.
  useEffect(() => {
    return subscribeToFileChanges(project.path, () => {
      bumpDiff();
      bumpStatus();
    });
  }, [project.path, bumpDiff, bumpStatus]);

  // Mobile: the explorer is a slide-over drawer. Opening a file or picking a
  // change dismisses it so the editor (or diff) gets the full width.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const handleOpenFile = useCallback(
    (path: string) => {
      openFile(path);
      setDrawerOpen(false);
    },
    [openFile],
  );
  const handlePickChange = useCallback(
    (entry: GitStatusEntry) => {
      onPickChange(entry);
      setDrawerOpen(false);
    },
    [onPickChange],
  );
  // CodePane persists across project switches, so a drawer left open for one
  // project would otherwise slide over the next project's editor on switch.
  useEffect(() => setDrawerOpen(false), [project.id]);

  return (
    // Column so the mobile-only Files bar can stack above the explorer/editor
    // row. On desktop the bar is hidden and this is effectively the old layout.
    <div className="relative flex h-full min-h-0 flex-col p-2">
      {/* Mobile-only single chrome row: the Files/Changes toggle. The explorer
          is a slide-over drawer (not a fixed column), so tapping a segment both
          selects the panel and opens the drawer to browse. Hidden ≥ md, where
          the toggle lives at the top of the static sidebar instead. */}
      <div className="mb-2 flex shrink-0 items-center gap-2 md:hidden">
        <PanelToggle
          value={panel}
          onChange={(p) => {
            setPanel(p);
            setDrawerOpen(true);
          }}
        />
        {onToggleTerminal && (
          <button
            type="button"
            onClick={onToggleTerminal}
            aria-pressed={termOpen}
            title={termOpen ? "Hide dev-server terminal" : "Show dev-server terminal"}
            aria-label={termOpen ? "Hide dev-server terminal" : "Show dev-server terminal"}
            className={`ml-auto flex size-7 shrink-0 items-center justify-center rounded-xl transition-colors duration-150 ${
              termOpen
                ? "bg-white/[0.1] text-foreground"
                : "bg-white/[0.025] text-foreground/55 hover:bg-white/[0.05] hover:text-foreground"
            }`}
          >
            <TerminalGlyph />
          </button>
        )}
      </div>

      {/* Explorer + editor row. `relative` so the mobile drawer + scrim anchor
          here rather than over the whole screen. */}
      <div className="relative flex min-h-0 flex-1">
        {/* Scrim behind the drawer (mobile only, while open). */}
        {drawerOpen && (
          <div
            aria-hidden
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 z-20 bg-black/40 md:hidden"
          />
        )}

        {/* ──── Left: aside — a slide-over drawer on mobile; on desktop a static
             220px column, hidden when collapsed via the SidePane toolbar. ──── */}
        <aside
          className={`
            absolute inset-y-0 left-0 z-30 w-[80%] max-w-[300px]
            flex flex-col overflow-hidden rounded-lg
            border border-white/[0.06]
            bg-background/90
            shadow-[0_8px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl
            transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
            ${drawerOpen ? "translate-x-0" : "-translate-x-[110%]"}
            ${
              explorerOpen
                ? "md:static md:z-auto md:w-[220px] md:max-w-none md:shrink-0 md:translate-x-0 md:bg-white/[0.02] md:shadow-none md:backdrop-blur-none"
                : "md:hidden"
            }
          `}
        >
          {/* Desktop: Files/Changes toggle at the top of the static sidebar.
              On mobile the same toggle lives in the chrome row above. */}
          <div className="hidden shrink-0 border-b border-white/[0.04] p-1.5 md:block">
            <PanelToggle value={panel} onChange={setPanel} />
          </div>
          <div className="relative min-h-0 flex-1">
            <CrossFade visible={panel === "files"}>
              <FileExplorer
                root={project.path}
                activePath={activeTab?.path ?? null}
                onOpenFile={handleOpenFile}
              />
            </CrossFade>
            <CrossFade visible={panel === "changes"}>
              <ChangesList
                root={project.path}
                activePath={diffSelection?.path ?? null}
                onPick={handlePickChange}
                onRefresh={onRefreshChanges}
                reloadNonce={statusNonce}
                fromCheckpointSha={diffBase?.sha ?? null}
                onEntriesLoaded={onEntriesLoaded}
              />
            </CrossFade>
          </div>
        </aside>

        <div
          aria-hidden
          className={`hidden w-2 shrink-0 ${explorerOpen ? "md:block" : "md:hidden"}`}
        />

        {/* ──── Right: section with editor vs diff cross-fade ──── */}
        <section
        className="
          relative flex min-w-0 flex-1 flex-col overflow-hidden
          rounded-lg border border-white/[0.06] bg-white/[0.015]
        "
      >
        <CrossFade visible={panel === "files"}>
          {currentTabs.tabs.length > 0 ? (
            <div className="flex h-full min-h-0 flex-col">
              <EditorTabs
                tabs={currentTabs.tabs}
                activeIndex={currentTabs.activeIndex}
                onActivate={activateTab}
                onClose={closeTab}
              />
              <div className="min-h-0 flex-1">
                <EditorStack
                  projectId={project.id}
                  root={project.path}
                  tabs={currentTabs.tabs}
                  activeIndex={currentTabs.activeIndex}
                  onDirtyChange={setDirty}
                  onCloseActive={closeActive}
                />
              </div>
            </div>
          ) : (
            <EmptyFiles />
          )}
        </CrossFade>
        <CrossFade visible={panel === "changes"}>
          {diffSelection ? (
            <GitDiffPane
              key={`${project.id}|${diffBase?.sha ?? "head"}|${diffSelection.path}`}
              source={
                diffBase
                  ? {
                      kind: "checkpoint",
                      root: project.path,
                      sha: diffBase.sha,
                      path: diffSelection.path,
                    }
                  : {
                      kind: "working",
                      root: project.path,
                      path: diffSelection.path,
                    }
              }
              chipLabel={
                STATUS_LABELS[diffSelection.badge] ?? diffSelection.badge
              }
              refreshNonce={diffNonce}
            />
          ) : (
            <EmptyChanges />
          )}
        </CrossFade>
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function PanelToggle({
  value,
  onChange,
}: {
  value: Panel;
  onChange: (p: Panel) => void;
}) {
  const PANELS: Array<{ id: Panel; label: string }> = [
    { id: "files", label: "Files" },
    { id: "changes", label: "Changes" },
  ];
  const activeIndex = PANELS.findIndex((p) => p.id === value);
  // Same geometry as SidePane's Segmented — `2px` of inset on each
  // side so the sliding indicator's edges meet the button edges.
  const sliceWidth = `calc((100% - 4px) / ${PANELS.length})`;
  return (
    <div className="relative flex h-7 items-center rounded-xl bg-white/[0.025] p-0.5">
      <span
        aria-hidden
        className="
          absolute inset-y-0.5 rounded-lg
          bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]
          transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        "
        style={{
          left: 2,
          width: sliceWidth,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {PANELS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className={`
            relative z-[1] flex h-full min-w-[64px] flex-1 items-center justify-center
            rounded-lg px-3 text-[12px] tracking-tight
            transition-colors duration-150
            ${
              p.id === value
                ? "text-foreground"
                : "text-foreground/55 hover:text-foreground/85"
            }
          `}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Absolute-positioned cross-fade child. Both children stay mounted at
 * all times so neither EditorStack nor GitDiffPane loses its state on
 * a panel toggle.
 */
function CrossFade({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={`
        absolute inset-0
        transition-opacity duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        ${visible ? "opacity-100" : "pointer-events-none opacity-0"}
      `}
    >
      {children}
    </div>
  );
}

function pickBadge(entry: GitStatusEntry): string {
  const x = entry.indexStatus;
  const y = entry.workingStatus;
  if (x === "?" && y === "?") return "??";
  if (y === "D" || x === "D") return "D";
  if (x === "R" || y === "R") return "R";
  if (x === "A") return "A";
  if (x === "M" || y === "M") return "M";
  return x + y;
}

function displayName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function EmptyFiles() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <div className="text-[12.5px] text-foreground/65">No file open</div>
      <div className="text-[11px] text-foreground/40">
        Pick one from the file explorer.
      </div>
    </div>
  );
}

function EmptyChanges() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <div className="text-[12.5px] text-foreground/65">No file selected</div>
      <div className="text-[11px] text-foreground/40">
        Pick a change from the Changes list.
      </div>
    </div>
  );
}
