/**
 * Left panel for Diff mode: every changed file in the project, with a
 * status chip and a click-to-open affordance. Fetches `/api/git/status`
 * on mount and on demand via the refresh button.
 *
 * Status chip semantics map the two-character porcelain code to a
 * single display badge — we don't yet surface the index/working-tree
 * split because M3 only diffs HEAD ↔ working-tree (staged-only diffs
 * land when we add a CommitSource variant).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SincePicker } from "./checkpoints/SincePicker";

interface GitStatusEntry {
  path: string;
  indexStatus: string;
  workingStatus: string;
  origPath: string | null;
}

interface GitStatusResponse {
  isRepo: boolean;
  toplevel: string | null;
  branch: string | null;
  entries: GitStatusEntry[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; data: GitStatusResponse }
  | { kind: "error"; message: string };

interface Props {
  root: string;
  activePath: string | null;
  onPick: (entry: GitStatusEntry) => void;
  /**
   * Called when the user clicks the refresh button (alongside the
   * internal status reload). DiffPane uses this to invalidate the
   * diff content cache and bump GitDiffPane's refresh nonce, so the
   * currently-open diff also picks up external edits.
   */
  onRefresh?: () => void;
  /**
   * Bumped by the parent to force a status re-fetch — used by the
   * "auto-refresh on entering Diff mode" path. The increment is the
   * trigger; the absolute value is irrelevant.
   */
  reloadNonce?: number;
  /**
   * Comparison base. `null` → status against the project's real-git
   * HEAD. A SHA → status against that shadow-repo checkpoint.
   */
  fromCheckpointSha?: string | null;
  /**
   * Fired after every successful status load with the fresh entries.
   * CodePane uses it to auto-select the first changed file when a
   * compare-reveal is pending. Read through a ref so it never
   * destabilizes the reload callback.
   */
  onEntriesLoaded?: (entries: GitStatusEntry[]) => void;
}

export function ChangesList({
  root,
  activePath,
  onPick,
  onRefresh,
  reloadNonce = 0,
  fromCheckpointSha = null,
  onEntriesLoaded,
}: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const onEntriesLoadedRef = useRef(onEntriesLoaded);
  onEntriesLoadedRef.current = onEntriesLoaded;

  const reload = useCallback(() => {
    const qs = new URLSearchParams({ root });
    if (fromCheckpointSha) qs.set("checkpointSha", fromCheckpointSha);
    setState({ kind: "loading" });
    fetch(`/api/git/status?${qs}`)
      .then((r) => {
        if (!r.ok)
          return r
            .json()
            .then((b) => Promise.reject(new Error(b?.error ?? r.statusText)));
        return r.json() as Promise<GitStatusResponse>;
      })
      .then((data) => {
        setState({ kind: "loaded", data });
        onEntriesLoadedRef.current?.(data.entries);
      })
      .catch((err: Error) =>
        setState({ kind: "error", message: err.message }),
      );
  }, [root, fromCheckpointSha]);

  // Re-runs on root change (project switch), comparison-base change
  // (via `reload`'s deps), and when the parent bumps reloadNonce.
  useEffect(reload, [reload, reloadNonce]);

  const onRefreshClick = useCallback(() => {
    reload();
    onRefresh?.();
  }, [reload, onRefresh]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header: Since picker on the left, branch chip + refresh on
          the right. The "Changes" label is dropped — the panel toggle
          above this component already names it. */}
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 py-1.5">
        <SincePicker projectPath={root} />
        <div className="flex items-center gap-1">
          {state.kind === "loaded" && state.data.branch ? (
            <span
              className="
                rounded-md bg-white/[0.04] px-1.5 py-0.5
                font-mono text-[9.5px] text-foreground/55
              "
              title="Branch"
            >
              {state.data.branch}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onRefreshClick}
            aria-label="Refresh status"
            title="Refresh"
            className="
              flex size-5 items-center justify-center rounded-md
              text-foreground/50 transition-colors duration-150
              hover:bg-white/[0.06] hover:text-foreground
              focus:outline-none focus-visible:bg-white/[0.06]
            "
          >
            <RefreshGlyph spinning={state.kind === "loading"} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        <Body state={state} activePath={activePath} onPick={onPick} />
      </div>
    </div>
  );
}

