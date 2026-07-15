/**
 * Shared filesystem read helpers. The contract every caller relies on: a
 * missing or unreadable path resolves to null / false rather than throwing.
 */
import { readFile } from "node:fs/promises";

/** File contents as text, or null if missing/unreadable. Uses node readFile
 *  (not Bun.file().text(), which silently strips a leading UTF-8 BOM) so the
 *  bytes round-trip verbatim. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Parsed JSON, or null if missing/malformed. */
export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const f = Bun.file(path);
    return (await f.exists()) ? ((await f.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Whether a file exists (false on any error). */
export async function pathExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists();
  } catch {
    return false;
  }
}
