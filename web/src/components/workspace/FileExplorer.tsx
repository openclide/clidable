/**
 * Lightweight file explorer for the Code pane. Recursive tree with lazy
 * directory expansion — we don't pre-walk the whole project (`node_modules`
 * alone would dwarf the editor's load time).
 *
 * Implementation choices:
 *   • Per-directory state stored in a flat `Map<string, DirState>`. The
 *     tree component is a thin recursive view over that. Restructuring
 *     directly in a tree shape would force whole-subtree React work on
 *     every expand.
 *   • Children load once, then stay in memory — re-collapsing is purely
 *     visual. Refreshing the workspace re-mounts and re-fetches.
 *   • Hidden/excluded entries (`node_modules`, `.git`, dist, …) come
 *     pre-filtered from the server; no client-side denylist.
 *
 * Out of scope for M1 (will land later): drag-to-move, rename, delete,
 * file watching, multi-select.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeToFileChanges } from "../../lib/file-watch-client";

interface FsEntry {
  name: string;
  kind: "file" | "dir" | "symlink" | "other";
  size: number | null;
}

interface DirState {
  status: "loading" | "ready" | "error";
  entries: FsEntry[];
  message?: string;
}

interface Props {
  root: string;
  /** Currently open file (relative to `root`). Highlighted in the tree. */
  activePath: string | null;
  onOpenFile: (path: string) => void;
}

