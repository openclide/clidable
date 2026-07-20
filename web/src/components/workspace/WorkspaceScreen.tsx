import { useEffect, useMemo, useRef, useState } from "react";
import { TopChrome } from "./TopChrome";
import { TerminalSplits } from "./TerminalSplits";
import { SidePane } from "./SidePane";
import { MobileChrome } from "./MobileChrome";
import { MobileViewBar, type MobileView } from "./MobileViewBar";
import { SkillsModal } from "./skills/SkillsModal";
import { PluginsModal } from "./plugins/PluginsModal";
import { McpModal } from "./mcp/McpModal";
import { TeamModal } from "./team/TeamModal";
import { ContextModal } from "./context/ContextModal";
import { useIsMobile, useKeyboardOpen } from "../../lib/use-media";
import {
  addTab,
  allLeaves,
  clearProject,
  findLeaf,
  flattenToTabs,
  insertTab,
  moveTab,
  nextPaneId,
  removeTab,
  renameTab,
  reservePaneIds,
  setActiveTab,
  setCollapsed,
  setTab,
  splitLeaf,
  type Pane,
  type PaneId,
  type TileTerminal,
} from "./paneTree";
import { AgentsDock, type DockEntry } from "./AgentsDock";
import { saveWorkspace, type WorkspaceFull } from "../../lib/workspaces-client";
import { getLastAgent, type Project } from "../../lib/projects-client";
import type { AgentId } from "../welcome/data";
import type { WorkspaceTool } from "./WorkspaceTools";
import { subscribeRevealChanges } from "../../lib/diff-base-store";
import { terminalClient } from "../../lib/terminal-client";
import { requestComposerFocus } from "../../lib/composer-focus";
import { subscribeTrayOpenAgent } from "../../lib/tray";

/* ---------------------------------------------------------------------------
 * Preview-pane sizing. The divider between the terminal and the preview drags
 * `previewPct` — the preview's width as a % of the workspace row. The extremes
 * are the old hidden/full states (0 / 100), with magnetic detents at ⅓ / ½ / ⅔
 * so the common splits are one flick away. Persisted so it survives reload.
 * ------------------------------------------------------------------------- */
const DEFAULT_PREVIEW_PCT = 45;
const PREVIEW_PCT_KEY = "clidable:preview-width-pct";
const COLLAPSE_AT = 12; // drag the preview below this → snap to hidden (0)
const FULL_AT = 88; // drag the preview above this → snap to full (100)
const SNAP_POINTS = [33.33, 50, 66.67] as const;
const SNAP_THRESHOLD = 4; // within this many % of a detent → snap to it
const KEY_STEP = 2; // arrow-key nudge size

function clampPct(p: number): number {
  return Math.max(0, Math.min(100, p));
}

/** Magnetic snap applied on drag release: collapse zones at the edges, detents
 *  at ⅓/½/⅔, free elsewhere. */
function snapPct(p: number): number {
  if (p <= COLLAPSE_AT) return 0;
  if (p >= FULL_AT) return 100;
  for (const s of SNAP_POINTS) {
    if (Math.abs(p - s) <= SNAP_THRESHOLD) return s;
  }
  return p;
}

/** A width we'll restore-to later (from hidden), clamped to a usable range. */
function expandedOrDefault(p: number): number {
  return p >= COLLAPSE_AT && p <= FULL_AT ? p : DEFAULT_PREVIEW_PCT;
}

function readStoredPct(): number {
  try {
    const raw = localStorage.getItem(PREVIEW_PCT_KEY);
    if (raw == null) return DEFAULT_PREVIEW_PCT;
    const n = Number(raw);
    return Number.isFinite(n) ? clampPct(n) : DEFAULT_PREVIEW_PCT;
  } catch {
    return DEFAULT_PREVIEW_PCT;
  }
}

function writeStoredPct(p: number): void {
  try {
    localStorage.setItem(PREVIEW_PCT_KEY, String(Math.round(p)));
  } catch {
    // best-effort — sizing is a UI nicety, not load-bearing
  }
}

interface Props {
  /** Full persisted state to restore. A fresh workspace has `tree === null` and
   *  the component seeds one terminal for its first project. */
  workspace: WorkspaceFull;
  onBack: () => void;
}

/**
 * A terminal collapsed into the dock, plus where it came from so restoring
 * can return it to its original pane and tab position rather than dumping it
 * into whichever pane happens to be focused. The origin is best-effort: if
 * that pane has since collapsed out of the tree (e.g. it was the pane's last
 * tab), restore falls back to the focused pane.
 */
interface MinimizedTerminal {
  tab: TileTerminal;
  origin: { paneId: PaneId; tabIndex: number };
}

/**
 * A terminal session id, unique per PTY. Persisted long-term (it keys the
 * durable record), so the suffix adds a short random tail to `Date.now()` —
 * two terminals opened in the same millisecond can't collide.
 */
