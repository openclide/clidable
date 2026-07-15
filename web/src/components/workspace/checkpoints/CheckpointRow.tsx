/**
 * Shared row for every checkpoint surface — composer popover and
 * Changes-panel "Since" picker render the same row, just inside
 * different containers. Keeping it in one place means the affordance
 * (preview, agent dot, two-line metadata, actions) is identical
 * wherever the user sees it.
 *
 * Layout is three columns: a clickable preview thumbnail (opens a
 * full-size lightbox), the metadata block, and the action buttons
 * (restore / compare). Actions fire `onRestore` / `onSetAsSince`
 * callbacks; the parent decides what to do.
 */
import { useState } from "react";
import type { Checkpoint } from "@shared/types";
import { migrateAgentId } from "@shared/types";
import type { AgentId } from "../../welcome/data";
import { AgentIcon } from "../../icons/AgentIcon";
import { getAgent } from "../../welcome/data";
import { ImageLightbox } from "../../ui/ImageLightbox";
import {
  previewMessage,
  relativeTime,
} from "../../../lib/checkpoints-format";

/** Known agents we render in the brand color; everyone else is neutral. */
const KNOWN_AGENT_IDS = new Set<AgentId>([
  "claude",
  "codex",
  "antigravity",
  "cursor",
  "qwen",
  "kimi",
  "opencode",
  "copilot",
]);

interface Props {
  checkpoint: Checkpoint;
  /**
   * Whether this row is the active comparison base — drives the
   * highlight. Defaults to false (the composer popover is an action
   * menu with no persistent selection).
   */
  selected?: boolean;
  /** Restore the working tree to this checkpoint. */
  onRestore: (id: string) => void;
  /** Pivot the Changes panel's diff base to this checkpoint, no restore. */
  onSetAsSince: (id: string) => void;
}

