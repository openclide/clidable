import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TerminalView } from "./TerminalView";
import { Composer } from "./Composer";
import { AgentIcon } from "../icons/AgentIcon";
import { AgentStatusIcon } from "./AgentStatusIcon";
import {
  AGENTS,
  getAgent,
  shortAgentName,
  type AgentId,
  type Project,
} from "../welcome/data";
import { PositionedPortal } from "../ui/PositionedPortal";
import { ProjectBadge, duplicatedInitials } from "./ProjectBadge";
import {
  clearTerminalDrag,
  currentTerminalDrag,
  hasTerminalDrag,
  isLeavingTarget,
  readTerminalDrag,
  setTerminalDragData,
  type TerminalDragPayload,
} from "./terminal-dnd";
import type { LeafPane, TileTerminal } from "./paneTree";

interface Props {
  leaf: LeafPane;
  projectsById: Map<string, Project>;
  openProjects: Project[];
  /** Default project for the new-terminal picker (the active project tab). */
  activeProjectId: string;
  focused: boolean;
  compact: boolean;
  /** Mobile shell — the split menu collapses to a single "new tab" action. */
  mobile?: boolean;
  /** When false, the per-pane close interaction is suppressed (last pane). */
  canRemove: boolean;
  /** Collapsed to its header bar (see LeafPane.collapsed). */
  collapsed?: boolean;
  onPickForTab: (tabIndex: number, next: { projectId: string; agentId: AgentId }) => void;
  onCloseTab: (tabIndex: number) => void;
  onSelectTab: (tabIndex: number) => void;
  onFocus: () => void;
  onSplit: (direction: "row" | "column" | "tab") => void;
  /** Collapse a tab out of the layout into the minimized dock. */
  onMinimize: (tabIndex: number) => void;
  /** Collapse this pane in place to its header bar / expand it back. */
  onToggleCollapse: () => void;
  /** A tab chip was dragged here — move it into this leaf. `toTabIndex` is
   *  the insert-before position; omitted = append. */
  onMoveTab: (from: TerminalDragPayload, toTabIndex?: number) => void;
  /** Leave the workspace — used when the sole, never-assigned pane is closed. */
  onExit: () => void;
}

/**
 * One leaf pane in the split tree. Renders either:
 *   - tabs.length === 0 → dashed-border EmptyTile picker
 *   - tabs.length >= 1 → tab strip (hidden when only one) + active terminal
 */