function makeInstanceId(projectId: string, aid: AgentId): string {
  return `${projectId}-${aid}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0")}`;
}

/** The default single-terminal tree a fresh workspace seeds. */
function seedTree(projectId: string, agentId: AgentId): Pane {
  return {
    kind: "leaf",
    id: nextPaneId(),
    tabs: [{ projectId, agentId, instanceId: makeInstanceId(projectId, agentId) }],
    activeTabIndex: 0,
  };
}

/** Which project is active on restore — the stored one if it's still open, else
 *  the first open project. */
function initActiveProjectId(workspace: WorkspaceFull): string {
  const active = workspace.activeProjectId;
  if (active && workspace.projects.some((p) => p.id === active)) return active;
  return workspace.projects[0]?.id ?? "";
}

/**
 * Build the initial pane tree synchronously from the persisted workspace — no
 * async hydration, so there's no throwaway-spawn flash. A stored tree is used
 * as-is (advancing the pane-id counter past it); a null OR structurally broken
 * tree falls back to seeding one terminal for the first project. `reservePaneIds`
 * walks the whole tree, so it doubles as the structural check the old async path
 * did in a try/catch.
 */
function initPaneRoot(workspace: WorkspaceFull, activeProjectId: string): Pane {
  if (workspace.tree) {
    try {
      const tree = workspace.tree as Pane;
      reservePaneIds(tree);
      // Touch the tree so a malformed subtree throws here, not mid-render.
      allLeaves(tree);
      return tree;
    } catch {
      // corrupt / foreign saved tree — fall through to the seeded default
    }
  }
  const first = workspace.projects.find((p) => p.id === activeProjectId) ?? workspace.projects[0];
  return seedTree(first?.id ?? "", getLastAgent(activeProjectId));
}

/** Restore the minimized dock behind a structural guard — a malformed entry
 *  (no tab instanceId) is dropped rather than crashing the dock. */
function initMinimized(raw: unknown): MinimizedTerminal[] {
  if (!Array.isArray(raw)) return [];
  const out: MinimizedTerminal[] = [];
  for (const m of raw) {
    const tab = (m as { tab?: unknown })?.tab as TileTerminal | undefined;
    const origin = (m as { origin?: unknown })?.origin as
      | { paneId: PaneId; tabIndex: number }
      | undefined;
    if (
      tab &&
      typeof tab.instanceId === "string" &&
      typeof tab.projectId === "string" &&
      origin &&
      typeof origin.paneId === "string"
    ) {
      out.push({ tab, origin });
    }
  }
  return out;
}

/**
 * Multi-project workspace with a tmux-style pane tree. Each leaf can also
 * hold multiple tabs (multiplexed terminals in the same pane). The `+` in
 * each tile's header opens a 3-option menu: side / bottom / tab.
 *
 * Restores its full state (open projects, pane tree, minimized dock, active
 * project) synchronously from the `workspace` prop; every change autosaves back
 * to the workspace registry (debounced), so reload and Back both round-trip.
 */
