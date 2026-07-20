/**
 * Workspace registry — the persisted unit of work. A workspace is the whole
 * multi-project session snapshot: its ordered open projects, the pane tree, the
 * minimized-terminals dock, and which project is active. A 1-project workspace
 * is the common case and behaves like the old single-project layout. Backed by
 * the SQLite `workspaces` table.
 *
 *   listWorkspaces()              → summaries, most-recently-opened first
 *   getWorkspace(id)              → full state (tree + minimized parsed)
 *   createWorkspace({projectIds}) → mint a fresh workspace (client seeds the tree)
 *   saveWorkspace(id, state)      → persist tree/openProjects/active/minimized
 *   touchWorkspace(id)            → bump last_opened (re-rank in recents)
 *   removeWorkspace(id)           → forget a workspace + kill its terminals
 *
 * `tree` and `minimized` are opaque JSON the client owns (Pane / Minimized-
 * Terminal[]); the server round-trips them and only walks them — to collect
 * terminal ids on delete. Projects are referenced by their stable UUID and
 * resolved through the project registry on read (dropping any since removed).
 */
import { openDb } from "../db";
import { getProjectsByIds } from "../projects";
import { sessionManager } from "../pty/manager";
import { deleteTerminal } from "../pty/terminal-store";
import type { Project, WorkspaceFull, WorkspaceSummary } from "../../shared/types";
import type { Database } from "bun:sqlite";

interface WorkspaceRow {
  id: string;
  name: string | null;
  tree: string | null;
  open_projects: string;
  active_project: string | null;
  minimized: string | null;
  created_at: number;
  last_opened: number;
}

const SELECT_COLS =
  "id, name, tree, open_projects, active_project, minimized, created_at, last_opened";

