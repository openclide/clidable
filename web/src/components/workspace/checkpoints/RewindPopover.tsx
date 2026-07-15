/**
 * Composer-anchored rewind popover. Opens above the composer footer
 * (via an absolute-positioned container that the Composer mounts
 * inside its own relative wrapper).
 *
 * Two scopes:
 *   • "This terminal" — only checkpoints whose terminalId matches the
 *     composer's session. Biographical: "rewind before a message *I*
 *     sent from this agent."
 *   • "All" — every checkpoint in the project, interleaved across
 *     agents. Same content as the Changes-panel picker, just anchored
 *     to the composer.
 *
 * Data flow:
 *   • Fetches /api/checkpoints on open + on each create event so a
 *     Send that happens while the popover is open shows up
 *     immediately.
 *   • Filter is client-side — one fetch per open is enough; toggling
 *     scope just changes the filter predicate.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Checkpoint } from "@shared/types";
import {
  listCheckpoints,
  subscribeToCheckpointCreates,
} from "../../../lib/checkpoints-client";
import {
  requestRevealChanges,
  resolveBaseFromCheckpoint,
  setDiffBase,
} from "../../../lib/diff-base-store";
import { PositionedPortal } from "../../ui/PositionedPortal";
import { CheckpointRow } from "./CheckpointRow";
import { confirmRestoreWithFeedback } from "./restoreFlow";

type Scope = "terminal" | "all";

interface Props {
  /** Anchor element — popover positions itself above this. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Caller signals open/close. */
  open: boolean;
  onClose: () => void;
  /** PTY session id of the parent composer. Drives the "This terminal" filter. */
  terminalId: string;
  /** Project root path — passed straight through to /api/checkpoints. */
  projectPath: string;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; checkpoints: Checkpoint[] }
  | { kind: "error"; message: string };

export function RewindPopover({
  anchorRef,
  open,
  onClose,
  terminalId,
  projectPath,
}: Props) {
  const [scope, setScope] = useState<Scope>("terminal");
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  // Fetch on open. Always project-wide; we filter to the terminal
  // scope client-side. One round-trip per open is cheap.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ kind: "loading" });
    listCheckpoints({ projectPath })
      .then((checkpoints) => {
        if (!cancelled) setState({ kind: "loaded", checkpoints });
      })
      .catch((err: Error) => {
        if (!cancelled)
          setState({ kind: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath]);

  // While open, refresh on each create. The composer's Send fires a
  // create after this; without this subscription the user would see
  // the popover open, hit ⌘↵, and not see their new row appear.
  useEffect(() => {
    if (!open) return;
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
  }, [open, projectPath]);

  const visible = useMemo<Checkpoint[]>(() => {
    if (state.kind !== "loaded") return [];
    if (scope === "all") return state.checkpoints;
    return state.checkpoints.filter((c) => c.terminalId === terminalId);
  }, [state, scope, terminalId]);

  return (
    <PositionedPortal
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      width={380}
      placement="top"
      align="left"
      ariaLabel="Rewind to a checkpoint"
      className="
        glass flex flex-col overflow-hidden rounded-xl
        shadow-[0_18px_40px_rgba(0,0,0,0.5)]
      "
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.05] px-3 py-2">
        <span className="text-[10.5px] uppercase tracking-wide text-foreground/55">
          Rewind
        </span>
        <ScopeToggle value={scope} onChange={setScope} />
      </div>

      <div className="max-h-[320px] min-h-0 flex-1 overflow-auto p-1.5">
        <Body
          state={state}
          visible={visible}
          projectPath={projectPath}
          onClose={onClose}
        />
      </div>

      <div className="shrink-0 border-t border-white/[0.05] px-3 py-1.5">
        <button
          type="button"
          onClick={() => console.log("[rewind] open all checkpoints")}
          className="
            text-[10.5px] text-foreground/45
            transition-colors duration-150
            hover:text-foreground/80
            focus:outline-none focus-visible:text-foreground/80
          "
        >
          Show all checkpoints…
        </button>
      </div>
    </PositionedPortal>
  );
}

interface BodyProps {
  state: LoadState;
  visible: Checkpoint[];
  projectPath: string;
  /** Closes the popover after a restore or compare action. */
  onClose: () => void;
}

function Body({ state, visible, projectPath, onClose }: BodyProps) {
  // Full project-wide list for noop→prior-snapshot resolution. The
  // `visible` list may be scope-filtered, but resolving a noop needs
  // the complete timeline.
  const allCheckpoints =
    state.kind === "loaded" ? state.checkpoints : [];
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
  if (visible.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-[11px] italic text-foreground/40">
        No checkpoints yet
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {visible.map((c) => (
        <CheckpointRow
          key={c.id}
          checkpoint={c}
          onRestore={() => confirmRestoreWithFeedback(c, projectPath, onClose)}
          onSetAsSince={() => {
            // Set the project's diff base + pull the right pane to
            // Code → Changes so the diff appears immediately.
            setDiffBase(
              projectPath,
              resolveBaseFromCheckpoint(c, allCheckpoints),
            );
            requestRevealChanges(projectPath);
            onClose();
          }}
        />
      ))}
    </div>
  );
}

function ScopeToggle({
  value,
  onChange,
}: {
  value: Scope;
  onChange: (next: Scope) => void;
}) {
  const SCOPES: Array<{ id: Scope; label: string }> = [
    { id: "terminal", label: "This terminal" },
    { id: "all", label: "All" },
  ];
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  // "This terminal" and "All" have very different widths, so the segments are
  // *not* equal-width — a hard-coded 50% sliding pill ends up narrower than the
  // long label and its text spills past the highlight. Measure the active
  // button (rect-relative to the container) and size the pill to it exactly.
  useLayoutEffect(() => {
    const activeIndex = SCOPES.findIndex((s) => s.id === value);
    const measure = () => {
      const btn = btnRefs.current[activeIndex];
      const container = containerRef.current;
      if (!btn || !container) return;
      const c = container.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      setPill({ left: b.left - c.left, width: b.width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-5 items-center rounded-md bg-white/[0.04] p-0.5"
    >
      <span
        aria-hidden
        className="
          absolute inset-y-0.5 left-0 rounded
          bg-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]
          transition-[transform,width] duration-150 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        "
        style={{
          width: pill?.width ?? 0,
          transform: `translateX(${pill?.left ?? 0}px)`,
          opacity: pill ? 1 : 0,
        }}
      />
      {SCOPES.map((s, i) => (
        <button
          key={s.id}
          ref={(el) => {
            btnRefs.current[i] = el;
          }}
          type="button"
          onClick={() => onChange(s.id)}
          className={`
            relative z-[1] flex h-full items-center justify-center
            whitespace-nowrap rounded px-2 text-[9.5px] uppercase tracking-wide
            transition-colors duration-150
            ${
              s.id === value
                ? "text-foreground"
                : "text-foreground/50 hover:text-foreground/80"
            }
          `}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
