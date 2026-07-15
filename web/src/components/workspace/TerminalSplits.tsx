import { useMemo } from "react";
import { TerminalTile } from "./TerminalTile";
import type { LeafPane, Pane, PaneId } from "./paneTree";
import type { AgentId, MockProject } from "../welcome/data";

interface Props {
  root: Pane;
  projectsById: Map<string, MockProject>;
  openProjects: MockProject[];
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
  onSplit: (id: PaneId, direction: "row" | "column" | "tab") => void;
  /** Leave the workspace — fired when the sole, never-assigned pane is closed. */
  onExit: () => void;
}

interface LeafRect {
  leaf: LeafPane;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Recursive walk of the pane tree → flat list of (leaf, rect) entries.
 * Rects are expressed in percentages so the wrapping `<section>` can be
 * any size; CSS resolves the actual pixels.
 *
 * Two children of a split each get half of the parent's extent in the
 * split's direction.
 */
function computeLeafRects(
  root: Pane,
  left = 0,
  top = 0,
  width = 100,
  height = 100,
): LeafRect[] {
  if (root.kind === "leaf") {
    return [{ leaf: root, left, top, width, height }];
  }
  if (root.direction === "row") {
    return [
      ...computeLeafRects(root.first, left, top, width / 2, height),
      ...computeLeafRects(
        root.second,
        left + width / 2,
        top,
        width / 2,
        height,
      ),
    ];
  }
  return [
    ...computeLeafRects(root.first, left, top, width, height / 2),
    ...computeLeafRects(
      root.second,
      left,
      top + height / 2,
      width,
      height / 2,
    ),
  ];
}

/**
 * Gutter padding for one leaf's wrapper — applied ONLY on edges that abut a
 * sibling pane (i.e. not the outer container boundary). So a lone pane sits
 * flush to the edges, while split panes get a `p-1` gap between them.
 */
function gutterStyle(
  left: number,
  top: number,
  width: number,
  height: number,
): React.CSSProperties {
  const G = "0.25rem"; // = p-1
  const EPS = 0.01; // float-safe boundary test on the percentage rects
  return {
    paddingLeft: left > EPS ? G : undefined,
    paddingTop: top > EPS ? G : undefined,
    paddingRight: left + width < 100 - EPS ? G : undefined,
    paddingBottom: top + height < 100 - EPS ? G : undefined,
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
  onSplit,
  onExit,
}: Props) {
  const rects = useMemo(() => computeLeafRects(root), [root]);

  return (
    <section className="relative h-full min-h-0 rounded-2xl">
      {rects.map(({ leaf, left, top, width, height }) => (
        <div
          key={leaf.id}
          className="
            group absolute
            transition-[left,top,width,height] duration-200
            ease-[cubic-bezier(0.2,0.7,0.2,1)]
          "
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: `${width}%`,
            height: `${height}%`,
            // Gap only between adjacent panes; outer edges stay flush.
            ...gutterStyle(left, top, width, height),
          }}
        >
          <TerminalTile
            leaf={leaf}
            projectsById={projectsById}
            openProjects={openProjects}
            activeProjectId={activeProjectId}
            focused={leaf.id === focusedId && leaf.tabs.length > 0}
            compact={compact}
            mobile={mobile}
            canRemove={allowClose}
            onFocus={() => onFocus(leaf.id)}
            onPickForTab={(tabIndex, next) =>
              onPickForTab(leaf.id, tabIndex, next)
            }
            onCloseTab={(tabIndex) => onCloseTab(leaf.id, tabIndex)}
            onSelectTab={(tabIndex) => onSelectTab(leaf.id, tabIndex)}
            onSplit={(dir) => onSplit(leaf.id, dir)}
            onExit={onExit}
          />
        </div>
      ))}
    </section>
  );
}
