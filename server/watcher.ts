/**
 * Per-project file system watcher.
 *
 * One `ProjectWatcher` per active project. Multiple consumers (the
 * editor's useDocument, the changes-panel CodePane, the file explorer
 * tree) share a single `fs.watch` per project via refcounting — when
 * the last subscriber unsubscribes we tear the watcher down and drop
 * the entry from the map.
 *
 * Smart filtering, VS-Code-style:
 *   1. The project's own `.gitignore` is honored alongside our
 *      always-ignore list, so user-defined exclusions (`tmp/`,
 *      `*.log`, `.coverage/`) don't fire spurious notifications.
 *   2. Adaptive debounce: the flush window starts at 50 ms but
 *      extends every time a fresh event arrives, capped at 250 ms.
 *      A `git checkout main` writing 200 files in 180 ms produces
 *      one batch instead of four.
 *
 * Platform notes:
 *   • macOS + Windows support `fs.watch({recursive: true})` natively.
 *   • Linux's native fs.watch is single-directory; recursion works
 *     in Node 20+ via libuv polyfill but is more expensive. For v1
 *     we just trust the option and document the trade-off.
 */
import { readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import ignore, { type Ignore } from "ignore";

/** Initial debounce window. Most agent edits resolve well inside this. */
const DEBOUNCE_INITIAL_MS = 50;
/** Hard cap so a continuous stream of writes can't starve consumers forever. */
const DEBOUNCE_MAX_MS = 250;

/**
 * Atomic-save temp-file pattern. macOS (and many editors) save by
 * writing to `<base>.tmp.<pid>.<hex>` and then renaming the temp into
 * place. fs.watch reliably fires for the temp file but the rename
 * event for the destination is often lost or coalesced — so we'd
 * happily emit `README.md.tmp.9082.517d54d7de6e` to consumers and
 * never tell them `README.md` itself changed.
 *
 * Normalize back to the base path. The temp event becomes a base-path
 * event; consumers match on the real file they care about.
 */
const ATOMIC_TEMP_PATTERN = /^(.+?)\.tmp\.\d+\.[0-9a-f]+$/;

/**
 * Path-prefix denylist. We bail on filenames whose first segment
 * matches one of these — cheap substring check is fine given the
 * known small list. `.git` covers both the user's real git repo and
 * any sibling .git/ directories.
 */
const IGNORE_PREFIXES: readonly string[] = [
  ".git/",
  ".clidable/",
  "node_modules/",
  ".next/",
  ".nuxt/",
  "dist/",
  "build/",
  "out/",
  "target/",
  ".turbo/",
  ".cache/",
  ".parcel-cache/",
  ".svelte-kit/",
  ".vite/",
  ".pnpm-store/",
];

const IGNORE_SUBSTRINGS: readonly string[] = [
  "/node_modules/",
  "/.git/",
  "/dist/",
  "/.next/",
];

const IGNORE_BASENAMES: readonly string[] = [
  ".DS_Store",
  "Thumbs.db",
];

export type WatchSubscriber = (paths: readonly string[]) => void;

class ProjectWatcher {
  private readonly watcher: FSWatcher;
  private readonly subscribers = new Set<WatchSubscriber>();
  private pending: Set<string> = new Set();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the current debounce window started — used to enforce the cap. */
  private debounceStart = 0;
  /** Compiled project .gitignore, reloaded if .gitignore itself changes. */
  private gitignore: Ignore | null = null;
  /** Tracks whether `close()` has run, so late events get dropped. */
  private closed = false;

  constructor(public readonly projectPath: string) {
    this.loadGitignore();
    this.watcher = watch(projectPath, { recursive: true }, (event, filename) => {
      this.onEvent(filename);
    });
    this.watcher.on("error", (err) => {
      console.error(`[watcher] ${projectPath}:`, err);
      // Surface to subscribers? For v1 we just drop -- the next
      // file-change event will silently fail and consumers won't see
      // updates. A reconnect-on-close path would be nicer.
    });
  }

  /**
   * Read & compile the project's root .gitignore. Best effort: missing
   * file is normal (many projects start without one). Re-fired when a
   * watcher event hits .gitignore itself.
   *
   * We don't walk up the parent tree or read nested .gitignores yet —
   * most projects use a single root file and the cost/benefit doesn't
   * justify the complexity for v1. Easy to extend later.
   */
  private loadGitignore(): void {
    try {
      const content = readFileSync(
        join(this.projectPath, ".gitignore"),
        "utf8",
      );
      this.gitignore = ignore().add(content);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // Permission denied, etc. Log but keep going without it.
        console.warn(`[watcher] failed to read .gitignore: ${code}`);
      }
      this.gitignore = null;
    }
  }

  private onEvent(filename: string | Buffer | null): void {
    if (this.closed) return;
    if (filename === null) return;
    const raw = typeof filename === "string" ? filename : filename.toString();
    // Normalize atomic-save temp files to their target before any
    // filtering — gitignore patterns are written for real files, not
    // their transient temp twins.
    const match = ATOMIC_TEMP_PATTERN.exec(raw);
    const name = match && match[1] ? match[1] : raw;
    // Hot path: always-ignore check first (it's cheaper than a regex
    // tree walk). Then the user's gitignore.
    if (shouldIgnore(name)) return;
    if (this.gitignore && isGitIgnored(this.gitignore, name)) return;
    this.pending.add(name);
    // If the user's own .gitignore changed, reload it before the next
    // batch so a freshly-added pattern takes effect immediately.
    if (name === ".gitignore" || name.endsWith("/.gitignore")) {
      this.loadGitignore();
    }
    this.scheduleFlush();
  }

  /**
   * Adaptive debounce: each new event extends the flush window unless
   * we've already hit DEBOUNCE_MAX_MS since the first event in this
   * batch. So a quick flurry coalesces into one batch, and a long-
   * running stream still drains every 250 ms.
   */
  private scheduleFlush(): void {
    const now = Date.now();
    if (this.flushTimer !== null) {
      const elapsed = now - this.debounceStart;
      if (elapsed >= DEBOUNCE_MAX_MS) {
        // Cap reached — let the existing timer fire on schedule. Any
        // events arriving meanwhile join the current batch.
        return;
      }
      // Extend the window. Clamp so we never push past the cap.
      clearTimeout(this.flushTimer);
      const remaining = Math.max(
        0,
        Math.min(DEBOUNCE_INITIAL_MS, DEBOUNCE_MAX_MS - elapsed),
      );
      this.flushTimer = setTimeout(() => this.flush(), remaining);
      return;
    }
    this.debounceStart = now;
    this.flushTimer = setTimeout(() => this.flush(), DEBOUNCE_INITIAL_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    const paths = [...this.pending];
    this.pending = new Set();
    if (paths.length === 0) return;
    for (const sub of this.subscribers) {
      try {
        sub(paths);
      } catch (e) {
        console.error("[watcher] subscriber threw", e);
      }
    }
  }

  subscribe(cb: WatchSubscriber): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pending = new Set();
    try {
      this.watcher.close();
    } catch {
      /* already closed */
    }
  }
}

