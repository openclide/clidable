import type { ReactNode } from "react";
import { relativeTime, getAgent, type MockProject } from "./data";
import { useProjects } from "../../lib/projects-client";
import { AgentIcon } from "../icons/AgentIcon";

interface Props {
  onOpen: (project: MockProject) => void;
  /** Open an existing folder on disk (folder picker → register → launch). */
  onOpenFolder: () => void;
  /** Scaffold a brand-new project from a template. */
  onCreate: () => void;
}

export function RecentProjects({ onOpen, onOpenFolder, onCreate }: Props) {
  const { projects, loading, error } = useProjects();

  let body: ReactNode;
  if (error) {
    body = (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-7 text-center">
        <p className="text-sm text-rose-400/80">Couldn’t load projects.</p>
        <p className="mt-1 text-xs text-foreground/35">{error}</p>
      </div>
    );
  } else if (loading && projects.length === 0) {
    body = (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-7 text-center">
        <p className="text-sm text-foreground/45">Loading projects…</p>
      </div>
    );
  } else if (projects.length === 0) {
    body = (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-7 text-center">
        <p className="text-sm text-foreground/55">No recent projects yet.</p>
        <p className="mt-1 text-xs text-foreground/35">
          Open a folder or create one to get started.
        </p>
      </div>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-2">
        {projects.map((p) => {
          const agent = getAgent(p.lastAgent);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onOpen(p)}
                className="
                  group relative flex w-full items-center gap-3 overflow-hidden
                  rounded-xl border border-white/[0.06] bg-white/[0.02]
                  px-4 py-3 text-left
                  transition-[background-color,border-color,transform]
                  duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
                  hover:-translate-y-px hover:border-white/[0.14] hover:bg-white/[0.04]
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                "
                style={{ "--agent": agent.color } as React.CSSProperties}
              >
                {/* Agent attribution stripe on the left edge */}
                <span
                  aria-hidden
                  className="
                    absolute inset-y-2 left-0 w-[2px] rounded-full
                    bg-[color:var(--agent)]/45
                    transition-[background-color,inset-block]
                    duration-200
                    group-hover:bg-[color:var(--agent)]/85 group-hover:inset-y-1
                  "
                />

                {/* Agent badge */}
                <span
                  className="
                    flex size-9 shrink-0 items-center justify-center rounded-xl
                    border border-white/[0.06] bg-white/[0.025]
                  "
                >
                  <AgentIcon id={agent.id} size={18} />
                </span>

                {/* Project info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium tracking-tight">
                      {p.name}
                    </span>
                    <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wider text-foreground/40">
                      {relativeTime(p.lastOpenedAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-foreground/50">
                    <span className="truncate font-mono">{p.path}</span>
                    <span className="text-foreground/25">·</span>
                    <span>{agent.name}</span>
                  </div>
                </div>

                {/* Chevron */}
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  width={14}
                  height={14}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="
                    shrink-0 text-foreground/30
                    transition-[color,transform] duration-200
                    group-hover:translate-x-0.5 group-hover:text-foreground/70
                  "
                >
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {body}

      {/* Open / create — always available, regardless of the recents list. */}
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