/** Parse a stored JSON column, tolerating anything malformed → null. */
function parseJson(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Parse the ordered open-project id list; always an array of strings. */
function parseProjectIds(json: string): string[] {
  const v = parseJson(json);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * Resolve a workspace's open-project ids to Project records, IN the stored
 * order (the tab order), dropping any project that has since been removed from
 * the registry. Reads from a pre-fetched `byId` map so listing many workspaces
 * costs one project query total, not one per project (no N+1).
 */
function resolveProjects(
  openProjectIds: string[],
  byId: Map<string, Project>,
): Project[] {
  const out: Project[] = [];
  for (const id of openProjectIds) {
    const p = byId.get(id);
    if (p) out.push(p);
  }
  return out;
}

function rowToSummary(
  r: WorkspaceRow,
  byId: Map<string, Project>,
): WorkspaceSummary | null {
  const projects = resolveProjects(parseProjectIds(r.open_projects), byId);
  // A workspace whose projects have all been removed is unopenable — omit it.
  if (projects.length === 0) return null;
  return {
    id: r.id,
    name: r.name,
    projects,
    createdAt: r.created_at,
    lastOpened: r.last_opened,
  };
}

export function listWorkspaces(db: Database = openDb()): WorkspaceSummary[] {
  const rows = db
    .query<WorkspaceRow, []>(
      `SELECT ${SELECT_COLS} FROM workspaces ORDER BY last_opened DESC`,
    )
    .all();
  // One query for every project referenced across the whole list.
  const allIds = [...new Set(rows.flatMap((r) => parseProjectIds(r.open_projects)))];
  const byId = getProjectsByIds(allIds, db);
  return rows
    .map((r) => rowToSummary(r, byId))
    .filter((w): w is WorkspaceSummary => w !== null);
}

export function getWorkspace(id: string, db: Database = openDb()): WorkspaceFull | null {
  const row = db
    .query<WorkspaceRow, [string]>(
      `SELECT ${SELECT_COLS} FROM workspaces WHERE id = ? LIMIT 1`,
    )
    .get(id);
  if (!row) return null;
  const byId = getProjectsByIds(parseProjectIds(row.open_projects), db);
  const summary = rowToSummary(row, byId);
  if (!summary) return null;
  return {
    ...summary,
    // The stored id order, kept verbatim so the client restores tab order even
    // where a project resolved out (summary.projects drops those).
    openProjects: parseProjectIds(row.open_projects),
    activeProjectId: row.active_project,
    tree: parseJson(row.tree),
    minimized: parseJson(row.minimized),
  };
}

export interface CreateWorkspaceInput {
  projectIds: string[];
  name?: string | null;
}

/** Create a fresh workspace. `tree`/`minimized` start NULL — the client seeds
 *  the initial terminal on first mount and persists it via saveWorkspace. */
export function createWorkspace(
  input: CreateWorkspaceInput,
  db: Database = openDb(),
): WorkspaceFull {
  // At least one project must be registered — otherwise the workspace would be
  // unopenable (getWorkspace drops all projects → null) and we'd leave an orphan
  // row. Validate up front so we never insert one.
  const registered = getProjectsByIds(input.projectIds, db);
  if (registered.size === 0) {
    throw new Error(
      `cannot create a workspace: no registered project among [${input.projectIds.join(", ")}]`,
    );
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  // Active project must be one that actually resolves — pick the first REGISTERED
  // id in tab order, not blindly projectIds[0] (which could be an unregistered id
  // that resolves out on read, leaving a dangling active_project).
  const active = input.projectIds.find((pid) => registered.has(pid)) ?? null;
  db.query(
    `INSERT INTO workspaces
       (id, name, tree, open_projects, active_project, minimized, created_at, last_opened)
     VALUES (?, ?, NULL, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.name ?? null,
    JSON.stringify(input.projectIds),
    active,
    now,
    now,
  );
  const ws = getWorkspace(id, db);
  if (!ws) throw new Error(`workspace vanished immediately after create: ${id}`);
  return ws;
}

export interface SaveWorkspaceInput {
  name?: string | null;
  tree: unknown;
  openProjects: string[];
  activeProjectId: string | null;
  minimized: unknown;
}

/** Persist a workspace's live state. Bumps last_active-style recency is handled
 *  by touchWorkspace on open, not here, so a background autosave doesn't re-rank. */
export function saveWorkspace(
  id: string,
  state: SaveWorkspaceInput,
  db: Database = openDb(),
): void {
  db.query(
    `UPDATE workspaces SET
       name           = COALESCE(?, name),
       tree           = ?,
       open_projects  = ?,
       active_project = ?,
       minimized      = ?
     WHERE id = ?`,
  ).run(
    state.name ?? null,
    state.tree === null || state.tree === undefined ? null : JSON.stringify(state.tree),
    JSON.stringify(state.openProjects),
    state.activeProjectId,
    state.minimized === null || state.minimized === undefined
      ? null
      : JSON.stringify(state.minimized),
    id,
  );
}

export function touchWorkspace(id: string, db: Database = openDb()): void {
  db.query(`UPDATE workspaces SET last_opened = ? WHERE id = ?`).run(Date.now(), id);
}

/**
 * Forget a workspace and clean up the terminals it owned — walk the stored tree
 * + minimized dock for their session ids and kill each (the reaper only collects
 * sessions that were live in this process; a dormant record no client re-attached
 * to would otherwise linger forever). Never touches the user's files.
 */
export function removeWorkspace(id: string, db: Database = openDb()): void {
  const row = db
    .query<WorkspaceRow, [string]>(
      `SELECT ${SELECT_COLS} FROM workspaces WHERE id = ? LIMIT 1`,
    )
    .get(id);
  if (row) {
    const now = Date.now();
    for (const terminalId of collectTerminalIds(parseJson(row.tree), parseJson(row.minimized))) {
      // Don't kill a PTY that's still ATTACHED in another window/tab (the same
      // workspace opened via "open in new window" shares these session ids) —
      // yanking it would kill live terminals under that surface. `detachedFor()
      // === null` means a subscriber/retainer still holds it, so leave the PTY
      // running and let the reaper collect it once that window detaches; only
      // drop the durable record so a later resume won't bring it back. When
      // nothing's attached, kill() drops the (dormant) PTY outright.
      const live = sessionManager.get(terminalId);
      if (!live || live.detachedFor(now) !== null) sessionManager.kill(terminalId);
      try {
        deleteTerminal(terminalId, db);
      } catch {
        // non-critical
      }
    }
  }
  db.query(`DELETE FROM workspaces WHERE id = ?`).run(id);
}

/**
 * Collect every terminal session id referenced by a workspace's pane tree and
 * minimized dock. Fully tolerant of malformed shapes (returns what it can) —
 * the tree/minimized are client-owned blobs.
 */
export function collectTerminalIds(tree: unknown, minimized: unknown): string[] {
  const ids = new Set<string>();
  const walkPane = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { kind?: unknown; tabs?: unknown; first?: unknown; second?: unknown };
    if (n.kind === "leaf" && Array.isArray(n.tabs)) {
      for (const tab of n.tabs) pushId(tab);
    } else if (n.kind === "split") {
      walkPane(n.first);
      walkPane(n.second);
    }
  };
  const pushId = (tab: unknown): void => {
    if (!tab || typeof tab !== "object") return;
    const iid = (tab as { instanceId?: unknown }).instanceId;
    if (typeof iid === "string" && iid) ids.add(iid);
  };
  walkPane(tree);
  if (Array.isArray(minimized)) {
    for (const m of minimized) {
      if (m && typeof m === "object") pushId((m as { tab?: unknown }).tab);
    }
  }
  return [...ids];
}
