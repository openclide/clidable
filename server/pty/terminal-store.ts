/**
 * Durable terminal records — the persisted RECORD half of a session (the
 * ephemeral PTY RUNTIME half lives in the in-memory SessionManager). Backed by
 * the SQLite `terminals` + `workspace_layout` tables.
 *
 *   upsertTerminal(input)          → insert on spawn / refresh + un-dormant on re-attach
 *   setAgentRef(id, ref)           → record the agent's own session ref (from its SessionStart hook)
 *   setTitle(id, title)            → user/agent-facing label
 *   touchTerminal(id)              → bump last_active
 *   markDormant(id, dormant)       → process reaped but record kept (lazy resume)
 *   getTerminal(id)                → single lookup
 *   listTerminals(projectUuid)     → a project's terminals, most-recently-active first
 *   deleteTerminal(id)             → forget a terminal (explicit close/kill)
 *   saveLayout / loadLayout / clearLayout(projectUuid)
 *                                  → the server-authoritative pane tree (JSON blob)
 *
 * Every function takes an optional `db` (defaults to the shared connection) so
 * the store is unit-testable against an in-memory database.
 */
import { Database } from "bun:sqlite";
import { openDb } from "../db";
import type { TerminalAgentId } from "../../shared/types";
import type { AgentSessionRef } from "./agent-resume";

export interface TerminalRecord {
  id: string;
  projectUuid: string;
  agentId: TerminalAgentId;
  cwd: string;
  /** The agent's own resumable session ref, or null until its hook reports. */
  agentRef: AgentSessionRef | null;
  title: string | null;
  createdAt: number;
  lastActive: number;
  /** Process has been reaped but the record is kept for lazy resume. */
  dormant: boolean;
}

interface TerminalRow {
  id: string;
  project_uuid: string;
  agent_id: string;
  cwd: string;
  agent_ref: string | null;
  title: string | null;
  created_at: number;
  last_active: number;
  dormant: number;
}

const SELECT_COLS =
  "id, project_uuid, agent_id, cwd, agent_ref, title, created_at, last_active, dormant";

function rowToRecord(r: TerminalRow): TerminalRecord {
  return {
    id: r.id,
    projectUuid: r.project_uuid,
    agentId: r.agent_id as TerminalAgentId,
    cwd: r.cwd,
    agentRef: parseAgentRef(r.agent_ref),
    title: r.title,
    createdAt: r.created_at,
    lastActive: r.last_active,
    dormant: r.dormant !== 0,
  };
}

/** Parse the stored agent_ref JSON, tolerating anything malformed → null. */
function parseAgentRef(json: string | null): AgentSessionRef | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    if (
      v &&
      typeof v === "object" &&
      ((v as AgentSessionRef).kind === "id" ||
        (v as AgentSessionRef).kind === "path") &&
      typeof (v as AgentSessionRef).value === "string"
    ) {
      return { kind: (v as AgentSessionRef).kind, value: (v as AgentSessionRef).value };
    }
  } catch {
    // fall through
  }
  return null;
}

export interface UpsertTerminalInput {
  id: string;
  projectUuid: string;
  agentId: TerminalAgentId;
  cwd: string;
  title?: string | null;
}

/**
 * Insert a terminal on first spawn, or — if it already exists — refresh its
 * cwd/agent/last_active and clear `dormant` (a re-attach means it's live
 * again). `created_at`, `agent_ref`, and `title` are preserved on conflict;
 * update those via their own setters.
 */
export function upsertTerminal(input: UpsertTerminalInput, db: Database = openDb()): void {
  const now = Date.now();
  db.query(
    `INSERT INTO terminals
       (id, project_uuid, agent_id, cwd, agent_ref, title, created_at, last_active, dormant)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       project_uuid = excluded.project_uuid,
       agent_id     = excluded.agent_id,
       cwd          = excluded.cwd,
       last_active  = excluded.last_active,
       dormant      = 0`,
  ).run(input.id, input.projectUuid, input.agentId, input.cwd, input.title ?? null, now, now);
}

export function setAgentRef(
  id: string,
  ref: AgentSessionRef | null,
  db: Database = openDb(),
): void {
  db.query(`UPDATE terminals SET agent_ref = ?, last_active = ? WHERE id = ?`).run(
    ref ? JSON.stringify(ref) : null,
    Date.now(),
    id,
  );
}

export function setTitle(id: string, title: string | null, db: Database = openDb()): void {
  db.query(`UPDATE terminals SET title = ? WHERE id = ?`).run(title, id);
}

export function touchTerminal(id: string, db: Database = openDb()): void {
  db.query(`UPDATE terminals SET last_active = ? WHERE id = ?`).run(Date.now(), id);
}

export function markDormant(id: string, dormant: boolean, db: Database = openDb()): void {
  db.query(`UPDATE terminals SET dormant = ? WHERE id = ?`).run(dormant ? 1 : 0, id);
}

export function getTerminal(id: string, db: Database = openDb()): TerminalRecord | null {
  const row = db
    .query<TerminalRow, [string]>(
      `SELECT ${SELECT_COLS} FROM terminals WHERE id = ? LIMIT 1`,
    )
    .get(id);
  return row ? rowToRecord(row) : null;
}

export function listTerminals(projectUuid: string, db: Database = openDb()): TerminalRecord[] {
  return db
    .query<TerminalRow, [string]>(
      `SELECT ${SELECT_COLS} FROM terminals
         WHERE project_uuid = ? ORDER BY last_active DESC`,
    )
    .all(projectUuid)
    .map(rowToRecord);
}

export function deleteTerminal(id: string, db: Database = openDb()): void {
  db.query(`DELETE FROM terminals WHERE id = ?`).run(id);
}

/** Persist a project's pane tree (server-authoritative layout). */
export function saveLayout(projectUuid: string, tree: unknown, db: Database = openDb()): void {
  db.query(
    `INSERT INTO workspace_layout (project_uuid, tree, updated_at)
       VALUES (?, ?, ?)
     ON CONFLICT(project_uuid) DO UPDATE SET
       tree       = excluded.tree,
       updated_at = excluded.updated_at`,
  ).run(projectUuid, JSON.stringify(tree), Date.now());
}

/** Load a project's saved pane tree, or null if none / corrupt. */
export function loadLayout(projectUuid: string, db: Database = openDb()): unknown | null {
  const row = db
    .query<{ tree: string }, [string]>(
      `SELECT tree FROM workspace_layout WHERE project_uuid = ? LIMIT 1`,
    )
    .get(projectUuid);
  if (!row) return null;
  try {
    return JSON.parse(row.tree);
  } catch {
    return null;
  }
}

export function clearLayout(projectUuid: string, db: Database = openDb()): void {
  db.query(`DELETE FROM workspace_layout WHERE project_uuid = ?`).run(projectUuid);
}
