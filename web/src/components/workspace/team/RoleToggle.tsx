interface Props {
  on: boolean;
  onChange: (next: boolean) => void;
  size?: "sm" | "md";
}

/** Active-fill accent — one color for every enabled toggle, regardless of
 *  handler agent. */
const ON_COLOR = "var(--color-claude)";

/**
 * Small animated toggle switch. Used on role cards + role detail.
 */
export function RoleToggle({ on, onChange, size = "md" }: Props) {
  const dims =
    size === "sm"
      ? { w: 32, h: 18, knob: 14, off: 2, on: 16 }
      : { w: 38, h: 22, knob: 18, off: 2, on: 18 };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      style={{
        width: dims.w,
        height: dims.h,
        background: on
          ? `color-mix(in oklch, ${ON_COLOR} 55%, transparent)`
          : "color-mix(in oklch, white 6%, transparent)",
        borderColor: on
          ? `color-mix(in oklch, ${ON_COLOR} 65%, transparent)`
          : "color-mix(in oklch, white 12%, transparent)",
      }}
      className="
        relative shrink-0 rounded-full border
        transition-[background-color,border-color]
        duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
      "
    >
      <span
        style={{
          width: dims.knob,
          height: dims.knob,
          transform: `translateX(${on ? dims.on : dims.off}px)`,
        }}
        className="
          absolute top-1/2 left-0 -translate-y-1/2
          rounded-full bg-white
          shadow-[0_1px_3px_rgba(0,0,0,0.4)]
          transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        "
      />
    </button>
  );
}
