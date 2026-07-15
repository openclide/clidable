import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AGENTS, type AgentId } from "../../welcome/data";
import { AgentIcon } from "../../icons/AgentIcon";

interface Props {
  value: AgentId;
  onChange: (next: AgentId) => void;
  /** Tightens the visual style. */
  size?: "sm" | "md";
}

interface MenuPos {
  left: number;
  width: number;
  /** Anchored at the trigger's bottom (open down) or top (open up). */
  top?: number;
  bottom?: number;
  target: Element;
}

/**
 * Click-to-open agent picker listing all agents. The menu is rendered through a
 * portal into the enclosing <dialog> (positioned `fixed` at the trigger) so it
 * escapes the modal's scroll/overflow clipping while staying in the dialog's
 * top layer. Closes on outside click, selection, Escape, scroll, or resize.
 */
export function HandlerPicker({ value, onChange, size = "md" }: Props) {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentAgent = AGENTS.find((a) => a.id === value);
  const open = pos !== null;

  const openMenu = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const MENU_MAX = 320;
    const spaceBelow = window.innerHeight - r.bottom;
    // Flip up only when there isn't room below and there's more room above.
    const up = spaceBelow < Math.min(MENU_MAX, 240) && r.top > spaceBelow;
    setPos({
      left: r.left,
      width: r.width,
      target: el.closest("dialog") ?? document.body,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  };

  // Close on outside click (trigger + menu both excluded), Escape, scroll, resize.
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    // Capture so the modal's inner scroll container (not just window) triggers it.
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const pad = size === "sm" ? "px-2 py-1" : "px-2.5 py-1.5";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) setPos(null);
          else openMenu();
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`
          group flex items-center gap-1.5 rounded-lg
          border border-white/[0.08] bg-white/[0.025]
          ${pad}
          text-[11.5px] text-foreground/85
          transition-[background-color,border-color] duration-150
          hover:border-white/[0.16] hover:bg-white/[0.05]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        `}
        style={{ "--agent": currentAgent?.color ?? "currentColor" } as React.CSSProperties}
      >
        {currentAgent && (
          <AgentIcon id={currentAgent.id} size={11} className="shrink-0 opacity-90" />
        )}
        <span>{currentAgent?.name ?? value}</span>
        <svg
          viewBox="0 0 24 24"
          width={10}
          height={10}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`opacity-60 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              minWidth: Math.max(200, pos.width),
            }}
            className="
              z-[100] flex max-h-[min(320px,70vh)] flex-col gap-0.5
              overflow-y-auto rounded-xl
              border border-white/[0.1] bg-[oklch(0.13_0.015_280/0.97)]
              p-1 shadow-[0_8px_28px_rgba(0,0,0,0.45)]
              backdrop-blur-xl
            "
            onClick={(e) => e.stopPropagation()}
          >
            {AGENTS.map((agent) => {
              const selected = agent.id === value;
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(agent.id);
                    setPos(null);
                  }}
                  className={`
                    flex items-center gap-2 rounded-lg
                    px-2.5 py-1.5 text-left text-[12px]
                    transition-[background-color,color] duration-100
                    ${
                      selected
                        ? "bg-white/[0.08] text-foreground"
                        : "text-foreground/70 hover:bg-white/[0.04] hover:text-foreground"
                    }
                    focus:outline-none focus-visible:bg-white/[0.06]
                  `}
                >
                  <AgentIcon id={agent.id} size={12} className="opacity-90" />
                  <span className="flex-1">{agent.name}</span>
                  {selected && (
                    <svg
                      viewBox="0 0 24 24"
                      width={11}
                      height={11}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="opacity-70"
                    >
                      <path d="M5 12l4 4 10-10" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>,
          pos.target,
        )}
    </>
  );
}
