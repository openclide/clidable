/**
 * High-level checkpoint API. Wraps the lock + UUID + shadow git +
 * SQLite layers underneath into two operations the HTTP routes (M2+)
 * call directly:
 *
 *   createCheckpoint({projectPath, agentId, terminalId, message})
 *     → snapshot working tree, insert SQLite row, return checkpoint
 *
 *   listCheckpoints(projectPath, opts?)
 *     → recent checkpoints, optionally filtered by terminalId
 *
 * Restore lands in M4. Diff source variants land in M5.
 *
 * Concurrency: createCheckpoint takes the per-project lock for the
 * whole snapshot. listCheckpoints is read-only and lock-free.
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openDb } from "../db";
import { withProjectLock } from "./lock";
import { screenshotsDir, shadowGitDir } from "./paths";
import { ensureProjectUuid } from "./project";
import {
  commit,
  ensureShadowRepo,
  git,
  hasHead,
  stageAll,
} from "./shadow";

/** Mirrors the row shape on the wire; SQLite uses INTEGER 0/1 booleans. */
export interface Checkpoint {
  id: string;
  projectUuid: string;
  /** Null when noop. Real shadow-git SHA otherwise. */
  sha: string | null;
  createdAt: number;
  agentId: string;
  terminalId: string;
  message: string;
  isInitial: boolean;
  noop: boolean;
  /** Relative path under screenshotsDir, or null. Wired in later. */
  screenshot: string | null;
}

export interface CreateCheckpointInput {
  /** Absolute path to the project root. */
  projectPath: string;
  /** Agent that fired the composer Send. */
  agentId: string;
  /** PTY session id at trigger time. */
  terminalId: string;
  /** Composer text. Empty string = initial-state checkpoint. */
  message: string;
  /** Optional base64 PNG (no data: prefix) of the preview pane. */
  screenshot?: string;
}

export interface ListCheckpointsOptions {
  /** Restrict to a single terminal session. Omit for project-wide. */
  terminalId?: string;
  /** Cap on rows returned. Default 100 — matches retention policy. */
  limit?: number;
}

/* ---------------------------------------------------------------------------
 * Internal — row mapping
 * ------------------------------------------------------------------------- */

interface CheckpointRow {
  id: string;
  project_uuid: string;
  sha: string | null;
  created_at: number;
  agent_id: string;
  terminal_id: string;
  message: string;
  is_initial: number;
  noop: number;
  screenshot: string | null;
}

function rowToCheckpoint(r: CheckpointRow): Checkpoint {
  return {
    id: r.id,
    projectUuid: r.project_uuid,
    sha: r.sha,
    createdAt: r.created_at,
    agentId: r.agent_id,
    terminalId: r.terminal_id,
    message: r.message,
    isInitial: r.is_initial === 1,
    noop: r.noop === 1,
    screenshot: r.screenshot,
  };
}

/* ---------------------------------------------------------------------------
 * createCheckpoint
 * ------------------------------------------------------------------------- */