function shouldIgnore(filename: string): boolean {
  // Normalize so the prefix / substring checks work on Windows too.
  const norm = filename.replace(/\\/g, "/");
  // Basename
  const base = norm.split("/").pop() ?? norm;
  if (IGNORE_BASENAMES.includes(base)) return true;
  // Path prefix (relative to project root)
  for (const p of IGNORE_PREFIXES) {
    if (norm === p.slice(0, -1) || norm.startsWith(p)) return true;
  }
  // Mid-path substrings (covers monorepo nested node_modules)
  for (const s of IGNORE_SUBSTRINGS) {
    if (norm.includes(s)) return true;
  }
  return false;
}

/**
 * Wrap `ignore`'s ignores() with two adjustments:
 *
 * 1. Strip leading slash — `ignore` rejects "absolute" paths and we
 *    never deal in real absolute paths anyway.
 *
 * 2. Try both `path` and `path + "/"`. The `ignore` package interprets
 *    a pattern like `_scratch/` as "match only if the path is known to
 *    be a directory." fs.watch fires directory-creation events with
 *    just the directory name (no trailing slash), so a literal
 *    matcher.ignores("_scratch") returns false even when the user
 *    intended `_scratch/` to mean "ignore this dir." Checking both
 *    forms eats the corner where a user has a *file* with the same
 *    name as an ignored directory — rare enough to accept.
 */
function isGitIgnored(matcher: Ignore, path: string): boolean {
  const rel = path.startsWith("/") ? path.slice(1) : path;
  if (rel === "") return false;
  if (matcher.ignores(rel)) return true;
  // Try the directory form too. Skipped for paths that already end in
  // "/" (we'd just check the same string).
  if (!rel.endsWith("/") && matcher.ignores(rel + "/")) return true;
  return false;
}

/* ---------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------- */

const watchers = new Map<string, ProjectWatcher>();

/**
 * Subscribe to file change events for `projectPath`. The first
 * subscriber spawns the underlying watcher; the last unsubscriber
 * tears it down.
 *
 * Throws if `fs.watch` can't be opened (path missing, perm denied).
 * Callers should treat the throw as "no watch for this session" and
 * continue without auto-reload.
 */
export function watchProject(
  projectPath: string,
  cb: WatchSubscriber,
): () => void {
  let w = watchers.get(projectPath);
  if (!w) {
    w = new ProjectWatcher(projectPath);
    watchers.set(projectPath, w);
  }
  const unsub = w.subscribe(cb);
  return () => {
    unsub();
    if (w!.subscriberCount === 0) {
      w!.close();
      watchers.delete(projectPath);
    }
  };
}
