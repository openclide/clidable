import { useMemo } from "react";
import { TerminalTile } from "./TerminalTile";
import type { LeafPane, Pane, PaneId } from "./paneTree";
import type { AgentId, Project } from "../welcome/data";

interface Props {
  root: Pane;
  projectsById: Map<string, Project>;
  openProjects: Project[];
  /** Default project for new-terminal pickers (the active project tab). */
  activeProjectId: string;
  focusedId: PaneId;
  /** False when the tree has only one leaf — hide per-tile close button. */
  allowClose: boolean;
  /** True when the tree has 2+ leaves — tightens composer typography. */
  compact: boolean;
  /** Mobile shell — collapse the per-pane split menu to a single "new tab". */
  mobile?: boolean;
  onFocus: (id: PaneId) => void;
  onPickForTab: (
    id: PaneId,
    tabIndex: number,
    next: { projectId: string; agentId: AgentId },
  ) => void;
  onCloseTab: (id: PaneId, tabIndex: number) => void;
  onSelectTab: (id: PaneId, tabIndex: number) => void;
  /** Rename a tab (custom label); null clears the override. */
  onRenameTab: (id: PaneId, tabIndex: number, title: string | null) => void;
  onSplit: (id: PaneId, direction: "row" | "column" | "tab") => void;
  /** Collapse a tab out of the layout into the minimized dock. */
  onMinimizeTab: (id: PaneId, tabIndex: number) => void;
  /** Collapse a pane in place to its header bar / expand it back. */
  onToggleCollapse: (id: PaneId) => void;
  /** Drag & drop: move a tab within/between leaves. `to.tabIndex` is the
   *  insert-before position; omitted = append. */
  onMoveTab: (
    from: { paneId: PaneId; tabIndex: number },
    to: { paneId: PaneId; tabIndex?: number },
  ) => void;
  /** Leave the workspace — fired when the sole, never-assigned pane is closed. */
  onExit: () => void;
}

/**
 * A rect edge/extent as `calc(pct% + px·px)`. The percentage part carries the
 * flexible share of the container; the pixel part carries the fixed size that
 * a collapsed pane reserves for its header (and that its sibling gives up).
 */
interface Dim {
  pct: number;
  px: number;
}

interface LeafRect {
  leaf: LeafPane;
  left: Dim;
  top: Dim;
  width: Dim;
  height: Dim;
  /** True when this leaf is collapsed to its header bar. */
  collapsed: boolean;
}

/** Fixed height (px) of a collapsed pane's header bar. */
const COLLAPSED_PX = 48;

const dAdd = (a: Dim, b: Dim): Dim => ({ pct: a.pct + b.pct, px: a.px + b.px });
const dSub = (a: Dim, b: Dim): Dim => ({ pct: a.pct - b.pct, px: a.px - b.px });
const dHalf = (a: Dim): Dim => ({ pct: a.pct / 2, px: a.px / 2 });

function dimStr(d: Dim): string {
  const pct = Math.round(d.pct * 1000) / 1000;
  if (d.px === 0) return `${pct}%`;
  if (pct === 0) return `${d.px}px`;
  return `calc(${pct}% + ${d.px}px)`;
}

/** A leaf that should shrink to a fixed header. Empty (never-assigned) panes
 *  don't collapse — there's nothing to keep. */
function isCollapsedLeaf(n: Pane): n is LeafPane {
  return n.kind === "leaf" && !!n.collapsed && n.tabs.length > 0;
}

/**
 * Recursive walk of the pane tree → flat list of (leaf, rect) entries. Two
 * children of a split normally each get half of the parent's extent along the
 * split axis. A collapsed leaf ALWAYS caps to a fixed COLLAPSED_PX-tall
 * horizontal bar (never a vertical rail): in a stacked split the sibling
 * absorbs the freed height; in a side-by-side split it just sits as a bar at
 * the top of its column. Panes stay flat-absolute so xterm identity survives.
 */
function computeLeafRects(
  root: Pane,
  left: Dim,
  top: Dim,
  width: Dim,
  height: Dim,
): LeafRect[] {
  if (root.kind === "leaf") {
    return [{ leaf: root, left, top, width, height, collapsed: isCollapsedLeaf(root) }];
  }
  const BAR: Dim = { pct: 0, px: COLLAPSED_PX };
  const aCol = isCollapsedLeaf(root.first);
  const bCol = isCollapsedLeaf(root.second);

  if (root.direction === "row") {
    // Side by side: each child keeps half the width; a collapsed child caps
    // its height to a bar (space stays empty below it — collapse is always
    // a horizontal header, never a vertical rail).
    const halfW = dHalf(width);
    const secondLeft = dAdd(left, halfW);
    return [
      ...(aCol
        ? [{ leaf: root.first as LeafPane, left, top, width: halfW, height: BAR, collapsed: true }]
        : computeLeafRects(root.first, left, top, halfW, height)),
      ...(bCol
        ? [{ leaf: root.second as LeafPane, left: secondLeft, top, width: halfW, height: BAR, collapsed: true }]
        : computeLeafRects(root.second, secondLeft, top, halfW, height)),
    ];
  }

  // Stacked: a collapsed child reserves a fixed bar height; the sibling grows.
  if (aCol && bCol) {
    return [
      { leaf: root.first as LeafPane, left, top, width, height: BAR, collapsed: true },
      { leaf: root.second as LeafPane, left, top: dAdd(top, BAR), width, height: BAR, collapsed: true },
    ];
  }
  if (aCol) {
    return [
      { leaf: root.first as LeafPane, left, top, width, height: BAR, collapsed: true },
      ...computeLeafRects(root.second, left, dAdd(top, BAR), width, dSub(height, BAR)),
    ];
  }
  if (bCol) {
    const rem = dSub(height, BAR);
    return [
      ...computeLeafRects(root.first, left, top, width, rem),
      { leaf: root.second as LeafPane, left, top: dAdd(top, rem), width, height: BAR, collapsed: true },
    ];
  }
  return [
    ...computeLeafRects(root.first, left, top, width, dHalf(height)),
    ...computeLeafRects(root.second, left, dAdd(top, dHalf(height)), width, dHalf(height)),
  ];
}

