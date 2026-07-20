import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  collectTerminalIds,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  saveWorkspace,
  touchWorkspace,
} from "./index";

/** A fresh in-memory DB with the `workspaces` + `projects` tables the module
 *  touches (project resolution runs through getProject against the same db). */
function freshDb(): Database {
  const d = new Database(":memory:", { strict: true });
  d.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_opened INTEGER NOT NULL, framework TEXT
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, name TEXT, tree TEXT, open_projects TEXT NOT NULL,
      active_project TEXT, minimized TEXT,
      created_at INTEGER NOT NULL, last_opened INTEGER NOT NULL
    );
  `);
  return d;
}

function addProject(db: Database, id: string, name = id): void {
  const now = Date.now();
  db.query(
    `INSERT INTO projects (id, name, path, created_at, last_opened, framework)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, name, `/tmp/${id}`, now, now, "unknown");
}

describe("workspaces — create & get", () => {
  it("creates a fresh workspace and reads it back (null tree/minimized)", () => {
    const db = freshDb();
    addProject(db, "p1", "Alpha");
    const ws = createWorkspace({ projectIds: ["p1"] }, db);
    expect(ws.openProjects).toEqual(["p1"]);
    expect(ws.activeProjectId).toBe("p1");
    expect(ws.tree).toBeNull();
    expect(ws.minimized).toBeNull();
    expect(ws.name).toBeNull();
    expect(ws.projects.map((p) => p.name)).toEqual(["Alpha"]);

    const got = getWorkspace(ws.id, db)!;
    expect(got.id).toBe(ws.id);
    expect(got.projects.map((p) => p.id)).toEqual(["p1"]);
  });

  it("getWorkspace returns null for an unknown id", () => {
    const db = freshDb();
    expect(getWorkspace("nope", db)).toBeNull();
  });
});

describe("workspaces — list & project resolution", () => {
  it("orders by last_opened DESC and resolves projects in tab order", () => {
    const db = freshDb();
    addProject(db, "p1");
    addProject(db, "p2");
    const a = createWorkspace({ projectIds: ["p1"] }, db);
    const b = createWorkspace({ projectIds: ["p2", "p1"] }, db);
    // Make `a` most-recently-opened.
    touchWorkspace(a.id, db);

    const list = listWorkspaces(db);
    expect(list.map((w) => w.id)).toEqual([a.id, b.id]);
    // Multi-project workspace keeps its stored tab order (p2 before p1).
    expect(list.find((w) => w.id === b.id)!.projects.map((p) => p.id)).toEqual([
      "p2",
      "p1",
    ]);
  });

  it("drops a removed project but keeps the workspace", () => {
    const db = freshDb();
    addProject(db, "p1");
    addProject(db, "p2");
    const ws = createWorkspace({ projectIds: ["p1", "p2"] }, db);
    db.query(`DELETE FROM projects WHERE id = ?`).run("p2");
    const got = getWorkspace(ws.id, db)!;
    expect(got.projects.map((p) => p.id)).toEqual(["p1"]);
    // The raw stored id order is preserved even where a project resolved out.
    expect(got.openProjects).toEqual(["p1", "p2"]);
  });

  it("omits a workspace whose projects have all been removed", () => {
    const db = freshDb();
    addProject(db, "p1");
    const ws = createWorkspace({ projectIds: ["p1"] }, db);
    db.query(`DELETE FROM projects WHERE id = ?`).run("p1");
    expect(listWorkspaces(db)).toEqual([]);
    expect(getWorkspace(ws.id, db)).toBeNull();
  });
});

describe("workspaces — save", () => {
  it("round-trips tree + minimized as parsed JSON and keeps name on null", () => {
    const db = freshDb();
    addProject(db, "p1");
    addProject(db, "p2");
    const ws = createWorkspace({ projectIds: ["p1"] }, db);
    const tree = { kind: "leaf", id: "pane-1", tabs: [{ instanceId: "t1" }] };
    saveWorkspace(
      ws.id,
      {
        tree,
        openProjects: ["p1", "p2"],
        activeProjectId: "p2",
        minimized: [{ tab: { instanceId: "t9" } }],
      },
      db,
    );
    const got = getWorkspace(ws.id, db)!;
    expect(got.tree).toEqual(tree); // parsed object, not a string
    expect(got.minimized).toEqual([{ tab: { instanceId: "t9" } }]);
    expect(got.openProjects).toEqual(["p1", "p2"]);
    expect(got.activeProjectId).toBe("p2");
    expect(got.name).toBeNull(); // save with no name keeps existing (null)

    saveWorkspace(
      ws.id,
      { name: "Renamed", tree: null, openProjects: ["p1"], activeProjectId: "p1", minimized: null },
      db,
    );
    const renamed = getWorkspace(ws.id, db)!;
    expect(renamed.name).toBe("Renamed");
    expect(renamed.tree).toBeNull();
  });
});

describe("workspaces — remove", () => {
  it("deletes the workspace row", () => {
    const db = freshDb();
    addProject(db, "p1");
    const ws = createWorkspace({ projectIds: ["p1"] }, db);
    removeWorkspace(ws.id, db); // tree is null → no terminal cleanup path
    expect(getWorkspace(ws.id, db)).toBeNull();
  });
});

describe("collectTerminalIds", () => {
  it("walks a split tree + minimized dock, tolerating malformed nodes", () => {
    const tree = {
      kind: "split",
      first: { kind: "leaf", tabs: [{ instanceId: "a" }, null, { instanceId: "b" }] },
      second: {
        kind: "split",
        first: { kind: "leaf", tabs: [{ instanceId: "c" }] },
        second: { kind: "leaf", tabs: [{ nope: true }] }, // no instanceId → skipped
      },
    };
    const minimized = [{ tab: { instanceId: "d" } }, { tab: null }, "junk"];
    const ids = collectTerminalIds(tree, minimized).sort();
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("returns [] for null / non-object inputs", () => {
    expect(collectTerminalIds(null, null)).toEqual([]);
    expect(collectTerminalIds("x", 5)).toEqual([]);
  });
});
