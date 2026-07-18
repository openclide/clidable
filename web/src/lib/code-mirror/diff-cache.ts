/**
 * LRU-bounded diff content cache + in-flight dedup. Ported from
 * terax-ai's `lib/diffCache.ts` and re-targeted at `/api/git/diff`.
 *
 * Why a cache: `unifiedMergeView` rebuilds expensive state whenever
 * `originalContent` identity changes. A diff pane re-mounting on tab
 * activate (the EditorStack pattern) would re-fetch on every flip
 * without a cache. With one, repeat opens are O(1) and never hit the
 * server. LRU cap keeps the memory bound predictable.
 *
 * Why dedup: two diff panes pointed at the same file (or a remount
 * race with a tab switch) would otherwise fire concurrent fetches.
 * The `inflight` map lets all callers await the same promise.
 *
 * Source variants:
 *   • working    — diff working tree against the project's real-git HEAD
 *   • checkpoint — diff working tree against a shadow-repo checkpoint SHA
 */

export interface DiffContent {
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
}

export type DiffSource =
  | {
      kind: "working";
      /** Project root passed straight through to the server. */
      root: string;
      /** File path relative to `root`. */
      path: string;
    }
  | {
      kind: "checkpoint";
      root: string;
      /** Shadow-repo commit SHA to compare the working tree against. */
      sha: string;
      path: string;
    };

const DIFF_CACHE_LIMIT = 6;
const inflight = new Map<string, Promise<DiffContent>>();
const cache = new Map<string, DiffContent>();

export function diffKey(source: DiffSource): string {
  switch (source.kind) {
    case "working":
      return `w|${source.root}|${source.path}`;
    case "checkpoint":
      return `k|${source.root}|${source.sha}|${source.path}`;
  }
}

function touch(key: string, value: DiffContent): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > DIFF_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function getCachedDiff(source: DiffSource): DiffContent | undefined {
  const key = diffKey(source);
  const hit = cache.get(key);
  if (hit) {
    // LRU touch — move to the end without re-reading.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

export function invalidateDiff(source: DiffSource): void {
  cache.delete(diffKey(source));
}

/** Drop every entry whose key matches `root`. Useful after a checkpoint or commit. */
export function invalidateRoot(root: string): void {
  for (const k of [...cache.keys()]) {
    if (k.includes(`|${root}|`)) cache.delete(k);
  }
}

export async function fetchDiff(source: DiffSource): Promise<DiffContent> {
  const key = diffKey(source);
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = doFetch(source)
    .then((res) => {
      touch(key, res);
      return res;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

async function doFetch(source: DiffSource): Promise<DiffContent> {
  const qs = new URLSearchParams({ root: source.root, path: source.path });
  if (source.kind === "checkpoint") {
    qs.set("checkpointSha", source.sha);
  }
  const res = await fetch(`/api/git/diff?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error ?? `git diff failed: ${res.status}`);
  }
  return (await res.json()) as DiffContent;
}
