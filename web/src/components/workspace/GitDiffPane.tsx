/**
 * Read-only unified merge view backed by `/api/git/diff`. Ported from
 * terax-ai's `GitDiffPane.tsx` with two adjustments:
 *
 *   1. Theme adopts our glass tokens (transparent surface, foreground
 *      tokens instead of shadcn vars).
 *   2. No `usePreferencesStore` — there's no settings store yet.
 *
 * Source variants `WorkingSource | CommitSource` are wired through
 * `DiffSource` from diff-cache. `CheckpointSource` slots in here later
 * once §2 lands; the component, cache, and theme don't need to change.
 *
 * Large files / binaries fall back to the unified patch text — the
 * merge view chokes on those (CM6 isn't designed for multi-MB read
 * paths) and the patch is the right shape for a "what changed?"
 * answer anyway.
 */
import { unifiedMergeView, presentableDiff } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildSharedExtensions,
  languageCompartment,
} from "../../lib/code-mirror/extensions";
import {
  diffKey,
  fetchDiff,
  getCachedDiff,
  type DiffContent,
  type DiffSource,
} from "../../lib/code-mirror/diff-cache";
import {
  resolveLanguage,
  resolveLanguageSync,
} from "../../lib/code-mirror/language-resolver";

const LARGE_FILE_THRESHOLD = 256 * 1024;

const SHARED_EXT = buildSharedExtensions();
const READONLY_EXT: Extension[] = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

/**
 * Tuned for our transparent glass surface — color-mix() over the
 * foreground token rather than solid greens / reds keeps the highlight
 * legible on whatever's behind the panel.
 */
const DIFF_THEME = EditorView.theme({
  "&.cm-merge-b .cm-changedText, .cm-changedText": {
    background: "rgba(110, 200, 120, 0.22) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": {
    background: "rgba(220, 90, 90, 0.24) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-b .cm-changedLine, .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "rgba(110, 200, 120, 0.06) !important",
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(220, 90, 90, 0.06) !important",
    paddingTop: "1px",
    paddingBottom: "1px",
  },
  "&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter": {
    background: "rgba(110, 200, 120, 0.55) !important",
  },
  ".cm-deletedLineGutter, &.cm-merge-a .cm-changedLineGutter": {
    background: "rgba(220, 90, 90, 0.55) !important",
  },
  ".cm-changeGutter": {
    width: "2px !important",
    paddingLeft: "0 !important",
  },
  ".cm-collapsedLines": {
    backgroundColor: "transparent",
    color: "var(--color-foreground-dim)",
    fontSize: "10.5px",
    padding: "2px 8px",
    opacity: 0.7,
  },
});

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: DiffContent }
  | { kind: "error"; message: string };

function loadStateFromCache(source: DiffSource): LoadState {
  const hit = getCachedDiff(source);
  return hit ? { kind: "loaded", data: hit } : { kind: "idle" };
}

interface Props {
  source: DiffSource;
  /** Status mode chip (M / A / D / R / ??). Free-form; the parent decides the label. */
  chipLabel?: string;
  /**
   * Bumped by the parent to force a re-fetch of the currently-displayed
   * source — used by the refresh button to pick up external edits. The
   * parent is responsible for invalidating the matching cache entry
   * before bumping; otherwise the re-fetch will hit the LRU and return
   * stale content.
   */
  refreshNonce?: number;
}

