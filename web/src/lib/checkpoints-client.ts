/**
 * Thin client wrapper around `/api/checkpoints`. Three concerns live
 * here:
 *
 *   1. fetch/parse/error normalization for create + list
 *   2. a tiny pub-sub so the rewind popover, since picker, and
 *      composer chip all hear about new checkpoints the instant a
 *      Send creates one — no polling, no prop drilling
 *   3. an in-memory cache of the "most recent checkpoint per project"
 *      so the composer's footer chip can render its relative-time
 *      label without an extra fetch on every mount
 */
import type {
  Checkpoint,
  CreateCheckpointRequest,
  ListCheckpointsResponse,
  RestoreCheckpointRequest,
  RestoreCheckpointResponse,
} from "@shared/types";

interface ListOptions {
  projectPath: string;
  terminalId?: string;
  limit?: number;
}

/* ---------------------------------------------------------------------------
 * Pub-sub for create events
 *
 * `Set` rather than `EventTarget` because we want type-safe payloads
 * without a string-keyed event name. Subscribers receive the freshly
 * created Checkpoint and decide what to do with it.
 * ------------------------------------------------------------------------- */

/** Carries the projectPath alongside the Checkpoint so per-project
 *  subscribers can filter without needing a separate uuid lookup. */
export interface CheckpointCreateEvent {
  checkpoint: Checkpoint;
  projectPath: string;
}

type CreateListener = (event: CheckpointCreateEvent) => void;
const createListeners = new Set<CreateListener>();

/**
 * Register a callback fired *after* every successful createCheckpoint.
 * Returns an unsubscribe function. Surfaces typically call this from
 * a `useEffect` and refetch their list when the callback fires. The
 * `projectPath` in the event lets per-project consumers filter
 * cheaply.
 */
export function subscribeToCheckpointCreates(cb: CreateListener): () => void {
  createListeners.add(cb);
  return () => createListeners.delete(cb);
}

// Restore notifications used to flow through a dedicated pub-sub
// here, but file-watch-client.ts now sees every disk write — including
// the `git reset --hard` that the restore route runs — and notifies
// useDocument, CodePane, and FileExplorer all in one shot. Keeping a
// parallel restore-event channel would just duplicate that work.

/* ---------------------------------------------------------------------------
 * Most-recent cache
 *
 * The composer footer chip ("Checkpoints · 2m ago") shows the relative
 * time of the latest checkpoint for the active project. We cache it
 * here so a fresh composer mount doesn't have to wait for an HTTP
 * round-trip before the chip has a label.
 *
 * Keyed by absolute projectPath. Real users would prefer projectUuid
 * but the composer only has projectPath in scope and the indirection
 * is unnecessary for v1.
 * ------------------------------------------------------------------------- */

const mostRecentByProject = new Map<string, Checkpoint>();

export function getCachedMostRecent(projectPath: string): Checkpoint | null {
  return mostRecentByProject.get(projectPath) ?? null;
}

function recordIfNewer(
  projectPath: string,
  checkpoint: Checkpoint,
): void {
  const prev = mostRecentByProject.get(projectPath);
  if (!prev || checkpoint.createdAt > prev.createdAt) {
    mostRecentByProject.set(projectPath, checkpoint);
  }
}

/* ---------------------------------------------------------------------------
 * create
 * ------------------------------------------------------------------------- */

export async function createCheckpoint(
  body: CreateCheckpointRequest,
): Promise<Checkpoint> {
  const res = await fetch("/api/checkpoints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (parsed as { error?: string }).error ??
        `checkpoint create failed: ${res.status}`,
    );
  }
  const created = (await res.json()) as Checkpoint;
  recordIfNewer(body.projectPath, created);
  const event: CheckpointCreateEvent = {
    checkpoint: created,
    projectPath: body.projectPath,
  };
  for (const cb of createListeners) {
    try {
      cb(event);
    } catch (e) {
      // A subscriber's bug shouldn't break create. Log and continue.
      console.error("[checkpoints-client] listener threw", e);
    }
  }
  return created;
}

/* ---------------------------------------------------------------------------
 * list
 * ------------------------------------------------------------------------- */

export async function listCheckpoints(
  opts: ListOptions,
): Promise<Checkpoint[]> {
  const qs = new URLSearchParams({ projectPath: opts.projectPath });
  if (opts.terminalId !== undefined) qs.set("terminalId", opts.terminalId);
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit));

  const res = await fetch(`/api/checkpoints?${qs}`);
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (parsed as { error?: string }).error ??
        `checkpoint list failed: ${res.status}`,
    );
  }
  const { checkpoints } = (await res.json()) as ListCheckpointsResponse;
  // The newest row in the result populates the most-recent cache so
  // any composer mount on this project gets a label immediately.
  if (checkpoints[0]) recordIfNewer(opts.projectPath, checkpoints[0]);
  return checkpoints;
}

/* ---------------------------------------------------------------------------
 * restore
 *
 * The composer ✓ chip already covers "did the snapshot happen" — the
 * restore action's feedback lives in the calling surface (popover /
 * picker) because that's where the user pressed the button.
 * ------------------------------------------------------------------------- */

export async function restoreCheckpoint(
  body: RestoreCheckpointRequest,
): Promise<RestoreCheckpointResponse> {
  const res = await fetch("/api/checkpoints/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (parsed as { error?: string }).error ??
        `checkpoint restore failed: ${res.status}`,
    );
  }
  return (await res.json()) as RestoreCheckpointResponse;
  // No pub-sub fan-out: file-watch-client picks up the post-restore
  // disk changes and notifies useDocument / CodePane / FileExplorer
  // through that channel.
}
