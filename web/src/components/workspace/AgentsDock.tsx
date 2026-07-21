import { useState } from "react";
import { AgentStatusIcon } from "./AgentStatusIcon";
import { getAgent, shortAgentName, type Project } from "../welcome/data";
import { ProjectBadge, shouldTintProjects } from "./ProjectBadge";
import {
  hasTerminalDrag,
  isLeavingTarget,
  readTerminalDrag,
  type TerminalDragPayload,
} from "./terminal-dnd";
import type { PaneId, TileTerminal } from "./paneTree";

/** One terminal listed in the dock — either live in a pane (with its location
 *  so a click can jump to it) or minimized out of the grid. */
export interface DockEntry {
  terminal: TileTerminal;
  minimized: boolean;
  paneId?: PaneId;
  tabIndex?: number;
}

interface Props {
  /** Every terminal in the workspace — live tabs first, then minimized. */
  entries: DockEntry[];
  projectsById: Map<string, Project>;
  openProjects: Project[];
  /** Instance ids currently on screen (active tab of a rendered pane), shown
   *  highlighted so the roster reflects where you are. */
  visibleIds: Set<string>;
  /** Jump to a live terminal, or restore a minimized one. */
  onActivate: (entry: DockEntry) => void;
  /** Kill a minimized terminal without restoring it. */
  onCloseMinimized: (instanceId: string) => void;
  /** A tab chip was dropped on the dock → minimize it. */
  onDropTerminal: (from: TerminalDragPayload) => void;
}

/**
 * Agents Dock — the full-width strip below both panes (terminals + preview). A
 * roster of every terminal (live + minimized), each with its activity dot,
 * project initial, and agent. Click a live one to jump to it; click a minimized
 * one to restore it. Also a drop target: dragging a tab chip here minimizes it.
 * Hidden by default; toggled from the layout menu.
 */
export function AgentsDock({
  entries,
  projectsById,
  openProjects,
  visibleIds,
  onActivate,
  onCloseMinimized,
  onDropTerminal,
}: Props) {
  const [dropHover, setDropHover] = useState(false);
  const tinted = shouldTintProjects(openProjects.map((p) => p.name));

  return (
    <div
      onDragOver={(e) => {
        if (!hasTerminalDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropHover(true);
      }}
      onDragLeave={(e) => {
        if (isLeavingTarget(e)) setDropHover(false);
      }}
      onDrop={(e) => {
        setDropHover(false);
        const payload = readTerminalDrag(e);
        if (!payload) return;
        e.preventDefault();
        onDropTerminal(payload);
      }}
      className={`
        glass mt-2 flex shrink-0 items-center gap-1 overflow-x-auto
        rounded-2xl px-1.5 py-1.5
        transition-[border-color] duration-150
        ${dropHover ? "border-white/40!" : ""}
      `}
    >
      {entries.map((entry) => {
        const t = entry.terminal;
        const agent = getAgent(t.agentId);
        const projectName = projectsById.get(t.projectId)?.name ?? "?";
        const name = t.title?.trim() || shortAgentName(agent.name);
        const label = `${name} · ${projectName}`;
        const isVisible = visibleIds.has(t.instanceId);
        return (
          <button
            key={t.instanceId}
            type="button"
            onClick={() => onActivate(entry)}
            title={entry.minimized ? `Restore ${label}` : `Go to ${label}`}
            aria-label={entry.minimized ? `Restore ${label}` : `Go to ${label}`}
            style={{ "--agent": agent.color } as React.CSSProperties}
            className={`
              group/dock flex shrink-0 items-center gap-2 rounded-xl
              px-2.5 py-1.5 text-[12px] tracking-tight
              transition-[background-color,color,opacity] duration-150
              focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
              ${
                isVisible
                  ? "bg-white/[0.06] text-foreground"
                  : "text-foreground/60 hover:bg-white/[0.04] hover:text-foreground/90"
              }
              ${entry.minimized ? "opacity-55 hover:opacity-100" : ""}
            `}
          >
            <ProjectBadge
              name={projectName}
              size={15}
              tinted={tinted}
            />
            <AgentStatusIcon
              instanceId={t.instanceId}
              agentId={t.agentId}
              size={12}
              className="shrink-0 opacity-90"
            />
            <span className="truncate">{name}</span>
            {entry.minimized && (
              <span
                role="button"
                aria-label={`Close ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseMinimized(t.instanceId);
                }}
                className="
                  -mr-0.5 flex size-4 items-center justify-center rounded-md
                  text-foreground/40 opacity-0
                  transition-opacity duration-150
                  group-hover/dock:opacity-100
                  hover:bg-white/[0.1] hover:text-foreground/80
                "
              >
                <svg viewBox="0 0 24 24" width={9} height={9} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