/**
 * Gutter padding for one leaf's wrapper — applied ONLY on edges that abut a
 * sibling pane (i.e. not the outer container boundary). So a lone pane sits
 * flush to the edges, while split panes get a `p-1` gap between them.
 */
function gutterStyle(rect: LeafRect): React.CSSProperties {
  const G = "0.25rem"; // = p-1
  const EPS = 0.01;
  const { left, top, width, height } = rect;
  const atLeft = left.pct < EPS && Math.abs(left.px) < 1;
  const atTop = top.pct < EPS && Math.abs(top.px) < 1;
  const atRight =
    left.pct + width.pct > 100 - EPS && Math.abs(left.px + width.px) < 1;
  const atBottom =
    top.pct + height.pct > 100 - EPS && Math.abs(top.px + height.px) < 1;
  return {
    paddingLeft: atLeft ? undefined : G,
    paddingTop: atTop ? undefined : G,
    paddingRight: atRight ? undefined : G,
    paddingBottom: atBottom ? undefined : G,
  };
}

/**
 * Splits container. All leaves live as siblings in a flat absolutely-
 * positioned layer — restructuring the tree (split / collapse) only
 * changes each leaf's rect, never its React identity. This keeps
 * xterm.js instances and their PTY subscriptions mounted across
 * splits.
 */
export function TerminalSplits({
  root,
  projectsById,
  openProjects,
  activeProjectId,
  focusedId,
  allowClose,
  compact,
  mobile,
  onFocus,
  onPickForTab,
  onCloseTab,
  onSelectTab,
  onRenameTab,
  onSplit,
  onMinimizeTab,
  onToggleCollapse,
  onMoveTab,
  onExit,
}: Props) {
  const rects = useMemo(
    () =>
      computeLeafRects(
        root,
        { pct: 0, px: 0 },
        { pct: 0, px: 0 },
        { pct: 100, px: 0 },
        { pct: 100, px: 0 },
      ),
    [root],
  );

  return (
    <section className="relative h-full min-h-0 rounded-2xl">
      {rects.map((rect) => (
        <div
          key={rect.leaf.id}
          className="
            group absolute
            transition-[left,top,width,height] duration-200
            ease-[cubic-bezier(0.2,0.7,0.2,1)]
          "
          style={{
            left: dimStr(rect.left),
            top: dimStr(rect.top),
            width: dimStr(rect.width),
            height: dimStr(rect.height),
            // Gap only between adjacent panes; outer edges stay flush.
            ...gutterStyle(rect),
          }}
        >
          <TerminalTile
            leaf={rect.leaf}
            projectsById={projectsById}
            openProjects={openProjects}
            activeProjectId={activeProjectId}
            focused={
              rect.leaf.id === focusedId &&
              rect.leaf.tabs.length > 0 &&
              !rect.collapsed
            }
            collapsed={rect.collapsed}
            compact={compact}
            mobile={mobile}
            canRemove={allowClose}
            onFocus={() => onFocus(rect.leaf.id)}
            onPickForTab={(tabIndex, next) =>
              onPickForTab(rect.leaf.id, tabIndex, next)
            }
            onCloseTab={(tabIndex) => onCloseTab(rect.leaf.id, tabIndex)}
            onSelectTab={(tabIndex) => onSelectTab(rect.leaf.id, tabIndex)}
            onRenameTab={(tabIndex, title) =>
              onRenameTab(rect.leaf.id, tabIndex, title)
            }
            onSplit={(dir) => onSplit(rect.leaf.id, dir)}
            onMinimize={(tabIndex) => onMinimizeTab(rect.leaf.id, tabIndex)}
            onToggleCollapse={() => onToggleCollapse(rect.leaf.id)}
            onMoveTab={(from, toTabIndex) =>
              onMoveTab(from, { paneId: rect.leaf.id, tabIndex: toTabIndex })
            }
            onExit={onExit}
          />
        </div>
      ))}
    </section>
  );
}