export function WorkspaceScreen({ workspace, onBack }: Props) {
  // All state restored synchronously from the persisted workspace — the open
  // projects (in tab order, already resolved server-side), the active project,
  // the pane tree (or a seeded default), and the minimized dock. No async
  // hydration, so no throwaway terminal spawns before a real tree arrives.
  const [openProjects, setOpenProjects] = useState<Project[]>(() => workspace.projects);
  // Resolve the active project once and seed both dependent states from it.
  const initialActiveId = useMemo(() => initActiveProjectId(workspace), [workspace]);
  const [activeProjectId, setActiveProjectId] = useState(() => initialActiveId);
  const [paneRoot, setPaneRoot] = useState<Pane>(() =>
    initPaneRoot(workspace, initialActiveId),
  );
  const [focusedPaneId, setFocusedPaneId] = useState<PaneId>(
    () => allLeaves(paneRoot)[0]!.id,
  );

  // Terminals collapsed out of the pane tree into the dock strip. Their PTY
  // sessions keep running server-side (the retain protocol below exempts
  // them from the idle-session reaper); restoring re-attaches the stream.
  // Each carries its origin so restore lands it back where it came from.
  // Restored from the persisted workspace (behind a structural guard).
  const [minimized, setMinimized] = useState<MinimizedTerminal[]>(() =>
    initMinimized(workspace.minimized),
  );

  // Autosave the whole workspace snapshot (pane tree + open projects + active
  // project + minimized dock) so reload and Back both round-trip. A ref holds
  // the latest snapshot for the debounced save and the unmount flush.
  const savePayload = useMemo(
    () => ({
      tree: paneRoot,
      openProjects: openProjects.map((p) => p.id),
      activeProjectId,
      minimized,
    }),
    [paneRoot, openProjects, activeProjectId, minimized],
  );
  const saveRef = useRef(savePayload);
  saveRef.current = savePayload;
  // Skip the first autosave when we hydrated an existing tree (nothing changed
  // yet). A freshly-seeded workspace (tree was null) DOES persist immediately so
  // the seed sticks across an early reload.
  const skipFirstSaveRef = useRef(workspace.tree != null);
  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    const t = setTimeout(() => void saveWorkspace(workspace.id, saveRef.current), 500);
    return () => clearTimeout(t);
  }, [savePayload, workspace.id]);
  // Flush the latest snapshot on unmount (Back) so the last ≤500ms of edits
  // aren't lost when the debounced timer is cleared. Back is an in-app view
  // change (not a page unload), so this plain fetch completes in the background.
  useEffect(
    () => () => void saveWorkspace(workspace.id, saveRef.current),
    [workspace.id],
  );
  // A hard page teardown — tab/window close (incl. a secondary desktop window),
  // reload, or bfcache — is NOT a React unmount, so the flush above can be
  // cancelled with the page. `pagehide` is the last reliable beat to save; use
  // keepalive so the request survives the teardown.
  useEffect(() => {
    const flush = () =>
      void saveWorkspace(workspace.id, saveRef.current, { keepalive: true });
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [workspace.id]);

  // The dock (roster of all terminals) is hidden by default; the layout menu
  // toggles it. Minimizing anything forces it visible so nothing gets stranded.
  const [dockVisible, setDockVisible] = useState(false);

  // Preview width as a % of the workspace row (0 = hidden, 100 = full). The
  // divider drags this; the top-bar button toggles hidden ↔ last width.
  const [previewPct, setPreviewPct] = useState<number>(() => readStoredPct());
  const [dragging, setDragging] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const pctRef = useRef(previewPct); // latest pct mid-drag (for snap-on-release)
  const lastExpandedRef = useRef(expandedOrDefault(previewPct));
  const previewVisible = previewPct > 0;
  // Side-pane mode (Preview vs Code), lifted here so the top-bar layout menu
  // and the in-pane Segmented share one source of truth.
  const [previewMode, setPreviewMode] = useState<"preview" | "code">("preview");
  // The preview tracks the active project (the top-bar tabs) — switching the
  // active project moves the preview with it, and the in-pane selector drives
  // the same `activeProjectId`, so the two switchers stay connected.
  const [openTool, setOpenTool] = useState<WorkspaceTool | null>(null);

  // Dev-server terminal bottom sheet — lifted out of SidePane so the top-bar
  // layout menu can toggle it too (like previewMode/previewPct).
  const [termOpen, setTermOpen] = useState(false);

  // Mobile shell: below the phone breakpoint the layout flips from a draggable
  // split to a single active view switched by a floating bottom bar.
  const isMobile = useIsMobile();
  const keyboardOpen = useKeyboardOpen();
  const [mobileView, setMobileView] = useState<MobileView>("cli");

  const projectsById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of openProjects) m.set(p.id, p);
    return m;
  }, [openProjects]);

  // The composer's "compare against this checkpoint" action fires a
  // reveal intent with a project path. Surface that project's side
  // pane: make the preview visible + switch the previewed project to
  // it. (SidePane switches to Code mode; CodePane to the Changes
  // panel.) `openProjects` is read off a ref-free closure here, so we
  // re-subscribe when it changes to keep the path→id lookup fresh.
  useEffect(() => {
    return subscribeRevealChanges((projectPath) => {
      const match = openProjects.find((p) => p.path === projectPath);
      if (!match) return;
      // Surface the preview if it's collapsed, restoring its last width, and
      // pull it to Code mode (the compare action targets the Changes panel).
      setPreviewPct((cur) =>
        cur > 0 ? cur : lastExpandedRef.current || DEFAULT_PREVIEW_PCT,
      );
      setPreviewMode("code");
      setActiveProjectId(match.id);
    });
  }, [openProjects]);

  const leaves = useMemo(() => allLeaves(paneRoot), [paneRoot]);
  const allowClose = leaves.length > 1;

  // On mobile, side-by-side splits don't fit — collapse the tree to a single
  // pane whose tabs are every terminal. Only fires when entering mobile with a
  // real split present; once flat it no-ops (splits are disabled on mobile).
  useEffect(() => {
    if (!isMobile || paneRoot.kind !== "split") return;
    const flat = flattenToTabs(paneRoot, focusedPaneId);
    setPaneRoot(flat);
    setFocusedPaneId(flat.id);
  }, [isMobile, paneRoot, focusedPaneId]);

  // Reap orphaned PTYs. When a terminal leaves the pane tree — agent switch
  // (the instanceId changes), tab close, project close, or split-collapse — its
  // server-side session would otherwise linger forever. Diff the live
  // instanceIds against the previous set on every tree change and kill whatever
  // disappeared. Minimized terminals count as live (minimize ≠ close). Runs
  // post-commit (no stale-state read), and starts empty so it never kills on
  // first mount.
  const liveInstancesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set<string>();
    for (const leaf of leaves) {
      for (const tab of leaf.tabs) {
        if (tab) live.add(tab.instanceId);
      }
    }
    for (const m of minimized) live.add(m.tab.instanceId);
    for (const id of liveInstancesRef.current) {
      if (!live.has(id)) terminalClient.kill(id);
    }
    liveInstancesRef.current = live;
    // Declare ownership of every live session so the server's detach reaper
    // spares them even with no output subscriber (background tabs render no
    // TerminalView; minimized ones aren't in the tree at all).
    terminalClient.retain([...live]);
  }, [leaves, minimized]);

  // Leaving the workspace (Back → welcome screen) unmounts this component and
  // with it the pane tree + dock state — nothing can restore those sessions
  // anymore, so drop every retention or the reaper could never collect them
  // and the terminal client would hold a reconnect loop open forever.
  useEffect(() => () => terminalClient.retain([]), []);

  // Which sessions the user can actually see — each pane's active tab, while
  // the terminal grid is shown (desktop: preview not fullscreen; mobile: CLI
  // view) and the pane isn't collapsed. Used to highlight the current terminal
  // in the dock roster.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    const gridShown = isMobile ? mobileView === "cli" : previewPct < 100;
    if (gridShown) {
      for (const leaf of leaves) {
        if (leaf.collapsed) continue;
        const tab = leaf.tabs[Math.min(leaf.activeTabIndex, leaf.tabs.length - 1)];
        if (tab) ids.add(tab.instanceId);
      }
    }
    return ids;
  }, [leaves, isMobile, mobileView, previewPct]);

  // Every terminal in the workspace, for the dock roster: live tabs (with their
  // location so a click can jump to them) first, then minimized ones.
  const dockEntries = useMemo<DockEntry[]>(() => {
    const list: DockEntry[] = [];
    for (const leaf of leaves) {
      leaf.tabs.forEach((t, i) => {
        if (t)
          list.push({ terminal: t, minimized: false, paneId: leaf.id, tabIndex: i });
      });
    }
    for (const m of minimized) list.push({ terminal: m.tab, minimized: true });
    return list;
  }, [leaves, minimized]);
  // Compact composer typography when there are 2+ visible terminals
  // (panes with at least one tab).
  const totalTabs = useMemo(
    () => leaves.reduce((n, l) => n + l.tabs.length, 0),
    [leaves],
  );
  const compact = totalTabs > 1;

  const handleAddProject = (next: Project) => {
    if (openProjects.some((p) => p.id === next.id)) {
      setActiveProjectId(next.id);
      return;
    }
    setOpenProjects((prev) => [...prev, next]);
    setActiveProjectId(next.id);

    // Opening a project always lands you in a live terminal for it. Reuse a
    // never-assigned pane or empty tab slot if one's already open; otherwise
    // open a fresh tab in the focused leaf — so the project is never left as a
    // bare tab with no terminal behind it. Focus follows the new terminal.
    const terminal = {
      projectId: next.id,
      agentId: next.lastAgent,
      instanceId: makeInstanceId(next.id, next.lastAgent),
    };
    const emptyLeaf = leaves.find((l) => l.tabs.length === 0);
    if (emptyLeaf) {
      setPaneRoot((prev) => addTab(prev, emptyLeaf.id, terminal).tree);
      setFocusedPaneId(emptyLeaf.id);
      return;
    }
    const slotLeaf = leaves.find((l) => l.tabs.includes(null));
    if (slotLeaf) {
      const idx = slotLeaf.tabs.indexOf(null);
      // setTab fills the slot but doesn't move activeTabIndex, so also
      // activate it — otherwise the new terminal lands hidden behind whatever
      // tab is currently active in that leaf.
      setPaneRoot((prev) =>
        setActiveTab(setTab(prev, slotLeaf.id, idx, terminal), slotLeaf.id, idx),
      );
      setFocusedPaneId(slotLeaf.id);
      return;
    }
    const targetId = leaves.some((l) => l.id === focusedPaneId)
      ? focusedPaneId
      : leaves[0]!.id;
    setPaneRoot((prev) => addTab(prev, targetId, terminal).tree);
    setFocusedPaneId(targetId);
  };

  const handleCloseProject = (id: string) => {
    if (openProjects.length <= 1) return;
    setOpenProjects((prev) => prev.filter((p) => p.id !== id));
    setPaneRoot((prev) => clearProject(prev, id));
    // Closing a project also closes its minimized terminals — the live-set
    // diff above then kills their PTYs like any other removed tab.
    setMinimized((prev) => prev.filter((m) => m.tab.projectId !== id));
    if (activeProjectId === id) {
      const fallback = openProjects.find((p) => p.id !== id);
      if (fallback) setActiveProjectId(fallback.id);
    }
  };

  const handleSplit = (
    paneId: PaneId,
    direction: "row" | "column" | "tab",
  ) => {
    // No side-by-side splits on a phone — everything becomes a tab.
    if (isMobile) direction = "tab";
    if (direction === "tab") {
      // Add an empty tab to the leaf, switch focus to it. User fills it
      // via the EmptyPicker shown in the body.
      setPaneRoot((prev) => {
        const result = addTab(prev, paneId, null);
        return result.tree;
      });
      setFocusedPaneId(paneId);
      return;
    }
    const newId = nextPaneId();
    setPaneRoot((prev) => splitLeaf(prev, paneId, direction, newId));
    setFocusedPaneId(newId);
  };

  const handlePickForTab = (
    paneId: PaneId,
    tabIndex: number,
    next: { projectId: string; agentId: AgentId },
  ) => {
    const terminal = {
      projectId: next.projectId,
      agentId: next.agentId,
      instanceId: makeInstanceId(next.projectId, next.agentId),
    };
    setPaneRoot((prev) => {
      const leaf = findLeaf(prev, paneId);
      // If the leaf has no tabs yet, append; otherwise replace the slot at
      // tabIndex (used when the active tab is unassigned and the user
      // picks in the inline EmptyPicker).
      if (!leaf || leaf.tabs.length === 0) {
        return addTab(prev, paneId, terminal).tree;
      }
      return setTab(prev, paneId, tabIndex, terminal);
    });
    setFocusedPaneId(paneId);
  };

  const handleCloseTab = (paneId: PaneId, tabIndex: number) => {
    const next = removeTab(paneRoot, paneId, tabIndex);
    setPaneRoot(next);
    // Closing can collapse the focused leaf out of the tree — repair focus
    // outside the updater so it stays a pure transform.
    const nextLeaves = allLeaves(next);
    if (!nextLeaves.some((l) => l.id === focusedPaneId)) {
      setFocusedPaneId(nextLeaves[0]!.id);
    }
  };

  const handleSelectTab = (paneId: PaneId, tabIndex: number) => {
    setPaneRoot((prev) => setActiveTab(prev, paneId, tabIndex));
    setFocusedPaneId(paneId);
  };

  // Rename a tab (custom label overriding the agent name); null clears it. Lives
  // in the pane tree, so the workspace autosave persists it.
  const handleRenameTab = (paneId: PaneId, tabIndex: number, title: string | null) => {
    setPaneRoot((prev) => renameTab(prev, paneId, tabIndex, title));
  };

  // Collapse a pane to its header bar in place (or expand it back). The leaf
  // stays in the tree, so expanding restores the exact layout.
  const handleToggleCollapse = (paneId: PaneId) => {
    const leaf = findLeaf(paneRoot, paneId);
    if (!leaf) return;
    setPaneRoot((prev) => setCollapsed(prev, paneId, !leaf.collapsed));
    setFocusedPaneId(paneId);
  };

  // Dock clicked a live terminal — surface it: select its tab, focus its pane,
  // expand the pane if collapsed, and drop the cursor in its composer so you
  // can type straight away.
  const handleFocusTerminal = (paneId: PaneId, tabIndex: number) => {
    const tab = findLeaf(paneRoot, paneId)?.tabs[tabIndex];
    setPaneRoot((prev) =>
      setActiveTab(setCollapsed(prev, paneId, false), paneId, tabIndex),
    );
    setFocusedPaneId(paneId);
    if (tab) requestComposerFocus(tab.instanceId);
  };

  // Collapse a tab out of the tree into the dock. Both state updates land in
  // one batch, so the live-set diff sees the terminal move (not vanish) and
  // never kills its PTY.
  const handleMinimizeTab = (paneId: PaneId, tabIndex: number) => {
    const tab = findLeaf(paneRoot, paneId)?.tabs[tabIndex];
    if (!tab) return; // unassigned slots have nothing to keep alive
    setMinimized((prev) => [...prev, { tab, origin: { paneId, tabIndex } }]);
    handleCloseTab(paneId, tabIndex);
  };

  // Dock chip clicked — re-open the terminal in the pane and slot it was
  // minimized from. If that pane has since collapsed out of the tree, fall
  // back to the focused pane (or the first leaf) and append.
  const handleRestoreTerminal = (instanceId: string) => {
    const entry = minimized.find((m) => m.tab.instanceId === instanceId);
    if (!entry) return;
    setMinimized((prev) =>
      prev.filter((m) => m.tab.instanceId !== instanceId),
    );
    if (findLeaf(paneRoot, entry.origin.paneId)) {
      // Expand the origin pane too — if it was collapsed since the minimize,
      // the restored (now-active) tab would otherwise land hidden behind the
      // header bar.
      setPaneRoot((prev) =>
        setCollapsed(
          insertTab(prev, entry.origin.paneId, entry.origin.tabIndex, entry.tab),
          entry.origin.paneId,
          false,
        ),
      );
      setFocusedPaneId(entry.origin.paneId);
      requestComposerFocus(instanceId);
      return;
    }
    const targetId = leaves.some((l) => l.id === focusedPaneId)
      ? focusedPaneId
      : leaves[0]!.id;
    setPaneRoot((prev) => addTab(prev, targetId, entry.tab).tree);
    setFocusedPaneId(targetId);
    requestComposerFocus(instanceId);
  };

  // Dock chip's × — drop it from the dock; the live-set diff kills the PTY.
  const handleCloseMinimized = (instanceId: string) => {
    setMinimized((prev) => prev.filter((m) => m.tab.instanceId !== instanceId));
  };

  // Clicking an agent in the desktop tray → surface that exact terminal. The
  // tray only knows the session id (== instanceId); resolve it to a tab here,
  // restoring it from the dock if minimized. Returns whether it's ours so only
  // the owning window reveals itself (the event fans out to every window). A
  // ref holds the latest resolver so the tray listener subscribes just once.
  const openAgentRef = useRef<(instanceId: string) => boolean>(() => false);
  openAgentRef.current = (instanceId: string): boolean => {
    if (minimized.some((m) => m.tab.instanceId === instanceId)) {
      handleRestoreTerminal(instanceId);
      return true;
    }
    for (const leaf of leaves) {
      const idx = leaf.tabs.findIndex((t) => t?.instanceId === instanceId);
      if (idx >= 0) {
        handleFocusTerminal(leaf.id, idx);
        return true;
      }
    }
    return false;
  };
  useEffect(() => subscribeTrayOpenAgent((id) => openAgentRef.current(id)), []);

  // Mirror user-given tab names to the server so the desktop tray shows them
  // (the tray reads the server, which otherwise only knows the agent-type
  // name). Diff against the last-sent set: push new/changed names, clear ones
  // that lost their custom title. Covers rename, restore, and initial load.
  const sentLabelsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const now = new Map<string, string>();
    const add = (t: TileTerminal | null) => {
      const title = t?.title?.trim();
      if (t && title) now.set(t.instanceId, title);
    };
    for (const leaf of leaves) for (const t of leaf.tabs) add(t);
    for (const m of minimized) add(m.tab);
    const sent = sentLabelsRef.current;
    for (const [id, title] of now) {
      if (sent.get(id) !== title) terminalClient.setLabel(id, title);
    }
    for (const id of sent.keys()) {
      if (!now.has(id)) terminalClient.setLabel(id, null);
    }
    sentLabelsRef.current = now;
  }, [leaves, minimized]);

  // On unmount (leaving the workspace), drop the labels we mirrored so they
  // don't linger in the client and get re-sent forever after these tabs are
  // gone. The server clears its own copy when each session exits.
  useEffect(
    () => () => {
      for (const id of sentLabelsRef.current.keys()) terminalClient.dropLabel(id);
    },
    [],
  );

  // Drag & drop between/within panes. moveTab returns the original tree for
  // every no-op (including a vanished target), so the === check covers all
  // "nothing happened" cases and focus only follows real moves.
  const handleMoveTab = (
    from: { paneId: PaneId; tabIndex: number },
    to: { paneId: PaneId; tabIndex?: number },
  ) => {
    const next = moveTab(paneRoot, from, to);
    if (next === paneRoot) return;
    // A cross-pane move makes the tab the target's active tab; if that pane is
    // collapsed it'd land hidden, so surface it. A same-pane reorder keeps the
    // existing active tab, so it needn't force-expand.
    setPaneRoot(
      from.paneId === to.paneId ? next : setCollapsed(next, to.paneId, false),
    );
    setFocusedPaneId(to.paneId);
  };

  /* --- preview divider drag-to-resize --- */

  // Remember the last *visible* width so hide→show restores it.
  useEffect(() => {
    if (previewPct > 0) lastExpandedRef.current = expandedOrDefault(previewPct);
  }, [previewPct]);

  // Persist settled widths only (skip the flood of intermediate drag values).
  useEffect(() => {
    if (!dragging) writeStoredPct(previewPct);
  }, [previewPct, dragging]);

  // While dragging, follow the pointer on `window` (not the handle) so the
  // gesture keeps tracking even as the cursor crosses the preview iframe; a
  // full-window overlay (rendered below) keeps the iframe from swallowing it.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const el = mainRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pad = 12; // matches the row's px-3
      const left = rect.left + pad;
      const right = rect.right - pad;
      const width = Math.max(1, right - left);
      const pct = clampPct(((right - e.clientX) / width) * 100);
      pctRef.current = pct;
      setPreviewPct(pct);
    };
    const onUp = () => {
      setPreviewPct(snapPct(pctRef.current)); // magnetic snap on release
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    pctRef.current = previewPct;
    setDragging(true);
  };
  const resetSplit = () => setPreviewPct(DEFAULT_PREVIEW_PCT);
  const nudgeSplit = (e: React.KeyboardEvent) => {
    // Left widens the preview (handle moves left), right narrows it.
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPreviewPct((p) => clampPct(p + KEY_STEP));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPreviewPct((p) => clampPct(p - KEY_STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPreviewPct(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPreviewPct(100);
    }
  };
  // --- top-bar layout menu actions ---
  // A width that shows both panes (the side pane + terminal), for restoring.
  const restoreSplit = () => lastExpandedRef.current || DEFAULT_PREVIEW_PCT;

  // Pick the side-pane view. Switching views just ensures it's visible;
  // re-picking the already-active view hides the side pane (or, if the
  // terminal is hidden, drops full-preview back to a split so something stays).
  const selectPreviewView = (m: "preview" | "code") => {
    const wasActive = previewPct > 0 && previewMode === m;
    setPreviewMode(m);
    setPreviewPct((cur) =>
      wasActive ? (cur >= 100 ? restoreSplit() : 0) : cur > 0 ? cur : restoreSplit(),
    );
  };

  // Toggle the terminal/agents pane. Hiding it makes the preview full; can't
  // hide it when the side pane is already hidden (nothing would remain).
  const toggleAgents = () =>
    setPreviewPct((cur) =>
      cur < 100 ? (cur > 0 ? 100 : cur) : restoreSplit(),
    );

  const setPreviewSize = (pct: number) => setPreviewPct(clampPct(pct));

  // The dev-server terminal lives inside the side pane — opening it from the
  // top-bar layout menu also reveals the side pane if it's collapsed, so the
  // toggle is never a no-op.
  const toggleTerminal = () => {
    if (!termOpen && previewPct === 0) setPreviewPct(restoreSplit());
    setTermOpen((v) => !v);
  };

  const paneTransition = dragging
    ? ""
    : "transition-[flex-basis,opacity] duration-[400ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]";

  const activeProjectPath =
    openProjects.find((p) => p.id === activeProjectId)?.path ??
    openProjects[0]?.path ??
    "~";

  // Shared by both shells — the Agents Dock, a roster of every terminal. Hidden
  // by default (layout-menu toggle), but forced visible while anything is
  // minimized so a minimized terminal is never stranded off-screen. On desktop
  // it spans the full width below both panes; on mobile it sits under the CLI view.
  const dockShown = dockVisible || minimized.length > 0;
  const dock = (
    <AgentsDock
      entries={dockEntries}
      projectsById={projectsById}
      openProjects={openProjects}
      visibleIds={visibleIds}
      onActivate={(entry) => {
        if (entry.minimized) {
          handleRestoreTerminal(entry.terminal.instanceId);
        } else if (entry.paneId != null && entry.tabIndex != null) {
          handleFocusTerminal(entry.paneId, entry.tabIndex);
        }
      }}
      onCloseMinimized={handleCloseMinimized}
      onDropTerminal={(from) => handleMinimizeTab(from.paneId, from.tabIndex)}
    />
  );

  // Shared by both shells — the five workspace-tool overlays.
  const toolModals = (
    <>
      <SkillsModal open={openTool === "skills"} onClose={() => setOpenTool(null)} projectPath={activeProjectPath} />
      <PluginsModal open={openTool === "plugins"} onClose={() => setOpenTool(null)} projectPath={activeProjectPath} />
      <McpModal open={openTool === "mcp"} onClose={() => setOpenTool(null)} projectPath={activeProjectPath} />
      <TeamModal open={openTool === "team"} onClose={() => setOpenTool(null)} projectPath={activeProjectPath} />
      <ContextModal open={openTool === "context"} onClose={() => setOpenTool(null)} projectPath={activeProjectPath} />
    </>
  );

  // ── Mobile shell: collapsed top menus, one active view, floating bottom bar.
  if (isMobile) {
    return (
      <div className="flex w-screen flex-col" style={{ height: "100dvh" }}>
        <MobileChrome
          openProjects={openProjects}
          activeProjectId={activeProjectId}
          onSelectProject={setActiveProjectId}
          onCloseProject={handleCloseProject}
          onAddProject={handleAddProject}
          onBack={onBack}
          onOpenTool={setOpenTool}
        />

        <main
          className="flex min-h-0 flex-1 flex-col px-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }}
        >
          {/* All views stay mounted (hidden, not unmounted) so switching never
              kills the PTY, reloads the iframe, or drops editor state. */}
          <div
            className={`min-h-0 flex-1 ${mobileView === "cli" ? "flex flex-col" : "hidden"}`}
          >
            <div className="min-h-0 flex-1">
              <TerminalSplits
                root={paneRoot}
                projectsById={projectsById}
                openProjects={openProjects}
                activeProjectId={activeProjectId}
                focusedId={focusedPaneId}
                allowClose={allowClose}
                compact={compact}
                mobile
                onFocus={setFocusedPaneId}
                onPickForTab={handlePickForTab}
                onCloseTab={handleCloseTab}
                onSelectTab={handleSelectTab}
                onRenameTab={handleRenameTab}
                onSplit={handleSplit}
                onMinimizeTab={handleMinimizeTab}
                onToggleCollapse={handleToggleCollapse}
                onMoveTab={handleMoveTab}
                onExit={onBack}
              />
            </div>
            {dockShown && dock}
          </div>
          <div className={`min-h-0 flex-1 ${mobileView === "cli" ? "hidden" : ""}`}>
            <SidePane
              openProjects={openProjects}
              previewProjectId={activeProjectId}
              onPreviewProjectChange={setActiveProjectId}
              mode={mobileView === "code" ? "code" : "preview"}
              onModeChange={(m) => setMobileView(m)}
              termOpen={termOpen}
              onTermOpenChange={setTermOpen}
            />
          </div>
        </main>

        <MobileViewBar value={mobileView} onChange={setMobileView} hidden={keyboardOpen} />

        {toolModals}
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 w-screen flex-col">
      <TopChrome
        openProjects={openProjects}
        activeProjectId={activeProjectId}
        previewPct={previewPct}
        previewMode={previewMode}
        onSelectProject={setActiveProjectId}
        onCloseProject={handleCloseProject}
        onAddProject={handleAddProject}
        onSelectView={selectPreviewView}
        onToggleAgents={toggleAgents}
        onSetPreviewSize={setPreviewSize}
        termOpen={termOpen}
        onToggleTerminal={toggleTerminal}
        dockVisible={dockVisible}
        onToggleDock={() => setDockVisible((v) => !v)}
        onBack={onBack}
        onOpenTool={setOpenTool}
      />

      <main ref={mainRef} className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        {/* Top: the two-pane row (terminals | preview). The Agents Dock spans
            the full width below it. */}
        <div className="flex min-h-0 min-w-0 flex-1">
          <div
            className={`flex min-w-0 flex-col ${paneTransition}`}
            style={{ flex: `1 1 ${100 - previewPct}%` }}
          >
            <div className="min-h-0 flex-1">
              <TerminalSplits
                root={paneRoot}
                projectsById={projectsById}
                openProjects={openProjects}
                activeProjectId={activeProjectId}
                focusedId={focusedPaneId}
                allowClose={allowClose}
                compact={compact}
                onFocus={setFocusedPaneId}
                onPickForTab={handlePickForTab}
                onCloseTab={handleCloseTab}
                onSelectTab={handleSelectTab}
                onRenameTab={handleRenameTab}
                onSplit={handleSplit}
                onMinimizeTab={handleMinimizeTab}
                onToggleCollapse={handleToggleCollapse}
                onMoveTab={handleMoveTab}
                onExit={onBack}
              />
            </div>
          </div>

          <PaneResizer
            active={dragging}
            valueNow={previewPct}
            onPointerDown={startDrag}
            onDoubleClick={resetSplit}
            onKeyDown={nudgeSplit}
          />

          <div
            aria-hidden={!previewVisible}
            className={`min-w-0 ${paneTransition} ${
              previewVisible ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            style={{ flex: `1 1 ${previewPct}%` }}
          >
            <SidePane
              openProjects={openProjects}
              previewProjectId={activeProjectId}
              onPreviewProjectChange={setActiveProjectId}
              mode={previewMode}
              onModeChange={setPreviewMode}
              termOpen={termOpen}
              onTermOpenChange={setTermOpen}
            />
          </div>
        </div>

        {/* Agents Dock — full-width strip below both panes. */}
        {dockShown && dock}

        {/* Mid-drag: a transparent capture layer above the iframe so the
            pointer stream never gets eaten by the preview's cross-origin
            document, plus a consistent col-resize cursor everywhere. */}
        {dragging && (
          <div
            className="fixed inset-0 z-50 cursor-col-resize"
            style={{ userSelect: "none" }}
          />
        )}
      </main>

      {/* Workspace tool overlays. */}
      {toolModals}
    </div>
  );
}

/**
 * The draggable divider between the terminal and the preview. Occupies the
 * gutter (a 12px hit area with a hairline centered in it); stays put even when
 * the preview is collapsed, so it doubles as the "pull it back out" handle.
 * Drag → resize, double-click → reset, arrow keys → nudge.
 */
function PaneResizer({
  active,
  valueNow,
  onPointerDown,
  onDoubleClick,
  onKeyDown,
}: {
  active: boolean;
  valueNow: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize preview panel"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(valueNow)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      title="Drag to resize · double-click to reset"
      className="group relative flex w-3 shrink-0 cursor-col-resize items-center justify-center focus:outline-none"
    >
      <span
        aria-hidden
        className={`h-8 w-1 rounded-full transition-[background-color,height] duration-150 ${
          active
            ? "h-10 bg-white/70"
            : "bg-white/20 group-hover:h-10 group-hover:bg-white/45 group-focus-visible:bg-white/50"
        }`}
      />
    </div>
  );
}