export async function createCheckpoint(
  input: CreateCheckpointInput,
): Promise<Checkpoint> {
  const projectUuid = await ensureProjectUuid(input.projectPath);

  return await withProjectLock(projectUuid, async () => {
    await ensureShadowRepo(projectUuid, input.projectPath);

    // Detect whether this is the first checkpoint *before* doing the
    // stage — if HEAD doesn't exist yet, we want is_initial = 1 even
    // when the working tree happens to be unchanged from… nothing.
    const firstCheckpoint = !(await hasHead(projectUuid, input.projectPath));

    const { porcelain } = await stageAll(projectUuid, input.projectPath);
    const hasChanges = porcelain.trim().length > 0;
    const isNoop = !hasChanges && !firstCheckpoint;

    let sha: string | null = null;
    if (!isNoop) {
      // Initial checkpoint always commits (even with empty index) so
      // a HEAD exists for subsequent diff comparisons.
      sha = await commit(
        projectUuid,
        input.projectPath,
        firstCheckpoint
          ? "checkpoint: initial"
          : commitMessageFor(input.message),
      );
    }

    const id = randomUUID();

    // Persist the optional preview screenshot. Best-effort: a write
    // failure must not sink the checkpoint, so we swallow it and record
    // a null screenshot. Stored as `<id>.png` under the project's
    // screenshots dir; the column holds just the basename.
    let screenshot: string | null = null;
    if (input.screenshot) {
      screenshot = await writeScreenshot(projectUuid, id, input.screenshot)
        .catch((e) => {
          console.error("[checkpoints] screenshot write failed:", e);
          return null;
        });
    }

    const row: CheckpointRow = {
      id,
      project_uuid: projectUuid,
      sha,
      created_at: Date.now(),
      agent_id: input.agentId,
      terminal_id: input.terminalId,
      message: input.message,
      is_initial: firstCheckpoint ? 1 : 0,
      noop: isNoop ? 1 : 0,
      screenshot,
    };

    const db = openDb();
    // Positional `?` bindings instead of named — bun:sqlite's strict-mode
    // type overload for named bindings can't infer that CheckpointRow's
    // values all satisfy SQLQueryBindings, even though they do.
    db.query(
      `INSERT INTO checkpoints
        (id, project_uuid, sha, created_at, agent_id, terminal_id,
         message, is_initial, noop, screenshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.project_uuid,
      row.sha,
      row.created_at,
      row.agent_id,
      row.terminal_id,
      row.message,
      row.is_initial,
      row.noop,
      row.screenshot,
    );

    return rowToCheckpoint(row);
  });
}

/**
 * Decode a base64 PNG and write it to `<screenshotsDir>/<id>.png`.
 * Returns the basename to store on the checkpoint row.
 */
async function writeScreenshot(
  projectUuid: string,
  checkpointId: string,
  base64: string,
): Promise<string> {
  const dir = screenshotsDir(projectUuid);
  await mkdir(dir, { recursive: true });
  const file = `${checkpointId}.png`;
  await Bun.write(join(dir, file), Buffer.from(base64, "base64"));
  return file;
}

/**
 * Resolve a checkpoint id to the absolute path of its screenshot PNG,
 * or null when the checkpoint has none. Used by the serve route, which
 * only has the checkpoint id on the wire (not the project path).
 */
export function resolveScreenshotPath(checkpointId: string): string | null {
  const db = openDb();
  const row = db
    .query<{ project_uuid: string; screenshot: string | null }, [string]>(
      "SELECT project_uuid, screenshot FROM checkpoints WHERE id = ? LIMIT 1",
    )
    .get(checkpointId);
  if (!row || !row.screenshot) return null;
  return join(screenshotsDir(row.project_uuid), row.screenshot);
}

/**
 * Commit message format. Truncated upstream messages are fine — git
 * will show whatever it gets. Keeping the format stable here makes
 * `git log` greppable without a SQLite round-trip.
 */
function commitMessageFor(text: string): string {
  // Strip CRs, collapse whitespace runs into single spaces; cap at
  // 200 chars so terminal-printed git log stays one screen wide.
  const oneLine = text.replace(/\s+/g, " ").trim();
  const head = oneLine.length > 200 ? oneLine.slice(0, 199) + "…" : oneLine;
  return `checkpoint: ${head || "(empty message)"}`;
}

/* ---------------------------------------------------------------------------
 * restoreCheckpoint
 *
 * Rewinds the project's working tree to the state captured at the
 * given checkpoint. Mechanism:
 *
 *   git --git-dir=<shadow> --work-tree=<project> reset --hard <sha>
 *
 * This resets HEAD + index + working tree to <sha>. We don't try to
 * preserve the post-restore history — the shadow git's HEAD jumps
 * back, and future checkpoints (which always commit on top of HEAD)
 * grow from that point. Old commits become unreachable in git but the
 * SQLite rows survive, so the timeline UI still shows them and the
 * user can still diff-against / restore-from them by SHA.
 *
 * Noop handling: checkpoints with `sha === null` (no working-tree
 * changes since the previous checkpoint) get resolved to the most
 * recent prior non-null SHA in SQLite — restoring to "the state at
 * the moment of the noop" is the same as restoring to its parent.
 *
 * Concurrency: the entire restore runs under the project lock so a
 * concurrent createCheckpoint can't race the working-tree update.
 * ------------------------------------------------------------------------- */

export interface RestoreCheckpointInput {
  projectPath: string;
  checkpointId: string;
}

export interface RestoreCheckpointResult {
  /** The actual SHA the working tree was restored to. */
  sha: string;
  /** Which checkpoint row the caller asked for (may differ from `sha`
   *  when the requested row was noop and we walked back). */
  resolvedFromCheckpointId: string;
}

export async function restoreCheckpoint(
  input: RestoreCheckpointInput,
): Promise<RestoreCheckpointResult> {
  const projectUuid = await ensureProjectUuid(input.projectPath);
  const db = openDb();

  // Look up the row up front so we can fail fast on bad ids without
  // grabbing the lock. The lock-protected critical section below
  // re-walks the SQL to resolve noops — that walk runs the only DB
  // reads inside the lock so we're not holding it across HTTP-style
  // round trips.
  const head = db
    .query<CheckpointRow, [string]>(
      `SELECT * FROM checkpoints WHERE id = ? LIMIT 1`,
    )
    .get(input.checkpointId);
  if (!head) {
    throw new Error(`checkpoint not found: ${input.checkpointId}`);
  }
  if (head.project_uuid !== projectUuid) {
    throw new Error(
      "checkpoint belongs to a different project than the one supplied",
    );
  }

  return await withProjectLock(projectUuid, async () => {
    // Resolve the SHA. For noop rows (sha = NULL) we walk back in time
    // to the most recent row with a real SHA. The index on
    // (project_uuid, created_at DESC) covers this query.
    let sha = head.sha;
    if (sha === null) {
      const prior = db
        .query<{ sha: string }, [string, number]>(
          `SELECT sha FROM checkpoints
            WHERE project_uuid = ? AND created_at <= ? AND sha IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1`,
        )
        .get(projectUuid, head.created_at);
      if (!prior) {
        throw new Error(
          "cannot restore: no underlying snapshot exists for this checkpoint",
        );
      }
      sha = prior.sha;
    }

    // Ensure the shadow repo exists in case the user is restoring on a
    // process that hasn't seen this project yet (cold start, server
    // restarted between checkpoints).
    await ensureShadowRepo(projectUuid, input.projectPath);

    const res = await git(
      shadowGitDir(projectUuid),
      input.projectPath,
      ["reset", "--hard", "--quiet", sha],
    );
    if (res.exitCode !== 0) {
      throw new Error(`shadow restore failed: ${res.stderr.trim()}`);
    }

    return {
      sha,
      resolvedFromCheckpointId: head.id,
    };
  });
}

/* ---------------------------------------------------------------------------
 * listCheckpoints
 * ------------------------------------------------------------------------- */

export async function listCheckpoints(
  projectPath: string,
  opts: ListCheckpointsOptions = {},
): Promise<Checkpoint[]> {
  const projectUuid = await ensureProjectUuid(projectPath);
  const limit = opts.limit ?? 100;

  const db = openDb();
  const rows =
    opts.terminalId !== undefined
      ? db
          .query<CheckpointRow, [string, string, number]>(
            `SELECT * FROM checkpoints
              WHERE project_uuid = ? AND terminal_id = ?
              ORDER BY created_at DESC
              LIMIT ?`,
          )
          .all(projectUuid, opts.terminalId, limit)
      : db
          .query<CheckpointRow, [string, number]>(
            `SELECT * FROM checkpoints
              WHERE project_uuid = ?
              ORDER BY created_at DESC
              LIMIT ?`,
          )
          .all(projectUuid, limit);

  return rows.map(rowToCheckpoint);
}
