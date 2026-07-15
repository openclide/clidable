import type { ReactNode } from "react";

export type WorkspaceTool = "team" | "skills" | "plugins" | "mcp" | "context";

/**
 * Single source of truth for the workspace-scoped feature tools. Both the
 * desktop cluster (below) and the mobile tools menu (MobileChrome) render from
 * this — `icon(size)` lets each pick its own glyph size.
 */
export const WORKSPACE_TOOLS: ReadonlyArray<{
  id: WorkspaceTool;
  label: string;
  icon: (size: number) => ReactNode;
}> = [
  {
    id: "team",
    label: "AI Team",
    icon: (s) => (
      <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3" />
        <circle cx="16" cy="9" r="2.5" />
        <path d="M3 19a6 6 0 0112 0" />
        <path d="M14 19a5 5 0 017-3" />
      </svg>
    ),
  },
  {
    id: "skills",
    label: "Skills",
    icon: (s) => (
      <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l2.2 5.6L20 10l-5 4 1.5 6L12 16.8 7.5 20 9 14l-5-4 5.8-1.4z" />
      </svg>
    ),
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: (s) => (
      <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 4.5a2.5 2.5 0 11-5 0H4.5v4.6a2.5 2.5 0 110 5V19h4.6a2.5 2.5 0 115 0H19v-4.6a2.5 2.5 0 110-5V4.5z" />
      </svg>
    ),
  },
  {
    id: "mcp",
    label: "MCP",
    icon: (s) => (
      <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 8V4M15 8V4" />
        <path d="M6 8h12v4a6 6 0 01-12 0V8z" />
        <path d="M12 18v3" />
      </svg>
    ),
  },
  {
    id: "context",
    label: "Context",
    icon: (s) => (
      <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    ),
  },
];

interface Props {
  onOpen?: (tool: WorkspaceTool) => void;
}

/**
 * Cluster of workspace-scoped feature buttons that sit in the top chrome
 * between the back chip and the right-side window icons. Each opens its
 * manager panel.
 */
export function WorkspaceTools({ onOpen }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {WORKSPACE_TOOLS.map((t) => (
        <ToolButton key={t.id} label={t.label} onClick={() => onOpen?.(t.id)}>
          {t.icon(13)}
        </ToolButton>
      ))}
    </div>
  );
}

function ToolButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="
        glass group flex items-center gap-1.5 rounded-xl
        px-2.5 py-1.5
        text-[12px] font-medium text-foreground/60
        transition-[color,border-color,transform] duration-150
        hover:-translate-y-px hover:border-white/[0.18] hover:text-foreground
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
      "
    >
      <span className="opacity-80 transition-opacity duration-150 group-hover:opacity-100">
        {children}
      </span>
      <span className="tracking-tight">{label}</span>
    </button>
  );
}
