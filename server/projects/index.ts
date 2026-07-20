/**
 * Project registry — the source of truth for "what folders does the user
 * work in." Backed by the SQLite `projects` table.
 *
 *   listProjects()            → all projects, most-recently-opened first
 *   openProject(projectPath)  → mint/read UUID, detect, upsert, return Project
 *   touchProject(id)          → bump last_opened (re-rank in recents)
 *   getProject(id)            → single lookup
 *   removeProject(id)         → forget a project (registry only; never deletes
 *                               the user's files or the .clidable/ marker)
 *
 * The UUID is owned by `<project>/.clidable/project-id` (see
 * checkpoints/project.ts) so it survives rename/move — the table's `path`
 * is just the last-known location, refreshed on each open.
 */
import { stat } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { openDb } from "../db";
import { ensureProjectUuid } from "../checkpoints/project";
import { detectProject } from "./detect";
import type { Project, ProjectFramework } from "../../shared/types";

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: number;
  last_opened: number;
  framework: string | null;
}

const SELECT_COLS =
  "id, name, path, created_at, last_opened, framework";

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    createdAt: r.created_at,
    lastOpened: r.last_opened,
    framework: (r.framework ?? "unknown") as ProjectFramework,
  };
}

export function listProjects(): Project[] {
  const db = openDb();
  const rows = db
    .query<ProjectRow, []>(
      `SELECT ${SELECT_COLS} FROM projects ORDER BY last_opened DESC`,
    )
    .all();
  return rows.map(rowToProject);
}

export function getProject(id: string, db: Database = openDb()): Project | null {
  const row = db
    .query<ProjectRow, [string]>(
      `SELECT ${SELECT_COLS} FROM projects WHERE id = ? LIMIT 1`,
    )
    .get(id);
  return row ? rowToProject(row) : null;
}

/**
 * Batch-resolve many project ids in a single query → a `Map<id, Project>` (ids
 * with no registered project are simply absent). Lets callers that hold a list
 * of ids (e.g. a workspace's open projects) avoid an N+1 of `getProject`.
 */
export function getProjectsByIds(
  ids: string[],
  db: Database = openDb(),
): Map<string, Project> {
  const map = new Map<string, Project>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .query<ProjectRow, string[]>(
      `SELECT ${SELECT_COLS} FROM projects WHERE id IN (${placeholders})`,
    )
    .all(...ids);
  for (const r of rows) map.set(r.id, rowToProject(r));
  return map;
}

/**
 * Open (or register) a project at `projectPath`. Idempotent — opening an
 * already-known project just refreshes its name/path/framework and bumps
 * last_opened. The path must be an existing directory.
 */
export async function openProject(projectPath: string): Promise<Project> {
  const st = await stat(projectPath).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw new Error(`not a directory: ${projectPath}`);
  }

  const id = await ensureProjectUuid(projectPath);
  const { name, framework } = await detectProject(projectPath);
  const now = Date.now();

  const db = openDb();
  // Upsert keyed on the UUID. created_at is preserved on conflict (it's not
  // in the SET clause); everything else refreshes so a moved/renamed project
  // re-syncs its path + name.
  db.query(
    `INSERT INTO projects (id, name, path, created_at, last_opened, framework)
       VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name        = excluded.name,
       path        = excluded.path,
       last_opened = excluded.last_opened,
       framework   = excluded.framework`,
  ).run(id, name, projectPath, now, now, framework);

  const project = getProject(id);
  if (!project) {
    // Should be impossible (we just inserted), but never return undefined.
    throw new Error(`project vanished immediately after upsert: ${id}`);
  }
  return project;
}

export function touchProject(id: string): void {
  const db = openDb();
  db.query(`UPDATE projects SET last_opened = ? WHERE id = ?`).run(
    Date.now(),
    id,
  );
}

/** Forget a project from the registry. Does NOT touch the user's files. */
export function removeProject(id: string): void {
  const db = openDb();
  db.query(`DELETE FROM projects WHERE id = ?`).run(id);
}
