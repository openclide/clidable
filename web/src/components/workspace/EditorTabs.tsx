/**
 * Editor tab strip. One row above the editor body — filename, dirty
 * dot, close button. Visually tuned to feel like the terminal-tile
 * tab strip elsewhere in the workspace so the workspace reads as a
 * single design language.
 *
 * Interactions:
 *   • Click anywhere on the tab → activate.
 *   • Middle-click → close (matches every browser tab affordance).
 *   • Close X is always visible on the active tab and on hover; the
 *     dirty dot lives inline next to the filename so it stays
 *     persistently visible regardless of close-button state.
 *
 * Out of scope for M2: tab reorder, scroll-into-view on activate,
 * overflow menu when tabs wrap.
 */
import type { Tab } from "./CodePane";

interface Props {
  tabs: Tab[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
}

export function EditorTabs({ tabs, activeIndex, onActivate, onClose }: Props) {
  return (
    <div
      className="
        flex shrink-0 items-stretch gap-px overflow-x-auto
        border-b border-white/[0.05]
      "
      style={{ scrollbarWidth: "none" }}
    >
      {tabs.map((tab, index) => (
        <TabButton
          key={tab.path}
          tab={tab}
          active={index === activeIndex}
          onActivate={() => onActivate(index)}
          onClose={() => onClose(index)}
        />
      ))}
    </div>
  );
}

interface TabButtonProps {
  tab: Tab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}

function TabButton({ tab, active, onActivate, onClose }: TabButtonProps) {
  const name = basename(tab.path);
  const dir = dirname(tab.path);

  // Middle-click → close. Mouse-up rather than mouse-down so the
  // browser-ish "I changed my mind, drag off the tab" gesture works.
  const onAuxUp = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="group relative flex items-stretch" onAuxClick={onAuxUp}>
      <button
        type="button"
        onClick={onActivate}
        title={tab.path}
        className={`
          flex max-w-[220px] items-center gap-1.5
          py-1.5 pl-3 pr-1.5
          font-mono text-[11px]
          transition-[color,background-color] duration-150
          focus:outline-none focus-visible:bg-white/[0.06]
          ${
            active
              ? "bg-white/[0.06] text-foreground"
              : "text-foreground/55 hover:bg-white/[0.025] hover:text-foreground/85"
          }
        `}
      >
        {dir ? (
          <span className="truncate text-foreground/35">{dir}/</span>
        ) : null}
        <span className="truncate">{name}</span>
        {tab.dirty ? (
          <span
            aria-label="Unsaved changes"
            title="Unsaved changes"
            className="ml-0.5 inline-block size-1.5 shrink-0 rounded-full bg-foreground/70"
          />
        ) : null}
      </button>

      <button
        type="button"
        aria-label={`Close ${name}`}
        title={tab.dirty ? "Discard unsaved changes" : "Close"}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={`
          mr-1 flex size-[18px] shrink-0 items-center justify-center
          self-center rounded-md
          text-foreground/55 transition-[opacity,background-color,color] duration-150
          ${active ? "opacity-80" : "opacity-0 group-hover:opacity-80"}
          hover:bg-white/[0.08] hover:!opacity-100 hover:text-foreground
          focus:opacity-100 focus:outline-none
        `}
      >
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
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}
