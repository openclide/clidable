import type { ReactNode } from "react";
import { relativeTime, getAgent, type AgentId } from "./data";
import {
  removeWorkspace,
  useWorkspaces,
  type Workspace,
} from "../../lib/workspaces-client";
import { openWorkspaceInNewWindow } from "../../lib/open-window";
import { AgentIcon } from "../icons/AgentIcon";

interface Props {
  /** Resume a saved workspace (restore its full state). */
  onOpen: (workspaceId: string) => void;
  /** Open an existing folder on disk → a fresh workspace. */
  onOpenFolder: () => void;
  /** Scaffold a brand-new project → a fresh workspace. */
  onCreate: () => void;
}

/** Display label for a workspace: a user-set name wins; a solo workspace shows
 *  its project's name; a multi-project one shows "First +N". */
function workspaceLabel(ws: Workspace): string {
  if (ws.name && ws.name.trim()) return ws.name;
  const [first, ...rest] = ws.projects;
  if (!first) return "Workspace";
  return rest.length === 0 ? first.name : `${first.name} +${rest.length}`;
}

/** Distinct agents across a workspace's projects, primary (first project) first —
 *  drives the badge stack. */
function workspaceAgents(ws: Workspace): AgentId[] {
  const seen = new Set<string>();
  const out: AgentId[] = [];
  for (const p of ws.projects) {
    const id = getAgent(p.lastAgent).id;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function RecentWorkspaces({ onOpen, onOpenFolder, onCreate }: Props) {
  const { workspaces, loading, error } = useWorkspaces();

  let body: ReactNode;
  if (error) {
    body = (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-7 text-center">
        <p className="text-sm text-rose-400/80">Couldn’t load workspaces.</p>
        <p className="mt-1 text-xs text-foreground/35">{error}</p>
      </div>
    );
  } else if (loading && workspaces.length === 0) {
    body = (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-7 text-center">
        <p className="text-sm text-foreground/45">Loading workspaces…</p>
      </div>
    );
  } else if (workspaces.length === 0) {
    body = (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-7 text-center">
        <p className="text-sm text-foreground/55">No workspaces yet.</p>
        <p className="mt-1 text-xs text-foreground/35">
          Open a folder or create a project to start one.
        </p>
      </div>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-2">
        {workspaces.map((ws) => {
          const agents = workspaceAgents(ws);
          const primary = getAgent(ws.projects[0]?.lastAgent ?? "claude");
          const label = workspaceLabel(ws);
          const multi = ws.projects.length > 1;
          const subline = multi
            ? ws.projects.map((p) => p.name).join(", ")
            : (ws.projects[0]?.path ?? "");
          return (
            <li key={ws.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpen(ws.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(ws.id);
                  }
                }}
                className="
                  group relative flex w-full cursor-pointer items-center gap-3
                  overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]
                  px-4 py-3 text-left
                  transition-[background-color,border-color,transform]
                  duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
                  hover:-translate-y-px hover:border-white/[0.14] hover:bg-white/[0.04]
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                "
                style={{ "--agent": primary.color } as React.CSSProperties}
              >
                {/* Agent attribution stripe on the left edge */}
                <span
                  aria-hidden
                  className="
                    absolute inset-y-2 left-0 w-[2px] rounded-full
                    bg-[color:var(--agent)]/45
                    transition-[background-color,inset-block] duration-200
                    group-hover:bg-[color:var(--agent)]/85 group-hover:inset-y-1
                  "
                />

                {/* Agent badge stack (up to 3 distinct agents across the
                    workspace's projects); opaque backing so they overlap cleanly. */}
                <span className="flex shrink-0 -space-x-2">
                  {agents.slice(0, 3).map((id) => (
                    <span
                      key={id}
                      className="
                        flex size-9 items-center justify-center rounded-xl
                        border border-white/[0.08] bg-background
                      "
                    >
                      <AgentIcon id={id} size={18} />
                    </span>
                  ))}
                </span>

                {/* Workspace info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium tracking-tight">
                      {label}
                    </span>
                    {multi && (
                      <span className="shrink-0 rounded-full border border-white/[0.08] px-1.5 py-px text-[9.5px] uppercase tracking-wider text-foreground/45">
                        {ws.projects.length} projects
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wider text-foreground/40">
                      {relativeTime(ws.lastOpened)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11.5px] text-foreground/50">
                    {subline}
                  </div>
                </div>

                {/* Hover actions — each stops the row's resume-in-place click. */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={`Open ${label} in a new window`}
                    title="Open in new window"
                    onClick={(e) => {
                      e.stopPropagation();
                      openWorkspaceInNewWindow(ws.id);
                    }}
                    className="
                      flex size-7 items-center justify-center rounded-lg
                      text-foreground/30
                      transition-[color,background-color] duration-150
                      hover:bg-white/[0.06] hover:text-foreground/80
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                    "
                  >
                    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 4h6v6M20 4l-8 8M18 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    title="Remove workspace"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeWorkspace(ws.id).catch((err) =>
                        console.error("[workspaces] remove failed", err),
                      );
                    }}
                    className="
                      flex size-7 items-center justify-center rounded-lg
                      text-foreground/30
                      transition-[color,background-color] duration-150
                      hover:bg-white/[0.06] hover:text-rose-300/90
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                    "
                  >
                    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {body}

      {/* Open / create — always available, regardless of the workspace list. */}
      <div className="grid grid-cols-2 gap-2">
        <ActionButton
          title="Open a project"
          subtitle="Existing folder on disk"
          onClick={onOpenFolder}
          icon={
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          }
        />
        <ActionButton
          title="Create a project"
          subtitle="Scaffold from a template"
          onClick={onCreate}
          dashed
          icon={
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          }
        />
      </div>
    </div>
  );
}

function ActionButton({
  title,
  subtitle,
  icon,
  onClick,
  dashed,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  onClick: () => void;
  dashed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        group flex items-center gap-3 rounded-xl px-3.5 py-3 text-left
        transition-[background-color,border-color,transform] duration-150
        hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        ${
          dashed
            ? "border border-dashed border-white/[0.12] bg-transparent hover:border-white/[0.25] hover:bg-white/[0.03]"
            : "border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.05]"
        }
      `}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-foreground/65 transition-colors group-hover:text-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="block truncate text-[11px] text-foreground/45">{subtitle}</span>
      </span>
    </button>
  );
}
