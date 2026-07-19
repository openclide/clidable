import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  clearLayout,
  deleteTerminal,
  getTerminal,
  listTerminals,
  loadLayout,
  markDormant,
  saveLayout,
  setAgentRef,
  setTitle,
  touchTerminal,
  upsertTerminal,
} from "./terminal-store";

/** A fresh in-memory DB with just the tables the store touches. */
function freshDb(): Database {
  const d = new Database(":memory:", { strict: true });
  d.exec(`
    CREATE TABLE terminals (
      id TEXT PRIMARY KEY, project_uuid TEXT NOT NULL, agent_id TEXT NOT NULL,
      cwd TEXT NOT NULL, agent_ref TEXT, title TEXT,
      created_at INTEGER NOT NULL, last_active INTEGER NOT NULL,
      dormant INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE workspace_layout (
      project_uuid TEXT PRIMARY KEY, tree TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  return d;
}

describe("terminals — upsert & read", () => {
  it("inserts then reads back a record", () => {
    const db = freshDb();
    upsertTerminal({ id: "t1", projectUuid: "p1", agentId: "claude", cwd: "/tmp", title: "hi" }, db);
    const rec = getTerminal("t1", db)!;
    expect(rec.id).toBe("t1");
    expect(rec.agentId).toBe("claude");
    expect(rec.cwd).toBe("/tmp");
    expect(rec.title).toBe("hi");
    expect(rec.agentRef).toBeNull();
    expect(rec.dormant).toBe(false);
  });

  it("re-upsert preserves created_at + agent_ref + title, refreshes cwd, un-dormants", () => {
    const db = freshDb();
    upsertTerminal({ id: "t1", projectUuid: "p1", agentId: "claude", cwd: "/a", title: "keep" }, db);
    setAgentRef("t1", { kind: "id", value: "sess-1" }, db);
    markDormant("t1", true, db);
    const before = getTerminal("t1", db)!;

    upsertTerminal({ id: "t1", projectUuid: "p1", agentId: "claude", cwd: "/b" }, db);
    const after = getTerminal("t1", db)!;
    expect(after.createdAt).toBe(before.createdAt); // preserved
    expect(after.agentRef).toEqual({ kind: "id", value: "sess-1" }); // preserved
    expect(after.title).toBe("keep"); // preserved
    expect(after.cwd).toBe("/b"); // refreshed
    expect(after.dormant).toBe(false); // re-attach clears dormant
  });
});

describe("terminals — mutations", () => {
  it("setAgentRef round-trips and null-clears", () => {
    const db = freshDb();
    upsertTerminal({ id: "t1", projectUuid: "p1", agentId: "codex", cwd: "/x" }, db);
    setAgentRef("t1", { kind: "id", value: "abc" }, db);
    expect(getTerminal("t1", db)!.agentRef).toEqual({ kind: "id", value: "abc" });
    setAgentRef("t1", null, db);
    expect(getTerminal("t1", db)!.agentRef).toBeNull();
  });

  it("tolerates corrupt agent_ref JSON → null", () => {
    const db = freshDb();
    upsertTerminal({ id: "t1", projectUuid: "p1", agentId: "codex", cwd: "/x" }, db);
    db.query(`UPDATE terminals SET agent_ref = ? WHERE id = ?`).run("{not json", "t1");
    expect(getTerminal("t1", db)!.agentRef).toBeNull();
  });

  it("setTitle, touchTerminal, markDormant", () => {
    const db = freshDb();
    upsertTerminal({ id: "t1", projectUuid: "p1", agentId: "claude", cwd: "/x" }, db);
    setTitle("t1", "renamed", db);
    markDormant("t1", true, db);
    const before = getTerminal("t1", db)!;
    expect(before.title).toBe("renamed");
    expect(before.dormant).toBe(true);
    touchTerminal("t1", db);
    expect(getTerminal("t1", db)!.lastActive).toBeGreaterThanOrEqual(before.lastActive);
  });
});

describe("terminals — list & delete", () => {
  it("lists a project's terminals, most-recently-active first, scoped by project", () => {
    const db = freshDb();
    upsertTerminal({ id: "a", projectUuid: "p1", agentId: "claude", cwd: "/1" }, db);
    upsertTerminal({ id: "b", projectUuid: "p1", agentId: "codex", cwd: "/2" }, db);
    upsertTerminal({ id: "c", projectUuid: "p2", agentId: "claude", cwd: "/3" }, db);
    // Make `a` the most recently active.
    touchTerminal("a", db);
    const ids = listTerminals("p1", db).map((r) => r.id);
    expect(ids).toEqual(["a", "b"]); // p2's `c` excluded
  });

  it("deletes a terminal", () => {
    const db = freshDb();
    upsertTerminal({ id: "t1", projectUuid: "p1", agentId: "claude", cwd: "/x" }, db);
    deleteTerminal("t1", db);
    expect(getTerminal("t1", db)).toBeNull();
  });
});

describe("workspace layout", () => {
  it("saves, loads, overwrites, and clears the pane tree", () => {
    const db = freshDb();
    expect(loadLayout("p1", db)).toBeNull();
    saveLayout("p1", { kind: "leaf", id: "L1" }, db);
    expect(loadLayout("p1", db)).toEqual({ kind: "leaf", id: "L1" });
    saveLayout("p1", { kind: "split" }, db); // overwrite (one row per project)
    expect(loadLayout("p1", db)).toEqual({ kind: "split" });
    clearLayout("p1", db);
    expect(loadLayout("p1", db)).toBeNull();
  });
});
