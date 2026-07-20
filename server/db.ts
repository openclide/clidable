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

  -- Durable sessions. A terminal is a persisted RECORD (this table) distinct
  -- from its ephemeral PTY RUNTIME (in-memory SessionManager) — so a session
  -- survives reload/restart/crash and looks identical from any client. The id
  -- column is the ULID that replaces the old time-based instanceId.
  --   • agent_ref — JSON {kind:'id'|'path', value} captured from the agent's own
  --     SessionStart hook; drives agent-native resume (claude --resume …). NULL
  --     until the hook reports, or for agents with no resume support.
  --   • dormant — 1 once the PTY process has been reaped but the record is kept
  --     for lazy resume (decouples "process alive" from "terminal exists").
  -- Scrollback is NOT here — it lives as a per-terminal .scroll file under the
  -- project data dir (bytes, atomic+debounced), replayed on attach.
  CREATE TABLE IF NOT EXISTS terminals (
    id            TEXT PRIMARY KEY,        -- ULID (replaces instanceId)
    project_uuid  TEXT NOT NULL,
    agent_id      TEXT NOT NULL,           -- 'claude' | 'codex' | ...
    cwd           TEXT NOT NULL,
    agent_ref     TEXT,                    -- JSON {kind,value} | NULL
    title         TEXT,
    created_at    INTEGER NOT NULL,        -- ms since epoch
    last_active   INTEGER NOT NULL,
    dormant       INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS terminals_project
    ON terminals (project_uuid, last_active DESC);

  -- One row per project: the server-authoritative pane tree (stable terminal
  -- ids, per-leaf zoomed/collapsed bits, minimized set) as a JSON blob, so web
  -- and the Mac app render the same layout and a restart rehydrates it.
  CREATE TABLE IF NOT EXISTS workspace_layout (
    project_uuid  TEXT PRIMARY KEY,
    tree          TEXT NOT NULL,           -- JSON pane tree
    updated_at    INTEGER NOT NULL
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

  // 3 → 4: workspaces. The persisted unit is now a WORKSPACE — the whole
  // multi-project session snapshot (its ordered open projects, the pane tree,
  // the minimized-terminals dock, the active project) — not a single project's
  // layout. A 1-project workspace is the common case and behaves like the old
  // single-project layout did. `workspace_layout` (one tree per project) is
  // superseded and dropped; it landed unshipped last commit, so no data to keep.
  //   • open_projects — JSON ordered [projectId,…]; the tab order, distinct from
  //     the tree's leaf order (a project can be open with all its terminals
  //     minimized, i.e. absent from the tree).
  //   • tree / minimized — opaque JSON blobs the client owns (Pane / Minimized-
  //     Terminal[]); the server round-trips them and only walks them to collect
  //     terminal ids on delete. NULL tree = fresh workspace the client seeds.
  //   • name — optional user override; NULL means the client derives the label
  //     from the resolved projects (so a project rename is reflected live).
  `
  CREATE TABLE IF NOT EXISTS workspaces (
    id             TEXT PRIMARY KEY,        -- crypto.randomUUID()
    name           TEXT,                    -- user override | NULL (client derives)
    tree           TEXT,                    -- JSON Pane | NULL (fresh → client seeds)
    open_projects  TEXT NOT NULL,           -- JSON ordered [projectId,…] (tab order)
    active_project TEXT,                    -- projectId | NULL
    minimized      TEXT,                    -- JSON MinimizedTerminal[] | NULL
    created_at     INTEGER NOT NULL,        -- ms since epoch
    last_opened    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS workspaces_last_opened
    ON workspaces (last_opened DESC);

  DROP TABLE IF EXISTS workspace_layout;
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
