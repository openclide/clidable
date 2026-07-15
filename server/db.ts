/**
 * SQLite via bun:sqlite. Single file at <data>/clidable.db.
 *
 * Schema migrations are versioned via PRAGMA user_version. Add a new
 * migration step at the end of MIGRATIONS; old installs catch up on start.
 */
import { Database } from "bun:sqlite";
import { paths } from "./paths";

let db: Database | null = null;

/**
 * Each entry is the SQL that takes the schema from version (index) → (index+1).
 * Append-only. Never edit a past migration.
 */
const MIGRATIONS: string[] = [
  // 0 → 1: bootstrap tables. Most are placeholders for now; later steps fill them.
  `
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,        -- ULID/UUID from <project>/.clidable/project-id
    name        TEXT NOT NULL,
    path        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    last_opened INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // 1 → 2: checkpoints table. One row per composer Send, even when the
  // working tree is unchanged (noop = 1, sha = NULL) — so the timeline
  // stays dense and parallel to the user's actual messages without
  // bloating the shadow repo with empty commits.
  //
  // No FOREIGN KEY to projects.id: the `projects` table isn't populated
  // by the checkpoint path (a project becomes "known" the first time
  // anything writes to it; we don't want the checkpoint write to also
  // be the implicit project-create). Listing handlers join by uuid
  // anyway.
  `
  CREATE TABLE IF NOT EXISTS checkpoints (
    id            TEXT PRIMARY KEY,         -- UUID
    project_uuid  TEXT NOT NULL,
    sha           TEXT,                     -- NULL for noop checkpoints
    created_at    INTEGER NOT NULL,         -- ms since epoch
    agent_id      TEXT NOT NULL,            -- 'claude' | 'codex' | ...
    terminal_id   TEXT NOT NULL,            -- PTY session id at trigger time
    message       TEXT NOT NULL,            -- composer text (truncation is upstream's call)
    is_initial    INTEGER NOT NULL DEFAULT 0,
    noop          INTEGER NOT NULL DEFAULT 0,
    screenshot    TEXT                      -- relative path under screenshotsDir, or NULL
  );

  CREATE INDEX IF NOT EXISTS checkpoints_project_time
    ON checkpoints (project_uuid, created_at DESC);

  CREATE INDEX IF NOT EXISTS checkpoints_project_terminal_time
    ON checkpoints (project_uuid, terminal_id, created_at DESC);
  `,

  // 2 → 3: framework hint on projects. Detected on open (package.json,
  // Cargo.toml, etc.) and refreshed each open. Nullable for rows written
  // before this column existed; readers coalesce NULL → 'unknown'.
  `
  ALTER TABLE projects ADD COLUMN framework TEXT;
  `,
];

export function openDb(): Database {
  if (db) return db;
  db = new Database(paths.db, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(d: Database): void {
  const row = d.query<{ user_version: number }, []>(
    "PRAGMA user_version",
  ).get();
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v];
    if (!sql) continue;
    d.transaction(() => {
      d.exec(sql);
      d.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}
