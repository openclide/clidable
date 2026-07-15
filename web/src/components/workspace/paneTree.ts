import type { AgentId } from "../welcome/data";

/**
 * Binary tree of terminal panes — tmux-style splits, plus tabs within
 * each leaf so you can multiplex multiple terminals in the same pane.
 *
 * - SplitPane arranges two children side-by-side (`row`) or stacked
 *   (`column`).
 * - LeafPane holds a list of tab slots; each slot is either a TileTerminal
 *   or null (an empty slot waiting for the user to pick project + agent).
 *   `tabs.length === 0` is the brand-new empty pane (dashed picker).
 */

export type PaneId = string;

export interface TileTerminal {
  projectId: string;
  agentId: AgentId;
  instanceId: string;
}

export interface LeafPane {
  kind: "leaf";
  id: PaneId;
  tabs: (TileTerminal | null)[];
  activeTabIndex: number;
}

export interface SplitPane {
  kind: "split";
  /** `row` = side-by-side, `column` = stacked (top/bottom). */
  direction: "row" | "column";
  first: Pane;
  second: Pane;
}

export type Pane = LeafPane | SplitPane;

let _id = 0;
export function nextPaneId(): PaneId {
  _id += 1;
  return `pane-${_id}`;
}

export function allLeaves(root: Pane): LeafPane[] {
  if (root.kind === "leaf") return [root];
  return [...allLeaves(root.first), ...allLeaves(root.second)];
}

/**
 * Collapse the whole tree into ONE leaf whose tabs are every leaf's tabs in
 * order — used on mobile, where side-by-side splits don't fit, so all terminals
 * become tabs in a single pane. Keeps the first leaf's id (stable focus). The
 * focused leaf's active tab stays selected (mapped to its index in the merged
 * list); pass `focusedLeafId` to enable that, else the first leaf's active tab
 * wins. A single-leaf tree is returned unchanged.
 */
export function flattenToTabs(root: Pane, focusedLeafId?: PaneId): LeafPane {
  if (root.kind === "leaf") return root;
  const leaves = allLeaves(root);
  const tabs = leaves.flatMap((l) => l.tabs);
  const last = Math.max(0, tabs.length - 1);
  // Default: the first leaf's active tab. If a focused leaf is given, select
  // its active tab at its offset in the concatenated tab list instead.
  let activeTabIndex = Math.min(leaves[0]!.activeTabIndex, last);
  let offset = 0;
  for (const l of leaves) {
    if (l.id === focusedLeafId) {
      activeTabIndex = Math.min(offset + Math.max(0, l.activeTabIndex), last);
      break;
    }
    offset += l.tabs.length;
  }
  return { kind: "leaf", id: leaves[0]!.id, tabs, activeTabIndex };
}

export function findLeaf(root: Pane, id: PaneId): LeafPane | null {
  if (root.kind === "leaf") return root.id === id ? root : null;
  return findLeaf(root.first, id) ?? findLeaf(root.second, id);
}

function mapLeaf(
  root: Pane,
  id: PaneId,
  fn: (leaf: LeafPane) => LeafPane,
): Pane {
  if (root.kind === "leaf") {
    if (root.id !== id) return root;
    return fn(root);
  }
  return {
    ...root,
    first: mapLeaf(root.first, id, fn),
    second: mapLeaf(root.second, id, fn),
  };
}

/**
 * Replace the leaf with `id` by a split node placing the existing leaf on
 * one side and a new empty leaf (no tabs) on the other.
 */
export function splitLeaf(
  root: Pane,
  id: PaneId,
  direction: "row" | "column",
  newLeafId: PaneId,
): Pane {
  if (root.kind === "leaf") {
    if (root.id !== id) return root;
    const newLeaf: LeafPane = {
      kind: "leaf",
      id: newLeafId,
      tabs: [],
      activeTabIndex: 0,
    };
    return { kind: "split", direction, first: root, second: newLeaf };
  }
  return {
    ...root,
    first: splitLeaf(root.first, id, direction, newLeafId),
    second: splitLeaf(root.second, id, direction, newLeafId),
  };
}

