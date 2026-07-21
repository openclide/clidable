import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../welcome/data";
import { ProjectBadge, shouldTintProjects } from "./ProjectBadge";

interface Props {
  projects: Project[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}

// Chip-scale shadow (glass's full panel shadow is too big for the scroll box
// and gets sheared by overflow clipping). Shared by the tabs and the + button.
const CHIP_SHADOW =
  "inset 0 1px 0 0 rgba(255,255,255,0.06), 0 2px 6px -1px rgba(0,0,0,0.45)";

/**
 * Top-of-window strip of open-project tabs. Active project drives default
 * preview + workspace-tool scope. The tabs scroll horizontally when they
 * overflow — with a gradient fade on whichever edge has hidden tabs — while
 * the `+` (AddProjectMenu) stays pinned outside the scroller, always visible.
 */
export function ProjectTabs({
  projects,
  activeId,
  onSelect,
  onClose,
  onAdd,
}: Props) {
  // Badges (and color, where initials collide) only earn their space once a
  // second project is open.
  const multi = projects.length > 1;
  const tinted = shouldTintProjects(projects.map((p) => p.name));

  // Fade the edge(s) that have scrolled-away tabs, so overflow reads as
  // "more over there" rather than a hard cut.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth - 1;
    setFade((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right },
    );
  }, []);
  useEffect(() => {
    updateFade();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateFade);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateFade, projects]);

  const edge = "0.625rem";
  // Only mask the edges that actually hide tabs; no mask at all otherwise, so
  // a non-scrolling strip has zero edge artifact.
  const mask =
    fade.left || fade.right
      ? `linear-gradient(to right, ${fade.left ? "transparent" : "#000"}, #000 ${
          fade.left ? edge : "0px"
        }, #000 calc(100% - ${fade.right ? edge : "0px"}), ${
          fade.right ? "transparent" : "#000"
        })`
      : undefined;

  return (
    <div className="flex min-w-0 items-center gap-1">
      {/* Scroller. overflow-x-auto clips both axes, so pad it (cancelled by a
          negative margin) to give the chip shadows room, and hide the bar —
          the fade mask signals scrollability instead. */}
      <div
        ref={scrollRef}
        onScroll={updateFade}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="flex min-w-0 items-center gap-1 overflow-x-auto py-2 -my-2 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {projects.map((p) => {
          const isActive = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              // Inline shadow wins over glass's utility box-shadow.
              style={{ boxShadow: CHIP_SHADOW }}
              className={`
                group glass relative flex shrink-0 items-center gap-1.5 rounded-xl
                px-2.5 py-1.5
                text-[12px] tracking-tight
                transition-[color,border-color,transform] duration-150
                hover:-translate-y-px hover:border-white/[0.18]
                focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                ${isActive ? "text-foreground" : "text-foreground/55 hover:text-foreground"}
              `}
            >
              {multi && (
                <ProjectBadge
                  name={p.name}
                  size={15}
                  tinted={tinted}
                />
              )}
              <span className="font-medium tracking-tight">{p.name}</span>

              {/* Close × only when more than one project is open. */}
              {multi && (
                <span
                  role="button"
                  aria-label={`Close ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(p.id);
                  }}
                  className="
                    -mr-0.5 flex size-4 items-center justify-center rounded-md
                    text-foreground/30
                    opacity-0
                    transition-opacity duration-150
                    group-hover:opacity-100
                    hover:bg-white/[0.08] hover:text-foreground/80
                  "
                >
                  <svg viewBox="0 0 24 24" width={9} height={9} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                    <path d="M6 6l12 12M6 18L18 6" />
                  </svg>
                </span>
              )}

              {/* Active marker */}
              {isActive && (
                <span
                  aria-hidden
                  className="
                    pointer-events-none absolute inset-x-3 -bottom-px h-[2px] rounded-full
                    bg-white/40 shadow-[0_0_8px_rgba(255,255,255,0.18)]
                  "
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Add-project button — pinned outside the scroller so it's always
          reachable, however many tabs are open. */}
      <button
        type="button"
        onClick={onAdd}
        aria-label="Open another project"
        title="Open another project"
        style={{ boxShadow: CHIP_SHADOW }}
        className="
          glass flex size-7 shrink-0 items-center justify-center rounded-xl
          text-foreground/45
          transition-[color,border-color,transform] duration-150
          hover:-translate-y-px hover:border-white/[0.18] hover:text-foreground/85
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        "
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
