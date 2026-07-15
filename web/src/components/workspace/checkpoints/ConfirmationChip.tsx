/**
 * Ambient "✓ Checkpointed · 0a3b9c" chip the composer flashes after
 * each Send. Purely visual — no actions. Exists so users trust that
 * snapshots are happening even though the work is invisible.
 *
 * The parent renders the chip and controls its `visible` prop; this
 * component just owns the fade-in/fade-out CSS.
 *
 * Failure mode is also planned: when the parent passes `tone="error"`
 * the chip shifts color and shows a message instead of a SHA. Mock
 * doesn't trigger that path yet; the styling is included so the layout
 * pass already covers it.
 */
interface Props {
  visible: boolean;
  /** Short SHA on success, error message on failure. */
  label: string;
  tone?: "success" | "error";
}

export function ConfirmationChip({ visible, label, tone = "success" }: Props) {
  const palette =
    tone === "error"
      ? {
          bg: "bg-rose-400/15",
          ring: "ring-rose-400/30",
          fg: "text-rose-200/95",
        }
      : {
          bg: "bg-emerald-400/15",
          ring: "ring-emerald-400/30",
          fg: "text-emerald-200/95",
        };
  return (
    <div
      aria-hidden={!visible}
      className={`
        pointer-events-none absolute left-1/2
        -translate-x-1/2 -translate-y-[calc(100%+6px)] top-0
        flex items-center gap-1.5
        rounded-full ${palette.bg} ring-1 ${palette.ring}
        px-2.5 py-1
        font-mono text-[10.5px] ${palette.fg}
        backdrop-blur-md
        transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        ${
          visible
            ? "translate-y-[calc(-100%-6px)] opacity-100"
            : "translate-y-[calc(-100%+2px)] opacity-0"
        }
      `}
    >
      {tone === "success" ? <CheckGlyph /> : <BangGlyph />}
      <span>{label}</span>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={10}
      height={10}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l4 4 10-10" />
    </svg>
  );
}

function BangGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={10}
      height={10}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8v5M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