export function CheckpointRow({
  checkpoint,
  selected = false,
  onRestore,
  onSetAsSince,
}: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Wire data is `string` for agentId so custom agents from §5 don't
  // break the type. Migrate a renamed id (a checkpoint saved under "gemini"
  // resolves to "antigravity") before the known-set gate; genuinely unknown
  // ids fall back to a neutral display.
  const agentId = migrateAgentId(checkpoint.agentId) as AgentId;
  const agent = KNOWN_AGENT_IDS.has(agentId) ? getAgent(agentId) : null;
  const agentColor = agent?.color ?? "var(--color-foreground-muted)";
  const agentName = agent?.name ?? checkpoint.agentId;
  const label = checkpoint.isInitial
    ? "Initial state"
    : previewMessage(checkpoint.message);

  // Same URL for the thumbnail background and the full-size lightbox; null
  // when no screenshot was captured (browser mode / preview not visible).
  const shotUrl = checkpoint.screenshot
    ? `/api/checkpoints/screenshot?id=${encodeURIComponent(checkpoint.id)}`
    : null;

  return (
    <div
      className={`
        group relative flex w-full items-center gap-2.5
        rounded-md px-2 py-2
        transition-[background-color] duration-100
        ${
          selected
            ? "bg-white/[0.06] ring-1 ring-inset ring-white/10"
            : "hover:bg-white/[0.03]"
        }
      `}
    >
      {/* Column 1 — preview thumbnail. Clickable when a screenshot exists;
          opens the full-size lightbox. A dim placeholder of the same size
          keeps rows visually rhythmic when there's no shot. */}
      <PreviewThumb src={shotUrl} onOpen={() => setLightboxOpen(true)} />

      {/* Column 2 — metadata. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Line 1: time + agent + noop badge */}
        <div className="flex items-center gap-2 text-[10.5px] text-foreground/55">
          <span className="tabular-nums">{relativeTime(checkpoint.createdAt)}</span>
          <span aria-hidden className="size-0.5 rounded-full bg-foreground/25" />
          <span
            className="flex items-center gap-1"
            style={{ color: agentColor }}
            title={agentName}
          >
            {agent ? <AgentIcon id={agent.id} size={10} /> : null}
            <span className="font-medium">{agentName}</span>
          </span>
          {checkpoint.noop && (
            <span
              className="
                ml-auto rounded-sm bg-white/[0.04] px-1 py-px
                text-[9px] uppercase tracking-wide text-foreground/40
              "
              title="No working-tree changes since the previous checkpoint"
            >
              noop
            </span>
          )}
        </div>
        {/* Line 2: the message text */}
        <div
          className={`
            truncate text-[11.5px] leading-tight
            ${checkpoint.isInitial ? "italic text-foreground/45" : "text-foreground/80"}
          `}
          title={checkpoint.message || "Initial state"}
        >
          {label}
        </div>
      </div>

      {/* Column 3 — actions. Always visible (their own column), brightening
          on hover/focus. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <ActionButton
          onClick={() => onRestore(checkpoint.id)}
          title="Restore working tree to this checkpoint"
          aria-label="Restore"
        >
          <RewindGlyph />
        </ActionButton>
        <ActionButton
          onClick={() => onSetAsSince(checkpoint.id)}
          title="Compare against this checkpoint"
          aria-label="Compare against this checkpoint"
        >
          <DiffGlyph />
        </ActionButton>
      </div>

      <ImageLightbox
        src={shotUrl}
        alt={`Preview at checkpoint — ${label}`}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}

/**
 * Preview thumbnail. When a screenshot was captured at checkpoint time
 * (desktop only — see lib/screenshot.ts), the server stored it and we
 * render it here via the id-keyed serve route, clickable to enlarge.
 * Otherwise a dim placeholder keeps the row layout rhythmic.
 */
function PreviewThumb({
  src,
  onOpen,
}: {
  src: string | null;
  onOpen: () => void;
}) {
  if (!src) {
    return (
      <span
        aria-label="No preview captured"
        title="Preview wasn't running at this checkpoint"
        className="
          flex h-12 w-20 shrink-0 items-center justify-center
          overflow-hidden rounded-md
          border border-white/[0.05] bg-white/[0.015]
        "
      >
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground/25"
        >
          <rect x="3" y="5" width="18" height="13" rx="1.5" />
          <path d="M3 18L21 6" />
        </svg>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title="Click to enlarge"
      aria-label="Enlarge preview screenshot"
      className="
        group/thumb relative h-12 w-20 shrink-0 overflow-hidden rounded-md
        border border-white/[0.08]
        shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
      "
      style={{
        backgroundImage: `url("${src}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Hover affordance: dim + an expand glyph so it reads as clickable. */}
      <span
        aria-hidden
        className="
          absolute inset-0 flex items-center justify-center
          bg-black/0 text-white/0 transition-colors duration-100
          group-hover/thumb:bg-black/35 group-hover/thumb:text-white/90
        "
      >
        <svg
          viewBox="0 0 24 24"
          width={13}
          height={13}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 3H5a2 2 0 00-2 2v3" />
          <path d="M16 3h3a2 2 0 012 2v3" />
          <path d="M8 21H5a2 2 0 01-2-2v-3" />
          <path d="M16 21h3a2 2 0 002-2v-3" />
        </svg>
      </span>
    </button>
  );
}

function ActionButton({
  children,
  onClick,
  title,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  "aria-label": string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      aria-label={ariaLabel}
      className="
        flex size-7 items-center justify-center rounded-md
        bg-white/[0.04] text-foreground/50
        transition-colors duration-100
        hover:bg-white/[0.12] hover:text-foreground
        focus:outline-none focus-visible:bg-white/[0.12] focus-visible:text-foreground
      "
    >
      {children}
    </button>
  );
}

/**
 * Unified-diff glyph: a "+" indicator over a "−" indicator with
 * lines extending to the right. Reads as "show a diff" rather than
 * a generic arrow, which the user (rightly) pointed out was opaque
 * for the "use as comparison base" action.
 */
function DiffGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Top row: + plus a line representing an added line */}
      <path d="M4 8h3" />
      <path d="M5.5 6.5v3" />
      <path d="M11 8h9" />
      {/* Bottom row: − plus a line representing a removed line */}
      <path d="M4 16h3" />
      <path d="M11 16h9" />
    </svg>
  );
}

function RewindGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 109-9" />
      <path d="M3 4v5h5" />
    </svg>
  );
}