/**
 * Remove a leaf. Sibling collapses up to replace the parent split. If the
 * leaf is the root, the tree is cleared to an empty leaf (we always keep
 * at least one).
 */
export function removeLeaf(root: Pane, id: PaneId): Pane {
  if (root.kind === "leaf") {
    if (root.id === id) {
      return { ...root, tabs: [], activeTabIndex: 0 };
    }
    return root;
  }
  if (root.first.kind === "leaf" && root.first.id === id) return root.second;
  if (root.second.kind === "leaf" && root.second.id === id) return root.first;
  return {
    ...root,
    first: removeLeaf(root.first, id),
    second: removeLeaf(root.second, id),
  };
}

/**
 * Append a tab to a leaf. Pass `null` for an unassigned slot (the active
 * tab will show the pick-terminal placeholder). Returns the new tree and
 * the index of the new tab so the caller can switch focus.
 */
export function addTab(
  root: Pane,
  paneId: PaneId,
  tab: TileTerminal | null,
): { tree: Pane; newIndex: number } {
  let newIndex = -1;
  const tree = mapLeaf(root, paneId, (leaf) => {
    const tabs = [...leaf.tabs, tab];
    newIndex = tabs.length - 1;
    return { ...leaf, tabs, activeTabIndex: newIndex };
  });
  return { tree, newIndex };
}

/** Replace one tab slot (used by the EmptyTile picker for an unassigned slot). */
export function setTab(
  root: Pane,
  paneId: PaneId,
  tabIndex: number,
  tab: TileTerminal,
): Pane {
  return mapLeaf(root, paneId, (leaf) => {
    const tabs = leaf.tabs.slice();
    tabs[tabIndex] = tab;
    return { ...leaf, tabs };
  });
}

/**
 * Remove a tab. If the leaf ends up with zero tabs AND is not the only
 * leaf in the tree, the leaf itself is removed (parent collapses).
 */
export function removeTab(
  root: Pane,
  paneId: PaneId,
  tabIndex: number,
): Pane {
  const next = mapLeaf(root, paneId, (leaf) => {
    const tabs = leaf.tabs.filter((_, i) => i !== tabIndex);
    const activeTabIndex = Math.min(
      tabs.length - 1,
      tabIndex <= leaf.activeTabIndex
        ? Math.max(0, leaf.activeTabIndex - 1)
        : leaf.activeTabIndex,
    );
    return {
      ...leaf,
      tabs,
      activeTabIndex: activeTabIndex < 0 ? 0 : activeTabIndex,
    };
  });
  const leaf = findLeaf(next, paneId);
  if (leaf && leaf.tabs.length === 0 && allLeaves(next).length > 1) {
    return removeLeaf(next, paneId);
  }
  return next;
}

export function setActiveTab(
  root: Pane,
  paneId: PaneId,
  tabIndex: number,
): Pane {
  return mapLeaf(root, paneId, (leaf) => ({
    ...leaf,
    activeTabIndex: tabIndex,
  }));
}

/**
 * Drop all tabs whose terminal belongs to the given project. Leaves with
 * no remaining tabs get their tabs array emptied but stay in the tree;
 * the workspace's close-project handler decides whether to also remove
 * empty leaves.
 */
export function clearProject(root: Pane, projectId: string): Pane {
  if (root.kind === "leaf") {
    const tabs = root.tabs.filter((t) => t == null || t.projectId !== projectId);
    if (tabs.length === root.tabs.length) return root;
    // Shift the active index down by the count of removed tabs that sat BEFORE
    // it (not just clamp), so closing a project doesn't silently foreground a
    // different surviving terminal in a mixed-project leaf.
    const removedBefore = root.tabs
      .slice(0, root.activeTabIndex)
      .filter((t) => t != null && t.projectId === projectId).length;
    return {
      ...root,
      tabs,
      activeTabIndex: Math.min(
        Math.max(0, root.activeTabIndex - removedBefore),
        Math.max(0, tabs.length - 1),
      ),
    };
  }
  return {
    ...root,
    first: clearProject(root.first, projectId),
    second: clearProject(root.second, projectId),
  };
}