export function GitDiffPane({ source, chipLabel, refreshNonce = 0 }: Props) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const [state, setState] = useState<LoadState>(() =>
    loadStateFromCache(source),
  );

  // Re-keyed by the diff cache key so re-pointing the same component
  // at a different file (e.g. user clicks another entry in
  // ChangesList) refires the load without us having to mint a new
  // component instance.
  // Single source of truth for the cache key — re-pointing the
  // component at a different file or comparison base refires the load.
  const key = diffKey(source);

  useEffect(() => {
    const cached = loadStateFromCache(source);
    if (cached.kind === "loaded") {
      setState(cached);
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetchDiff(source)
      .then((data) => {
        if (!cancelled) setState({ kind: "loaded", data });
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err.message ?? String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // refreshNonce in deps so a parent-driven bump re-runs the fetch
    // (parent must have invalidated the cache beforehand).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshNonce]);

  const path = source.path;
  const loaded = state.kind === "loaded" ? state.data : null;
  const originalContent = loaded?.originalContent ?? "";
  const modifiedContent = loaded?.modifiedContent ?? "";
  const isBinary = loaded?.isBinary ?? false;
  const fallbackPatch = loaded?.fallbackPatch ?? "";

  const isTooLarge =
    originalContent.length > LARGE_FILE_THRESHOLD ||
    modifiedContent.length > LARGE_FILE_THRESHOLD;
  const useFallback = isBinary || isTooLarge;

  const initialLang = useMemo(() => resolveLanguageSync(path), [path]);
  const extensions = useMemo<Extension[]>(
    () => [
      ...SHARED_EXT,
      languageCompartment.of(initialLang ?? []),
      ...READONLY_EXT,
      unifiedMergeView({
        original: originalContent,
        mergeControls: false,
        highlightChanges: true,
        gutter: true,
        syntaxHighlightDeletions: true,
        collapseUnchanged: { margin: 3, minSize: 6 },
      }),
      DIFF_THEME,
    ],
    [originalContent, initialLang],
  );

  // Pull the language extension in if it wasn't already in the lazy
  // resolver cache. Wait for `state.kind === "loaded"` so the view
  // exists — the spinner pre-load races the reconfigure and silently
  // drops if dispatched into a not-yet-mounted view.
  useEffect(() => {
    if (useFallback || initialLang) return;
    if (state.kind !== "loaded") return;
    let cancelled = false;
    void resolveLanguage(path).then((ext) => {
      if (cancelled) return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: languageCompartment.reconfigure(ext ?? []),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [useFallback, path, initialLang, state.kind]);

  const stats = useMemo(
    () =>
      loaded ? computeLineStats(originalContent, modifiedContent) : null,
    [loaded, originalContent, modifiedContent],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-white/[0.05] px-3">
        <div className="flex min-w-0 items-center gap-2">
          {chipLabel ? (
            <span
              className="
                shrink-0 rounded-md border border-white/[0.08]
                bg-white/[0.04] px-1.5 py-0.5
                font-mono text-[10px] uppercase tracking-wide text-foreground/65
              "
            >
              {chipLabel}
            </span>
          ) : null}
          {isBinary ? (
            <span className="shrink-0 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300/80">
              Binary
            </span>
          ) : isTooLarge ? (
            <span className="shrink-0 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300/80">
              Large file
            </span>
          ) : null}
          <span
            className="truncate font-mono text-[11px] text-foreground/65"
            title={path}
          >
            {path}
          </span>
        </div>
        {stats && !useFallback ? (
          <div className="flex shrink-0 items-center gap-2 text-[10.5px] tabular-nums">
            <span className="text-emerald-300/85">+{stats.added}</span>
            <span className="text-rose-300/85">−{stats.removed}</span>
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {state.kind === "loading" || state.kind === "idle" ? (
          <div className="flex h-full items-center justify-center text-[11px] text-foreground/55">
            Loading diff…
          </div>
        ) : state.kind === "error" ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11.5px] text-rose-400/80">
            {state.message}
          </div>
        ) : useFallback ? (
          <pre className="h-full overflow-auto p-3 font-mono text-[11.5px] leading-relaxed text-foreground/70">
            {fallbackPatch || "Diff preview is not available for this file."}
          </pre>
        ) : (
          <CodeMirror
            ref={cmRef}
            value={modifiedContent}
            theme="none"
            extensions={extensions}
            editable={false}
            height="100%"
            className="h-full"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              searchKeymap: true,
            }}
          />
        )}
      </div>
    </div>
  );
}

function computeLineStats(
  original: string,
  modified: string,
): { added: number; removed: number } {
  const changes = presentableDiff(original, modified);
  let added = 0;
  let removed = 0;
  for (const c of changes) {
    removed += countLines(original, c.fromA, c.toA);
    added += countLines(modified, c.fromB, c.toB);
  }
  return { added, removed };
}

function countLines(doc: string, from: number, to: number): number {
  if (from === to) return 0;
  const slice = doc.slice(from, to);
  // N newlines = N+1 touched lines, except a trailing \n means the
  // last segment is empty and shouldn't count.
  let n = 1;
  for (let i = 0; i < slice.length; i++) {
    if (slice.charCodeAt(i) === 10) n++;
  }
  if (slice.endsWith("\n")) n--;
  return Math.max(n, 1);
}
