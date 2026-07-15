import type { ReactNode } from "react";

export type MobileView = "cli" | "preview" | "code";

const VIEWS: ReadonlyArray<{ id: MobileView; label: string; icon: ReactNode }> = [
  {
    id: "cli",
    label: "CLI",
    icon: (
      <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 8l3.5 3.5L5 15" />
        <path d="M12 16h6" />
      </svg>
    ),
  },
  {
    id: "preview",
    label: "Preview",
    icon: (
      <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    ),
  },
  {
    id: "code",
    label: "Code",
    icon: (
      <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
      </svg>
    ),
  },
];

/**
 * Floating, glassy bottom segmented control — switches the single active view
 * (CLI · Preview · Code) on mobile. Padded for the home-indicator safe area,
 * and slides out of the way while the keyboard is up so it never covers it.
 */
export function MobileViewBar({
  value,
  onChange,
  hidden,
}: {
  value: MobileView;
  onChange: (next: MobileView) => void;
  hidden: boolean;
}) {
  return (
    <div
      aria-hidden={hidden}
      className={`
        pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4
        transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        ${hidden ? "translate-y-[180%] opacity-0" : "translate-y-0 opacity-100"}
      `}
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      <div
        role="tablist"
        aria-label="View"
        className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
      >
        {VIEWS.map((v) => {
          const active = value === v.id;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(v.id)}
              className={`
                flex items-center gap-2 rounded-xl px-4 py-2
                text-[13px] font-medium tracking-tight
                transition-colors duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                ${active ? "bg-white/[0.12] text-foreground" : "text-foreground/55 hover:text-foreground/80"}
              `}
            >
              <span className={active ? "opacity-95" : "opacity-80"}>{v.icon}</span>
              <span>{v.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
