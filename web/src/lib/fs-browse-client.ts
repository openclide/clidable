/**
 * Client wrapper for `/api/fs/browse` — the server-side directory browser
 * that backs the universal folder picker. "Universal" because the path lives
 * on the *server's* filesystem, so it works identically in Tauri, plain
 * browser, and remote/server mode (where the dev machine is the server, not
 * the client). No Tauri dialog plugin needed.
 */
import type { FsBrowseResponse } from "@shared/types";

/** List the sub-directories of `path` (defaults to the server's home dir). */
export async function browseDir(path?: string): Promise<FsBrowseResponse> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/fs/browse${qs}`);
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (parsed as { error?: string }).error ?? `browse failed: ${res.status}`,
    );
  }
  return (await res.json()) as FsBrowseResponse;
}