async function listDir(root: string, path: string): Promise<FsEntry[]> {
  const qs = new URLSearchParams({ root, path });
  const res = await fetch(`/api/fs/list?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error ?? `list failed: ${res.status}`);
  }
  const data = (await res.json()) as { entries: FsEntry[] };
  return data.entries;
}

export function FileExplorer({ root, activePath, onOpenFile }: Props) {
  // Path "" is the root. Keyed map so any subtree can lazy-load
  // independently and rerender locally.
  const [dirs, setDirs] = useState<Map<string, DirState>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));

  const loadingRef = useRef<Set<string>>(new Set());

  // Mirror `dirs` into a ref so loadDir reads the *current* cache rather than
  // the value captured when it was created. Without this, the root-reset
  // effect below fires loadDir("") with a stale closure that still sees the
  // previous project's root as "ready" — so it short-circuits and the new
  // project's files never load. (Also lets the watcher effect read state
  // without re-subscribing on every directory load.)
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;

  const loadDir = useCallback(
    (path: string) => {
      if (loadingRef.current.has(path)) return;
      const existing = dirsRef.current.get(path);
      if (existing && existing.status === "ready") return;

      loadingRef.current.add(path);
      setDirs((prev) => {
        const next = new Map(prev);
        next.set(path, { status: "loading", entries: [] });
        return next;
      });

      listDir(root, path)
        .then((entries) => {
          setDirs((prev) => {
            const next = new Map(prev);
            next.set(path, { status: "ready", entries });
            return next;
          });
        })
        .catch((err: Error) => {
          setDirs((prev) => {
            const next = new Map(prev);
            next.set(path, {
              status: "error",
              entries: [],
              message: err.message,
            });
            return next;
          });
        })
        .finally(() => {
          loadingRef.current.delete(path);
        });
    },
    [root],
  );

  // Kick off the root load. We reset the cache when `root` changes —
  // otherwise switching projects would show stale entries while the new
  // root's listing is in flight.
  useEffect(() => {
    setDirs(new Map());
    setExpanded(new Set([""]));
    // Clear the ref synchronously too, so the loadDir("") below sees an empty
    // cache and actually fetches the new root (rather than short-circuiting on
    // the previous project's entries before setDirs has flushed).
    dirsRef.current = new Map();
    loadDir("");
  }, [root, loadDir]);

  /**
   * Force-refresh a single cached directory. Distinct from `loadDir`
   * because that one short-circuits when state is already "ready" —
   * which is the right behavior for navigation, the wrong behavior
   * for "an agent just touched a file in this dir, re-read it."
   */
  const refetchDir = useCallback(
    (path: string): void => {
      loadingRef.current.add(path);
      listDir(root, path)
        .then((entries) => {
          setDirs((prev) => {
            const next = new Map(prev);
            next.set(path, { status: "ready", entries });
            return next;
          });
        })
        .catch((err: Error) => {
          setDirs((prev) => {
            const next = new Map(prev);
            next.set(path, {
              status: "error",
              entries: [],
              message: err.message,
            });
            return next;
          });
        })
        .finally(() => {
          loadingRef.current.delete(path);
        });
    },
    [root],
  );

  // Subscribe to file changes for this project. Refetch any cached
  // directories whose contents may have changed. Each watched batch
  // is deduplicated so multiple writes inside the same directory
  // only trigger one re-fetch.
  //
  // On an active event (this project becoming the watched one, or a
  // WS reconnect) we refetch every cached directory — we don't know
  // which files changed while we were silent, so the safe move is to
  // re-validate everything currently on screen.
  useEffect(() => {
    return subscribeToFileChanges(root, (event) => {
      if (event.kind === "active") {
        for (const dir of dirsRef.current.keys()) refetchDir(dir);
        return;
      }
      const dirsToRefetch = new Set<string>();
      for (const path of event.paths) {
        const slash = path.lastIndexOf("/");
        const parent = slash === -1 ? "" : path.slice(0, slash);
        // Only refetch dirs we have in our cache. Watcher events for
        // unexpanded subtrees can be ignored — when the user
        // eventually expands them, the lazy fetch reads current
        // state.
        if (dirsRef.current.has(parent)) dirsToRefetch.add(parent);
      }
      for (const dir of dirsToRefetch) refetchDir(dir);
    });
  }, [root, refetchDir]);

  const toggle = (path: string, kind: "dir" | "file") => {
    if (kind === "file") {
      onOpenFile(path);
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        loadDir(path);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* No inner header — the panel toggle in CodePane's aside acts
          as the label, so a redundant "Files" row above the tree is
          dropped. */}
      <div className="min-h-0 flex-1 overflow-auto px-1 py-2">
        <DirContents
          dirPath=""
          depth={0}
          dirs={dirs}
          expanded={expanded}
          activePath={activePath}
          onToggle={toggle}
        />
      </div>
    </div>
  );
}

interface DirContentsProps {
  dirPath: string;
  depth: number;
  dirs: Map<string, DirState>;
  expanded: Set<string>;
  activePath: string | null;
  onToggle: (path: string, kind: "dir" | "file") => void;
}

function DirContents({
  dirPath,
  depth,
  dirs,
  expanded,
  activePath,
  onToggle,
}: DirContentsProps) {
  const state = dirs.get(dirPath);
  if (!state) return null;
  if (state.status === "loading") {
    return (
      <div
        style={{ paddingLeft: 8 + depth * 12 }}
        className="py-1 text-[11px] text-foreground/40"
      >
        Loading…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div
        style={{ paddingLeft: 8 + depth * 12 }}
        className="py-1 text-[11px] text-rose-400/70"
        title={state.message}
      >
        {state.message ?? "Error"}
      </div>
    );
  }
  if (state.entries.length === 0) {
    return (
      <div
        style={{ paddingLeft: 8 + depth * 12 }}
        className="py-1 text-[11px] text-foreground/35 italic"
      >
        (empty)
      </div>
    );
  }
  return (
    <>
      {state.entries.map((entry) => (
        <EntryRow
          key={entry.name}
          entry={entry}
          parentPath={dirPath}
          depth={depth}
          dirs={dirs}
          expanded={expanded}
          activePath={activePath}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

interface EntryRowProps {
  entry: FsEntry;
  parentPath: string;
  depth: number;
  dirs: Map<string, DirState>;
  expanded: Set<string>;
  activePath: string | null;
  onToggle: (path: string, kind: "dir" | "file") => void;
}

function EntryRow({
  entry,
  parentPath,
  depth,
  dirs,
  expanded,
  activePath,
  onToggle,
}: EntryRowProps) {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const isDir = entry.kind === "dir";
  const isOpen = isDir && expanded.has(path);
  const isActive = !isDir && activePath === path;

  return (
    <>
      <button
        type="button"
        onClick={() => onToggle(path, isDir ? "dir" : "file")}
        title={entry.name}
        className={`
          group flex w-full items-center gap-1.5 rounded-md
          py-[3px] pr-2 text-left text-[11.5px] leading-tight
          transition-[background-color,color] duration-100
          focus:outline-none focus-visible:bg-white/[0.06]
          ${
            isActive
              ? "bg-white/[0.08] text-foreground"
              : "text-foreground/70 hover:bg-white/[0.04] hover:text-foreground"
          }
        `}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        <span className="w-3 shrink-0 text-foreground/35">
          {isDir ? <Chevron open={isOpen} /> : null}
        </span>
        <EntryIcon entry={entry} />
        <span className="truncate">{entry.name}</span>
      </button>
      {isDir && isOpen ? (
        <DirContents
          dirPath={path}
          depth={depth + 1}
          dirs={dirs}
          expanded={expanded}
          activePath={activePath}
          onToggle={onToggle}
        />
      ) : null}
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={9}
      height={9}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function EntryIcon({ entry }: { entry: FsEntry }) {
  if (entry.kind === "dir") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-foreground/55"
      >
        <path d="M3 7.2c0-.95.79-1.7 1.76-1.7H9l2 2h8.24c.97 0 1.76.76 1.76 1.7v7.6c0 .94-.79 1.7-1.76 1.7H4.76C3.79 18.5 3 17.74 3 16.8V7.2z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-foreground/45"
    >
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}
