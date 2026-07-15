import { STATUS_LABELS, type McpStatus } from "./data";

interface Props {
  status: McpStatus;
  /** When true, render the larger pill form used in the detail hero. */
  variant?: "dot" | "pill";
}

const STYLES: Record<
  McpStatus,
  { dot: string; pillText: string; pillBg: string; pillBorder: string; pulse: boolean }
> = {
  connected: {
    dot: "bg-emerald-400",
    pillText: "text-emerald-200",
    pillBg: "bg-emerald-500/10",
    pillBorder: "border-emerald-400/25",
    pulse: false,
  },
  disconnected: {
    dot: "bg-foreground/35",
    pillText: "text-foreground/60",
    pillBg: "bg-white/[0.04]",
    pillBorder: "border-white/[0.1]",
    pulse: false,
  },
  starting: {
    dot: "bg-amber-400",
    pillText: "text-amber-200",
    pillBg: "bg-amber-500/10",
    pillBorder: "border-amber-400/25",
    pulse: true,
  },
  errored: {
    dot: "bg-rose-400",
    pillText: "text-rose-200",
    pillBg: "bg-rose-500/10",
    pillBorder: "border-rose-400/30",
    pulse: false,
  },
};

export function McpStatusBadge({ status, variant = "dot" }: Props) {
  const s = STYLES[status];
  if (variant === "pill") {
    return (
      <span
        className={`
          flex items-center gap-1.5 rounded-full border
          px-2 py-0.5
          text-[10.5px] font-medium uppercase tracking-[0.1em]
          ${s.pillText} ${s.pillBg} ${s.pillBorder}
        `}
      >
        <span
          className={`size-1.5 rounded-full ${s.dot} ${
            s.pulse ? "animate-[pulse-soft_1.2s_ease-in-out_infinite]" : ""
          }`}
        />
        {STATUS_LABELS[status]}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground/65">
      <span
        className={`size-1.5 shrink-0 rounded-full ${s.dot} ${
          s.pulse ? "animate-[pulse-soft_1.2s_ease-in-out_infinite]" : ""
        }`}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