export function TerminalTile({
  leaf,
  projectsById,
  openProjects,
  activeProjectId,
  focused,
  compact,
  mobile,
  canRemove,
  collapsed,
  onPickForTab,
  onCloseTab,
  onSelectTab,
  onFocus,
  onSplit,
  onToggleCollapse,
  onMoveTab,
  onExit,
}: Props) {
  if (leaf.tabs.length === 0) {
    return (
      <EmptyTile
        openProjects={openProjects}
        activeProjectId={activeProjectId}
        mobile={mobile}
        onPick={(next) => onPickForTab(0, next)}
        onSplit={onSplit}
        onDropTerminal={(from) => onMoveTab(from)}
        // Close this never-assigned pane: collapse into the sibling when one
        // exists, otherwise (the sole pane) leave to the project picker —
        // there'd be nothing left to show.
        onClose={canRemove ? () => onCloseTab(0) : onExit}
      />
    );
  }

  const activeIndex = Math.min(leaf.activeTabIndex, leaf.tabs.length - 1);
  const activeTab = leaf.tabs[activeIndex] ?? null;
  const activeProject = activeTab
    ? projectsById.get(activeTab.projectId)
    : undefined;

  const showCloseOnTab = canRemove || leaf.tabs.length > 1;
  // Project attribution (tab badge + composer label) only earns its space
  // when there's more than one project to tell apart. Color is added only
  // where initials collide — unique initials stay neutral gray.
  const multiProject = openProjects.length > 1;
  const dupInitials = duplicatedInitials(openProjects.map((p) => p.name));
  const isTinted = (name: string) =>
    dupInitials.has(name.charAt(0).toUpperCase());

  return (
    <div
      onMouseDown={onFocus}
      // Whole-tile drop target: dropping a dragged tab anywhere on the tile
      // appends it to this leaf (chips intercept for insert-before). Only for
      // CROSS-pane drags — a micro-drag of this pane's own chip released over
      // the body must stay a click-like no-op, not a surprise move-to-end.
      onDragOver={(e) => {
        if (!hasTerminalDrag(e)) return;
        if (currentTerminalDrag()?.paneId === leaf.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        const payload = readTerminalDrag(e);
        if (!payload || payload.paneId === leaf.id) return;
        e.preventDefault();
        onMoveTab(payload);
      }}
      className={`
        glass flex h-full min-h-0 flex-col overflow-hidden rounded-2xl
        transition-[border-color] duration-200
        ${collapsed ? "justify-center" : ""}
        ${
          // The card's surface (fill, blur, shadow, hairline) is all `.glass`.
          // Focus just recolors that ONE border — brighter when focused — so
          // there's no second line. `!` wins over `.glass`'s own border-color
          // (same property, and Tailwind's utility order isn't guaranteed).
          focused ? "border-white/[0.22]!" : "border-white/[0.08]!"
        }
      `}
    >
      <header
        className={`flex shrink-0 items-center gap-1.5 px-3 ${collapsed ? "py-0" : "pt-3"}`}
      >
        {/* Strip is content-sized (no flex-1) so `+` sits right next to
            the last pill when tabs fit. With `min-w-0` + `overflow-x-auto`
            it shrinks under pressure so the `+` stays pinned right
            and the pills scroll underneath when tabs overflow. */}
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {leaf.tabs.map((t, i) => {
            // A compact project initial — only when 2+ projects are open
            // (matches the composer label), so single-project tabs stay clean.
            const tabProject =
              multiProject && t ? projectsById.get(t.projectId)?.name : undefined;
            return (
              <TabChip
                // Stable identity per terminal so closing a non-last tab doesn't
                // shift later tabs onto a reused chip; empty slots fall back to index.
                key={t ? t.instanceId : `empty-${i}`}
                tab={t}
                projectName={tabProject}
                projectTinted={tabProject ? isTinted(tabProject) : false}
                active={i === activeIndex}
                showClose={showCloseOnTab}
                onSelect={() => onSelectTab(i)}
                onClose={() => onCloseTab(i)}
                onDragStartChip={
                  t
                    ? (e) =>
                        setTerminalDragData(e, {
                          paneId: leaf.id,
                          tabIndex: i,
                        })
                    : undefined
                }
                onDropBefore={(from) => onMoveTab(from, i)}
              />
            );
          })}
        </div>
        {/* Collapse needs a sibling to grow into, so it's offered only in a
            split. But the EXPAND control must ALWAYS be present on an
            already-collapsed pane — otherwise a pane that became the sole leaf
            (or lost its assigned active tab) while collapsed would be stuck
            with no way back. */}
        {!mobile && (collapsed || (activeTab && canRemove)) && (
          <CollapseButton collapsed={collapsed} onClick={onToggleCollapse} />
        )}
        {mobile ? (
          <AddTabButton onClick={() => onSplit("tab")} />
        ) : (
          <SplitMenu onSplit={onSplit} />
        )}
      </header>

      {/* Body is hidden while collapsed — the pane is just its header bar. */}
      {collapsed ? null : activeTab && activeProject ? (
        <>
          <div className="min-h-0 flex-1 overflow-hidden">
            <TerminalView
              sessionId={activeTab.instanceId}
              agentId={activeTab.agentId}
              projectPath={activeProject.path}
            />
          </div>
          <div className="shrink-0 p-3 pt-2">
            {/* One composer for both — a plain terminal renders the same box in
                `plain` mode (no checkpoints); it keeps the agent selector, so
                you can switch the shell into a real agent in place. You can also
                type straight into the xterm above. */}
            <Composer
              agentId={activeTab.agentId}
              sessionId={activeTab.instanceId}
              projectPath={activeProject.path}
              // Surface the project on the composer only when more than one is
              // open — otherwise it's redundant.
              projectName={multiProject ? activeProject.name : undefined}
              projectTinted={multiProject && isTinted(activeProject.name)}
              compact={compact}
              plain={activeTab.agentId === "terminal"}
              onSelectAgent={(nextAgentId) => {
                if (nextAgentId === activeTab.agentId) return;
                onPickForTab(activeIndex, {
                  projectId: activeTab.projectId,
                  agentId: nextAgentId,
                });
              }}
            />
          </div>
        </>
      ) : (
        // Active tab is unassigned → inline pick-terminal picker, but no
        // dashed border (we keep the leaf's existing chrome).
        <div className="min-h-0 flex-1">
          <EmptyPicker
            openProjects={openProjects}
            activeProjectId={activeProjectId}
            onPick={(next) => onPickForTab(activeIndex, next)}
          />
        </div>
      )}
    </div>
  );
}

function TabChip({
  tab,
  projectName,
  projectTinted = false,
  active,
  showClose,
  onSelect,
  onClose,
  onDragStartChip,
  onDropBefore,
}: {
  tab: TileTerminal | null;
  /** Project initial to prefix (set only when 2+ projects are open). */
  projectName?: string;
  /** Color the initial badge (only when its initial collides with another). */
  projectTinted?: boolean;
  active: boolean;
  showClose: boolean;
  onSelect: () => void;
  onClose: () => void;
  /** Present only for assigned tabs — makes the chip a drag source. */
  onDragStartChip?: (e: React.DragEvent) => void;
  /** A dragged tab was dropped on this chip → insert before it. */
  onDropBefore: (from: TerminalDragPayload) => void;
}) {
  const [dropHover, setDropHover] = useState(false);
  const agent = tab ? getAgent(tab.agentId) : null;
  const agentName = agent ? shortAgentName(agent.name) : "";
  // Accessible name + hover title — the project otherwise shows only as an
  // aria-hidden single-letter badge, so name it here for screen readers/hover.
  const label = agent
    ? projectName
      ? `${agentName} · ${projectName}`
      : agentName
    : "Unassigned terminal";
  return (
    <button
      type="button"
      onClick={onSelect}
      title={label}
      aria-label={label}
      draggable={!!onDragStartChip}
      onDragStart={onDragStartChip}
      // dragend fires on the SOURCE after drop or cancel — the one reliable
      // place to forget the window-local drag payload.
      onDragEnd={onDragStartChip ? clearTerminalDrag : undefined}
      onDragOver={(e) => {
        if (!hasTerminalDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropHover(true);
      }}
      onDragLeave={(e) => {
        if (isLeavingTarget(e)) setDropHover(false);
      }}
      onDrop={(e) => {
        setDropHover(false);
        const payload = readTerminalDrag(e);
        if (!payload) return;
        e.preventDefault();
        e.stopPropagation(); // don't let the tile's append-drop also fire
        onDropBefore(payload);
      }}
      className={`
        group/tab relative flex shrink-0 items-center gap-2 rounded-xl
        px-2.5 py-1.5
        text-[12px] tracking-tight
        transition-[background-color,color,box-shadow] duration-150
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        ${
          active
            ? "bg-white/[0.06] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            : "text-foreground/55 hover:bg-white/[0.03] hover:text-foreground/85"
        }
      `}
      style={agent ? ({ "--agent": agent.color } as React.CSSProperties) : {}}
    >
      {/* Insert-before caret while a dragged tab hovers this chip. */}
      {dropHover && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 -left-1 w-0.5 rounded-full bg-white/70"
        />
      )}
      {tab && agent ? (
        <>
          {projectName && (
            <ProjectBadge name={projectName} size={15} tinted={projectTinted} />
          )}
          <AgentStatusIcon
            instanceId={tab.instanceId}
            agentId={tab.agentId}
            size={12}
            className="opacity-90"
          />
          <span className="truncate">{agentName}</span>
        </>
      ) : (
        <span className="text-foreground/45">(unassigned)</span>
      )}
      {showClose && (
        <span
          role="button"
          aria-label="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="
            -mr-0.5 flex size-4 items-center justify-center rounded-md
            text-foreground/30
            opacity-0
            transition-opacity duration-150
            group-hover/tab:opacity-100
            hover:bg-white/[0.08] hover:text-foreground/80
          "
        >
          <svg viewBox="0 0 24 24" width={9} height={9} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <path d="M6 6l12 12M6 18L18 6" />
          </svg>
        </span>
      )}
      {active && agent && (
        <span
          aria-hidden
          className="
            pointer-events-none absolute inset-x-2 -bottom-px h-[2px] rounded-full
            bg-[color:var(--agent)]
            shadow-[0_0_8px_var(--agent)]
          "
        />
      )}
    </button>
  );
}

function SplitMenu({
  onSplit,
}: {
  onSplit: (direction: "row" | "column" | "tab") => void;
}) {
  const [open, setOpen] = useState(false);
  // Computed each time the menu opens (and on resize/scroll while open).
  // Viewport-relative coords for the portal'd popover.
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const POP_WIDTH = 210;
    const MARGIN = 8;
    const update = () => {
      const rect = anchorRef.current!.getBoundingClientRect();
      const fitsLeft = rect.right - POP_WIDTH >= MARGIN;
      const fitsRight =
        rect.left + POP_WIDTH <= window.innerWidth - MARGIN;
      // Prefer left-extend (popover ends at button's right edge); only
      // flip to right when there isn't room on the left.
      const extendRight = !fitsLeft && fitsRight;
      setCoords({
        top: rect.bottom + 6,
        left: extendRight ? rect.left : rect.right - POP_WIDTH,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (direction: "row" | "column" | "tab") => {
    onSplit(direction);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Add terminal"
        aria-label="Add terminal"
        className="
          flex size-7 shrink-0 items-center justify-center rounded-xl
          text-foreground/45
          transition-[background-color,color] duration-150
          hover:bg-white/[0.05] hover:text-foreground/85
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        "
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {open && coords &&
        createPortal(
          <div
            ref={popRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              top: coords.top,
              left: coords.left,
              // Glass painted at body level, outside any backdrop-root
              // ancestor — backdrop-filter now sees the raw page content
              // beneath it and can actually blur it.
              background:
                "color-mix(in oklch, var(--color-background) 38%, transparent)",
              backdropFilter: "blur(32px) saturate(180%)",
              WebkitBackdropFilter: "blur(32px) saturate(180%)",
              border: "1px solid var(--color-glass-edge)",
              boxShadow:
                "inset 0 1px 0 0 rgba(255,255,255,0.05), 0 18px 40px rgba(0,0,0,0.45)",
            }}
            className="
              fixed z-50
              flex w-[210px] flex-col gap-0.5 rounded-xl p-1.5
            "
          >
            <SplitOption
              glyph={<SplitGlyph direction="row" />}
              title="To the side"
              subtitle="New pane on the right"
              onClick={() => pick("row")}
            />
            <SplitOption
              glyph={<SplitGlyph direction="column" />}
              title="To the bottom"
              subtitle="New pane below"
              onClick={() => pick("column")}
            />
            <SplitOption
              glyph={<SplitGlyph direction="tab" />}
              title="As a tab"
              subtitle="New tab in this pane"
              onClick={() => pick("tab")}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

function SplitOption({
  glyph,
  title,
  subtitle,
  onClick,
}: {
  glyph: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="
        flex items-center gap-2.5 rounded-lg
        px-2.5 py-2 text-left
        transition-[background-color,color] duration-150
        hover:bg-white/[0.06]
        focus:outline-none focus-visible:bg-white/[0.06]
      "
    >
      {glyph}
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-foreground/85">
          {title}
        </span>
        <span className="block text-[10.5px] text-foreground/40">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function SplitGlyph({ direction }: { direction: "row" | "column" | "tab" }) {
  if (direction === "row") {
    return (
      <svg viewBox="0 0 18 14" width={18} height={14} aria-hidden>
        <rect x={0} y={0} width={8} height={14} rx={1.4} fill="currentColor" opacity={0.35} />
        <rect x={10} y={0} width={8} height={14} rx={1.4} fill="currentColor" opacity={0.85} />
      </svg>
    );
  }
  if (direction === "column") {
    return (
      <svg viewBox="0 0 18 14" width={18} height={14} aria-hidden>
        <rect x={0} y={0} width={18} height={6} rx={1.4} fill="currentColor" opacity={0.35} />
        <rect x={0} y={8} width={18} height={6} rx={1.4} fill="currentColor" opacity={0.85} />
      </svg>
    );
  }
  // tab: small tab strip at top, content area below
  return (
    <svg viewBox="0 0 18 14" width={18} height={14} aria-hidden>
      <rect x={0} y={0} width={7} height={3} rx={0.8} fill="currentColor" opacity={0.35} />
      <rect x={8} y={0} width={7} height={3} rx={0.8} fill="currentColor" opacity={0.85} />
      <rect x={0} y={4.5} width={18} height={9.5} rx={1.4} fill="currentColor" opacity={0.4} />
    </svg>
  );
}

/** Collapse this pane to its header bar (sibling grows to fill), or expand it
 *  back when already collapsed. Mirrors AddTabButton's chrome so the header
 *  controls read as one set. */
function CollapseButton({
  collapsed,
  onClick,
}: {
  collapsed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={collapsed ? "Expand pane" : "Collapse pane"}
      aria-label={collapsed ? "Expand pane" : "Collapse pane"}
      className="
        flex size-7 shrink-0 items-center justify-center rounded-xl
        text-foreground/45
        transition-[background-color,color] duration-150
        hover:bg-white/[0.05] hover:text-foreground/85
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
      "
    >
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={collapsed ? "M6 9l6 6 6-6" : "M5 12h14"} />
      </svg>
    </button>
  );
}

function EmptyTile({
  openProjects,
  activeProjectId,
  mobile,
  onPick,
  onSplit,
  onDropTerminal,
  onClose,
}: {
  openProjects: Project[];
  activeProjectId: string;
  mobile?: boolean;
  onPick: (next: { projectId: string; agentId: AgentId }) => void;
  onSplit: (direction: "row" | "column" | "tab") => void;
  /** A dragged tab was dropped here — move it into this empty pane. */
  onDropTerminal: (from: TerminalDragPayload) => void;
  /** Dismiss this never-assigned pane (collapse to sibling, or leave). */
  onClose: () => void;
}) {
  const [dropHover, setDropHover] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (!hasTerminalDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropHover(true);
      }}
      onDragLeave={(e) => {
        if (isLeavingTarget(e)) setDropHover(false);
      }}
      onDrop={(e) => {
        setDropHover(false);
        const payload = readTerminalDrag(e);
        if (!payload) return;
        e.preventDefault();
        onDropTerminal(payload);
      }}
      className={`
        glass
        group/empty relative h-full min-h-0 overflow-hidden
        rounded-2xl border border-dashed
        bg-white/[0.005]
        text-foreground/45
        transition-[border-color] duration-150
        ${dropHover ? "border-white/[0.3]" : "border-white/[0.08]"}
      `}
    >
      <EmptyPicker
        openProjects={openProjects}
        activeProjectId={activeProjectId}
        onPick={onPick}
      />
      {/* Top-right controls: grow the layout (split, or new tab on mobile) and
          an × to back out of this new terminal without picking an agent. */}
      <div className="absolute right-2 top-2 flex items-center gap-1">
        {mobile ? (
          <AddTabButton onClick={() => onSplit("tab")} />
        ) : (
          <SplitMenu onSplit={onSplit} />
        )}
        <CloseTileButton onClick={onClose} />
      </div>
    </div>
  );
}

/** Dismiss an empty (never-assigned) pane. Mirrors AddTabButton's chrome so
 *  the two sit cleanly together in the corner. */
function CloseTileButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Close terminal"
      aria-label="Close terminal"
      className="
        flex size-7 shrink-0 items-center justify-center rounded-xl
        text-foreground/45
        transition-[background-color,color] duration-150
        hover:bg-white/[0.05] hover:text-foreground/85
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
      "
    >
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M6 6l12 12M6 18L18 6" />
      </svg>
    </button>
  );
}

/** Plain "new terminal tab" button — the mobile stand-in for SplitMenu (no
 *  row/column splits on a phone). Mirrors the split button's chrome. */
function AddTabButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="New terminal"
      aria-label="New terminal"
      className="
        flex size-7 shrink-0 items-center justify-center rounded-xl
        text-foreground/45
        transition-[background-color,color] duration-150
        hover:bg-white/[0.05] hover:text-foreground/85
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
      "
    >
      <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

/**
 * New-terminal empty state, rendered directly in an empty pane (not a modal).
 * A heading + a project pill (defaulting to the active project, a switcher
 * when 2+ are open) + a grid of agents. Picking an agent opens it in the
 * selected project.
 */
function EmptyPicker({
  openProjects,
  activeProjectId,
  onPick,
}: {
  openProjects: Project[];
  activeProjectId: string;
  onPick: (next: { projectId: string; agentId: AgentId }) => void;
}) {
  // Which project new agents will open in. Defaults to the active project and
  // follows the active tab (a manual pick sticks until the tab next changes).
  const [projectId, setProjectId] = useState(activeProjectId);
  useEffect(() => setProjectId(activeProjectId), [activeProjectId]);

  const selected =
    openProjects.find((p) => p.id === projectId) ?? openProjects[0];

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden">
      <div className="flex min-h-full flex-col items-center justify-center gap-5 p-5">
        {!selected ? (
          <p className="text-[12px] text-foreground/45">No projects open.</p>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2.5">
              <span className="text-[13px] font-medium tracking-tight text-foreground/80">
                New terminal
              </span>
              <ProjectChip
                openProjects={openProjects}
                selected={selected}
                onSelect={setProjectId}
              />
            </div>

            <div className="grid w-full max-w-[400px] grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1.5">
              {AGENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onPick({ projectId: selected.id, agentId: a.id })}
                  title={`${a.name} · ${selected.name}`}
                  className="
                    group/agent flex flex-col items-center gap-2 rounded-xl
                    px-2 py-3.5
                    transition-[background-color] duration-150
                    hover:bg-white/[0.04]
                    focus:outline-none focus-visible:bg-white/[0.05]
                  "
                >
                  <AgentIcon
                    id={a.id}
                    size={20}
                    className="opacity-80 transition-opacity duration-150 group-hover/agent:opacity-100"
                  />
                  <span className="text-center text-[11px] leading-tight text-foreground/65 transition-colors duration-150 group-hover/agent:text-foreground/90">
                    {shortAgentName(a.name)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Pill showing the target project; a portaled dropdown switcher when 2+ are
 *  open. Uses PositionedPortal so the menu escapes the empty-pane's
 *  `overflow-y-auto`/`overflow-hidden` ancestors instead of being clipped. */
function ProjectChip({
  openProjects,
  selected,
  onSelect,
}: {
  openProjects: Project[];
  selected: Project;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const multi = openProjects.length > 1;
  const dups = duplicatedInitials(openProjects.map((p) => p.name));
  const tinted = (name: string) => dups.has(name.charAt(0).toUpperCase());

  // If the project count drops to one while the menu is open, close it — the
  // now-`disabled` button can't toggle it shut, which would otherwise strand
  // `open` (and `aria-expanded`) at true.
  useEffect(() => {
    if (!multi) setOpen(false);
  }, [multi]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={!multi}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open && multi}
        className={`
          flex items-center gap-1.5 rounded-full
          border border-white/[0.08] bg-white/[0.03] py-1 pl-1 pr-2.5
          text-[12px] text-foreground/75
          transition-[background-color] duration-150
          ${
            multi
              ? "hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              : "cursor-default"
          }
        `}
      >
        <ProjectBadge name={selected.name} tinted={tinted(selected.name)} />
        <span className="max-w-[170px] truncate">{selected.name}</span>
        {multi && (
          <svg
            viewBox="0 0 24 24"
            width={12}
            height={12}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-foreground/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      <PositionedPortal
        anchorRef={anchorRef}
        open={open && multi}
        onClose={() => setOpen(false)}
        width={210}
        placement="bottom"
        align="left"
        role="menu"
        className="glass flex max-h-[240px] flex-col gap-0.5 overflow-auto rounded-xl p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.4)]"
      >
        {openProjects.map((p) => (
          <button
            key={p.id}
            type="button"
            role="menuitemradio"
            aria-checked={p.id === selected.id}
            onClick={() => {
              onSelect(p.id);
              setOpen(false);
            }}
            className="
              flex w-full items-center gap-2 rounded-lg
              px-2 py-1.5 text-left
              transition-[background-color] duration-150
              hover:bg-white/[0.06]
              focus:outline-none focus-visible:bg-white/[0.06]
            "
          >
            <ProjectBadge name={p.name} tinted={tinted(p.name)} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/85">
              {p.name}
            </span>
            {p.id === selected.id && (
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/70">
                <path d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        ))}
      </PositionedPortal>
    </>
  );
}
