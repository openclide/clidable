/**
 * Read or create the per-project UUID kept at
 * `<project>/.clidable/project-id`.
 *
 * Existence of this file is what makes a directory "a Clidable project."
 * The UUID is used everywhere else as the stable identifier: shadow git
 * path, SQLite foreign keys, screenshot folder names. Never derive it
 * from `projectPath` — paths change, UUIDs don't.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { projectIdFilePath } from "./paths";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the project's existing UUID, or creates and persists a new
 * one when first called.
 *
 * Race-safe across concurrent first-time callers: the per-project
 * lock in createCheckpoint can't help here (the lock is keyed BY the
 * UUID — we need it before we can acquire). Instead the write uses
 * `flag: "wx"` (exclusive create), and an EEXIST collision means
 * another caller won — we read theirs.
 *
 * @throws if `<project>/.clidable` can't be created (read-only mount,
 *         permission denied, etc.) — surfaces to the route handler
 *         which converts to a 500.
 */
export async function ensureProjectUuid(projectPath: string): Promise<string> {
  const file = projectIdFilePath(projectPath);

  // Fast path — already exists and is valid.
  const fromDisk = await readUuid(file);
  if (fromDisk !== null) return fromDisk;

  // Slow path — create. Exclusive `wx` flag means we either win and
  // write our UUID, or someone else won (EEXIST) and we read theirs.
  const fresh = randomUUID();
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(file, fresh + "\n", { flag: "wx", encoding: "utf8" });
    // Self-contained ignore — `*` matches every file in this directory
    // (including the .gitignore itself), so the user's `git status`
    // stays clean without us editing their root .gitignore. Git still
    // reads .gitignore files even when matched by their own patterns.
    // Only the race winner writes this; if it fails the loser doesn't
    // retry, but next ensureProjectUuid call re-runs the fast path and
    // (importantly) the user can always delete .clidable/ and start
    // fresh.
    await writeFile(join(dirname(file), ".gitignore"), "*\n", "utf8");
    return fresh;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  // Someone else just created the file — read their UUID. If the file
  // content is somehow still invalid (race with hand-editing the file
  // at exactly the wrong moment), surface as an error rather than
  // silently mint a different one and orphan history.
  const winner = await readUuid(file);
  if (winner === null) {
    throw new Error(
      `project-id file at ${file} exists but is not a valid UUID`,
    );
  }
  return winner;
}

/** Internal — read + validate, returns null on missing or malformed. */
async function readUuid(file: string): Promise<string | null> {
  try {
    const existing = (await readFile(file, "utf8")).trim();
    return UUID_PATTERN.test(existing) ? existing : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Read-only lookup. Returns `null` when the project hasn't been touched yet. */
export async function readProjectUuid(
  projectPath: string,
): Promise<string | null> {
  return readUuid(projectIdFilePath(projectPath));
}
