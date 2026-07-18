/**
 * Unit tests for the pane-tree transforms — focused on `moveTab`, whose
 * insert-before index arithmetic (remove shifts positions) and active-tab
 * preservation are easy to get subtly wrong.
 *
 * Run with `bun test`.
 */
import { describe, expect, it } from "bun:test";
import {
  findLeaf,
  insertTab,
  moveTab,
  setCollapsed,
  type LeafPane,
  type Pane,
  type SplitPane,
  type TileTerminal,
} from "./paneTree";

function term(n: number): TileTerminal {
  return { projectId: "p1", agentId: "claude", instanceId: `t${n}` };
}

function leaf(
  id: string,
  tabs: (TileTerminal | null)[],
  activeTabIndex = 0,
  collapsed?: boolean,
): LeafPane {
  return {
    kind: "leaf",
    id,
    tabs,
    activeTabIndex,
    ...(collapsed !== undefined ? { collapsed } : {}),
  };
}

function split(first: Pane, second: Pane): SplitPane {
  return { kind: "split", direction: "row", first, second };
}

function ids(l: LeafPane): (string | null)[] {
  return l.tabs.map((t) => t?.instanceId ?? null);
}

describe("moveTab — same leaf reorder", () => {
  it("moves a tab earlier (insert-before its target)", () => {
    const root = leaf("a", [term(0), term(1), term(2)], 0);
    const next = moveTab(
      root,
      { paneId: "a", tabIndex: 2 },
      { paneId: "a", tabIndex: 0 },
    ) as LeafPane;
    expect(ids(next)).toEqual(["t2", "t0", "t1"]);
    // Previously-active t0 stays active at its new position.
    expect(next.activeTabIndex).toBe(1);
  });

  it("moves a tab later, adjusting for its own removal", () => {
    const root = leaf("a", [term(0), term(1), term(2)], 2);
    // Drop t0 before position 2 → after removing t0, insert at 1.
    const next = moveTab(
      root,
      { paneId: "a", tabIndex: 0 },
      { paneId: "a", tabIndex: 2 },
    ) as LeafPane;
    expect(ids(next)).toEqual(["t1", "t0", "t2"]);
    expect(next.activeTabIndex).toBe(2); // t2 still active
  });

  it("appends when no target index is given", () => {
    const root = leaf("a", [term(0), term(1), term(2)], 1);
    const next = moveTab(
      root,
      { paneId: "a", tabIndex: 0 },
      { paneId: "a" },
    ) as LeafPane;
    expect(ids(next)).toEqual(["t1", "t2", "t0"]);
    expect(next.activeTabIndex).toBe(0); // t1 still active
  });

  it("keeps the moved tab active when it was active", () => {
    const root = leaf("a", [term(0), term(1), term(2)], 2);
    const next = moveTab(
      root,
      { paneId: "a", tabIndex: 2 },
      { paneId: "a", tabIndex: 0 },
    ) as LeafPane;
    expect(ids(next)).toEqual(["t2", "t0", "t1"]);
    expect(next.activeTabIndex).toBe(0);
  });

  it("no-ops when dropped on its own position or the next slot", () => {
    const root = leaf("a", [term(0), term(1), term(2)], 0);
    // Before itself…
    expect(
      moveTab(root, { paneId: "a", tabIndex: 1 }, { paneId: "a", tabIndex: 1 }),
    ).toBe(root);
    // …or before its right neighbour — both leave order unchanged.
    expect(
      moveTab(root, { paneId: "a", tabIndex: 1 }, { paneId: "a", tabIndex: 2 }),
    ).toBe(root);
  });

  it("clamps an out-of-range target index to append", () => {
    const root = leaf("a", [term(0), term(1)], 0);
    const next = moveTab(
      root,
      { paneId: "a", tabIndex: 0 },
      { paneId: "a", tabIndex: 99 },
    ) as LeafPane;
    expect(ids(next)).toEqual(["t1", "t0"]);
  });
});

describe("moveTab — cross leaf", () => {
  it("transfers a tab and makes it active in the target", () => {
    const root = split(
      leaf("a", [term(0), term(1)], 0),
      leaf("b", [term(2)], 0),
    );
    const next = moveTab(
      root,
      { paneId: "a", tabIndex: 1 },
      { paneId: "b", tabIndex: 0 },
    ) as SplitPane;
    expect(ids(next.first as LeafPane)).toEqual(["t0"]);
    expect(ids(next.second as LeafPane)).toEqual(["t1", "t2"]);
    expect((next.second as LeafPane).activeTabIndex).toBe(0);
  });

  it("appends to the target when no index is given", () => {
    const root = split(
      leaf("a", [term(0), term(1)], 0),
      leaf("b", [term(2)], 0),
    );
    const next = moveTab(
      root,
      { paneId: "a", tabIndex: 0 },
      { paneId: "b" },
    ) as SplitPane;
    expect(ids(next.second as LeafPane)).toEqual(["t2", "t0"]);
    expect((next.second as LeafPane).activeTabIndex).toBe(1);
  });

  it("collapses the source leaf when its last tab moves away", () => {
    const root = split(leaf("a", [term(0)], 0), leaf("b", [term(1)], 0));
    const next = moveTab(
      root,
      { paneId: "a", tabIndex: 0 },
      { paneId: "b" },
    ) as LeafPane;
    // The split disappears; only leaf b remains, holding both terminals.
    expect(next.kind).toBe("leaf");
    expect(next.id).toBe("b");
    expect(ids(next)).toEqual(["t1", "t0"]);
  });

  it("returns the original tree when the target leaf doesn't exist", () => {
    const root = split(leaf("a", [term(0)], 0), leaf("b", [term(1)], 0));
    const next = moveTab(
      root,
      { paneId: "a", tabIndex: 0 },
      { paneId: "nope" },
    );
    expect(next).toBe(root);
  });
});