interface BodyProps {
  state: LoadState;
  activePath: string | null;
  onPick: (entry: GitStatusEntry) => void;
}

function Body({ state, activePath, onPick }: BodyProps) {
  if (state.kind === "loading") {
    return (
      <div className="px-3 py-2 text-[11px] text-foreground/40">Loading…</div>
    );
  }
  if (state.kind === "error") {
    return (
      <div
        className="px-3 py-2 text-[11px] text-rose-400/80"
        title={state.message}
      >
        {state.message}
      </div>
    );
  }
  if (!state.data.isRepo) {
    return (
      <div className="px-3 py-2 text-[11px] text-foreground/40">
        Not a git repository.
      </div>
    );
  }
  if (state.data.entries.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-foreground/40 italic">
        Working tree clean.
      </div>
    );
  }
  return (
    <>
      {state.data.entries.map((entry) => (
        <EntryRow
          key={`${entry.path}|${entry.origPath ?? ""}`}
          entry={entry}
          active={entry.path === activePath}
          onPick={onPick}
        />
      ))}
    </>
  );
}

interface EntryRowProps {
  entry: GitStatusEntry;
  active: boolean;
  onPick: (entry: GitStatusEntry) => void;
}

function EntryRow({ entry, active, onPick }: EntryRowProps) {
  const badge = displayBadge(entry);
  return (
    <button
      type="button"
      onClick={() => onPick(entry)}
      title={entry.path}
      className={`
        flex w-full items-center gap-1.5 rounded-md
        py-[3px] pl-2 pr-2 text-left text-[11.5px] leading-tight
        transition-[background-color,color] duration-100
        focus:outline-none focus-visible:bg-white/[0.06]
        ${
          active
            ? "bg-white/[0.08] text-foreground"
            : "text-foreground/70 hover:bg-white/[0.04] hover:text-foreground"
        }
      `}
    >
      <StatusChip code={badge.code} tone={badge.tone} />
      <span className="truncate">{entry.path}</span>
    </button>
  );
}

interface BadgeSpec {
  code: string;
  tone: "modified" | "added" | "deleted" | "renamed" | "untracked" | "neutral";
}

/**
 * Collapse the two-character porcelain code into a single user-facing
 * badge. The priority is "the most interesting state wins" — staged
 * adds + working-tree modifications show as M; working-tree deletes
 * are D regardless of staging.
 */
function displayBadge(entry: GitStatusEntry): BadgeSpec {
  const x = entry.indexStatus;
  const y = entry.workingStatus;
  if (x === "?" && y === "?") return { code: "??", tone: "untracked" };
  if (y === "D" || x === "D") return { code: "D", tone: "deleted" };
  if (x === "R" || y === "R") return { code: "R", tone: "renamed" };
  if (x === "A") return { code: "A", tone: "added" };
  if (x === "M" || y === "M") return { code: "M", tone: "modified" };
  return { code: x + y, tone: "neutral" };
}

const TONE_CLASSES: Record<BadgeSpec["tone"], string> = {
  modified: "bg-amber-400/15 text-amber-300/85",
  added: "bg-emerald-400/15 text-emerald-300/85",
  deleted: "bg-rose-400/15 text-rose-300/85",
  renamed: "bg-violet-400/15 text-violet-300/85",
  untracked: "bg-sky-400/15 text-sky-300/85",
  neutral: "bg-white/[0.06] text-foreground/65",
};

function StatusChip({ code, tone }: { code: string; tone: BadgeSpec["tone"] }) {
  return (
    <span
      aria-label={tone}
      title={tone}
      className={`
        inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center
        rounded-[4px] px-1
        font-mono text-[9.5px] font-semibold leading-none
        ${TONE_CLASSES[tone]}
      `}
    >
      {code}
    </span>
  );
}

function RefreshGlyph({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : ""}
    >
      <path d="M3 12a9 9 0 0115.36-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 01-15.36 6.36L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export type { GitStatusEntry };
