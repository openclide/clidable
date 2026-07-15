/**
 * The Changes-panel header's "Since:" chip + dropdown. Chooses the
 * comparison base for the diff view — either git HEAD or any
 * checkpoint from the project's history.
 *
 * Project-wide, unfiltered. Different shape from the composer's
 * RewindPopover (terminal-scoped, biographical) — same row component,
 * no scope toggle, plus an explicit "HEAD" pseudo-row at the bottom
 * so users can always return to "what's changed since I last
 * committed."
 *
 * The chosen base lives in the shared diff-base store (so the
 * composer's "compare" action can drive it too); this component reads
 * and writes that store rather than owning local selection state.
 */
import { useEffect, useRef, useState } from "react";
import type { Checkpoint } from "@shared/types";
import {
  listCheckpoints,
  subscribeToCheckpointCreates,
} from "../../../lib/checkpoints-client";
import { relativeTime } from "../../../lib/checkpoints-format";
import {
  getDiffBase,
  resolveBaseFromCheckpoint,
  setDiffBase,
  useDiffBase,
} from "../../../lib/diff-base-store";
import { PositionedPortal } from "../../ui/PositionedPortal";
import { CheckpointRow } from "./CheckpointRow";
import { confirmRestoreWithFeedback } from "./restoreFlow";

interface Props {
  projectPath: string;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; checkpoints: Checkpoint[] }
  | { kind: "error"; message: string };

export function SincePicker({ projectPath }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const anchorRef = useRef<HTMLButtonElement>(null);

  // Comparison base from the shared store. `undefined` = never chosen
  // for this project; we default it to HEAD (null) on mount below.
  const base = useDiffBase(projectPath);

  // Default the comparison base to HEAD — "what's changed since I last
  // committed" — for any project that hasn't had one explicitly chosen
  // yet. HEAD is the sensible default for a Changes view; a prior pick
  // (a checkpoint, or an explicit HEAD) is preserved across mounts via
  // the shared store. Independent of the checkpoint fetch so the chip
  // reads "HEAD" immediately rather than waiting on the list.
  useEffect(() => {
    if (getDiffBase(projectPath) === undefined) {
      setDiffBase(projectPath, null);
    }
  }, [projectPath]);

  // Fetch on mount and on project change. Always-on subscription to
  // create events so the chip's relative-time label stays fresh even
  // when the dropdown isn't open.
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    listCheckpoints({ projectPath })
      .then((checkpoints) => {
        if (cancelled) return;
        setState({ kind: "loaded", checkpoints });
      })
      .catch((err: Error) => {
        if (!cancelled)
          setState({ kind: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    return subscribeToCheckpointCreates((event) => {
      if (event.projectPath !== projectPath) return;
      setState((prev) => {
        if (prev.kind !== "loaded") return prev;
        if (prev.checkpoints.some((c) => c.id === event.checkpoint.id)) {
          return prev;
        }
        return {
          kind: "loaded",
          checkpoints: [event.checkpoint, ...prev.checkpoints],
        };
      });
    });
  }, [projectPath]);

  // The checkpoint id the base points at (undefined for HEAD or
  // not-yet-chosen) — drives the row highlight. HEAD's own highlight
  // keys off `base === null` directly, so collapsing null→undefined
  // here loses nothing.
  const selectedId = base?.checkpointId;
  const selectedCheckpoint =
    state.kind === "loaded" && selectedId != null
      ? state.checkpoints.find((c) => c.id === selectedId) ?? null
      : null;

  const onSelectCheckpoint = (id: string) => {
    if (state.kind !== "loaded") return;
    const cp = state.checkpoints.find((c) => c.id === id);
    if (!cp) return;
    setDiffBase(projectPath, resolveBaseFromCheckpoint(cp, state.checkpoints));
  };

  // Chip label priority:
  //   1. base not yet chosen / still loading → "…"
  //   2. explicit HEAD (null) → "HEAD"
  //   3. resolved checkpoint → its relative time
  //   4. stale id (not in list) → "HEAD"
  let chipLabel: string;
  if (base === undefined || state.kind === "loading" || state.kind === "idle") {
    chipLabel = "…";
  } else if (base === null) {
    chipLabel = "HEAD";
  } else if (selectedCheckpoint) {
    chipLabel = relativeTime(selectedCheckpoint.createdAt);
  } else {
    chipLabel = "HEAD";
  }

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Choose the diff comparison base"
        className="
          flex h-5 items-center gap-1.5 rounded-md
          bg-white/[0.04] px-1.5
          text-[10px] uppercase tracking-wide text-foreground/70
          transition-colors duration-150
          hover:bg-white/[0.08] hover:text-foreground
          focus:outline-none focus-visible:bg-white/[0.08]
        "
      >
        <ClockGlyph />
        <span className="normal-case tracking-normal text-[10.5px]">
          Since: <span className="text-foreground">{chipLabel}</span>
        </span>
        <ChevronGlyph open={open} />
      </button>

      <PositionedPortal
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        width={380}
        placement="bottom"
        align="left"
        ariaLabel="Choose a comparison base"
        className="
          glass flex flex-col overflow-hidden rounded-xl
          shadow-[0_18px_40px_rgba(0,0,0,0.5)]
        "
      >
          <div className="shrink-0 border-b border-white/[0.05] px-3 py-2">
            <span className="text-[10.5px] uppercase tracking-wide text-foreground/55">
              Compare against
            </span>
          </div>

          <div className="max-h-[300px] min-h-0 flex-1 overflow-auto p-1.5">
            <ListBody
              state={state}
              selectedId={selectedId ?? null}
              projectPath={projectPath}
              onSelect={onSelectCheckpoint}
              onAfterRestore={() => setOpen(false)}
            />
          </div>

          {/* HEAD pseudo-row — always available, even pre-fetch. */}
          <div className="shrink-0 border-t border-white/[0.05] p-1.5">
            <button
              type="button"
              onClick={() => setDiffBase(projectPath, null)}
              className={`
                flex w-full items-center justify-between rounded-md
                px-2 py-2 text-left
                transition-[background-color] duration-100
                ${
                  base === null
                    ? "bg-white/[0.06] ring-1 ring-inset ring-white/10"
                    : "hover:bg-white/[0.03]"
                }
              `}
            >
              <span className="text-[11.5px] font-medium text-foreground/80">
                HEAD
              </span>
              <span className="text-[10.5px] text-foreground/40">
                git working tree
              </span>
            </button>
          </div>
      </PositionedPortal>
    </div>
  );
}

interface ListBodyProps {
  state: LoadState;
  selectedId: string | null;
  projectPath: string;
  onSelect: (id: string) => void;
  /** Closes the dropdown after a successful restore. */
  onAfterRestore: () => void;
}

function ListBody({
  state,
  selectedId,
  projectPath,
  onSelect,
  onAfterRestore,
}: ListBodyProps) {
  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <div className="px-2 py-6 text-center text-[11px] text-foreground/40">
        Loading…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div
        className="px-2 py-6 text-center text-[11px] text-rose-400/80"
        title={state.message}
      >
        {state.message}
      </div>
    );
  }
  if (state.checkpoints.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-[11px] italic text-foreground/40">
        No checkpoints yet
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {state.checkpoints.map((c) => (
        <CheckpointRow
          key={c.id}
          checkpoint={c}
          selected={selectedId === c.id}
          onRestore={() =>
            confirmRestoreWithFeedback(c, projectPath, onAfterRestore)
          }
          onSetAsSince={onSelect}
        />
      ))}
    </div>
  );
}

function ClockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={10}
      height={10}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-foreground/55"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={8}
      height={8}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-foreground/45 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