describe("insertTab — restore to position", () => {
  it("inserts at the given index and activates it", () => {
    const root = leaf("a", [term(0), term(1)], 0);
    const next = insertTab(root, "a", 1, term(9)) as LeafPane;
    expect(ids(next)).toEqual(["t0", "t9", "t1"]);
    expect(next.activeTabIndex).toBe(1);
  });

  it("inserts at the front", () => {
    const root = leaf("a", [term(0)], 0);
    const next = insertTab(root, "a", 0, term(9)) as LeafPane;
    expect(ids(next)).toEqual(["t9", "t0"]);
    expect(next.activeTabIndex).toBe(0);
  });

  it("clamps an out-of-range index to append", () => {
    const root = leaf("a", [term(0), term(1)], 0);
    const next = insertTab(root, "a", 99, term(9)) as LeafPane;
    expect(ids(next)).toEqual(["t0", "t1", "t9"]);
    expect(next.activeTabIndex).toBe(2);
  });

  it("targets the right leaf in a split", () => {
    const root = split(leaf("a", [term(0)], 0), leaf("b", [term(1)], 0));
    const next = insertTab(root, "b", 0, term(9)) as SplitPane;
    expect(ids(next.first as LeafPane)).toEqual(["t0"]);
    expect(ids(next.second as LeafPane)).toEqual(["t9", "t1"]);
    expect((next.second as LeafPane).activeTabIndex).toBe(0);
  });
});

describe("setCollapsed", () => {
  it("marks a leaf collapsed and expands it back, only touching the target", () => {
    const root = split(leaf("a", [term(0)], 0), leaf("b", [term(1)], 0));
    const collapsed = setCollapsed(root, "a", true);
    expect(findLeaf(collapsed, "a")?.collapsed).toBe(true);
    expect(findLeaf(collapsed, "b")?.collapsed).toBeFalsy();
    const expanded = setCollapsed(collapsed, "a", false);
    expect(findLeaf(expanded, "a")?.collapsed).toBe(false);
  });
});

// The restore/cross-move handlers compose a tab-insert with an expand so a
// terminal never lands hidden behind a collapsed pane's header (code-review
// findings 2 & 3).
describe("surfacing a tab into a collapsed pane", () => {
  it("restore: insertTab into a collapsed pane, then expand → tab active, pane open", () => {
    const root = leaf("a", [term(0)], 0, true);
    const out = setCollapsed(insertTab(root, "a", 0, term(9)), "a", false) as LeafPane;
    expect(out.collapsed).toBe(false);
    expect(ids(out)).toEqual(["t9", "t0"]);
    expect(out.activeTabIndex).toBe(0);
  });

  it("cross-pane move into a collapsed target, then expand → moved tab active, pane open", () => {
    const root = split(
      leaf("a", [term(0), term(1)], 0),
      leaf("b", [term(2)], 0, true),
    );
    const out = setCollapsed(
      moveTab(root, { paneId: "a", tabIndex: 1 }, { paneId: "b" }),
      "b",
      false,
    ) as SplitPane;
    const b = out.second as LeafPane;
    expect(b.collapsed).toBe(false);
    expect(ids(b)).toEqual(["t2", "t1"]);
    expect(b.activeTabIndex).toBe(1);
  });
});

describe("moveTab — guards", () => {
  it("does not move unassigned (null) slots", () => {
    const root = split(leaf("a", [null, term(0)], 0), leaf("b", [], 0));
    expect(
      moveTab(root, { paneId: "a", tabIndex: 0 }, { paneId: "b" }),
    ).toBe(root);
  });

  it("no-ops on a missing source pane or out-of-range index", () => {
    const root = leaf("a", [term(0)], 0);
    expect(
      moveTab(root, { paneId: "zzz", tabIndex: 0 }, { paneId: "a" }),
    ).toBe(root);
    expect(
      moveTab(root, { paneId: "a", tabIndex: 5 }, { paneId: "a", tabIndex: 0 }),
    ).toBe(root);
  });
});
