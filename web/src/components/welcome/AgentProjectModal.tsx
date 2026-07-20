import { useState } from "react";
import { Modal } from "../ui/Modal";
import { AgentIcon } from "../icons/AgentIcon";
import { relativeTime, getAgent, type AgentId, type Project } from "./data";
import { openProject, useProjects } from "../../lib/projects-client";
import { FolderPickerModal } from "../workspace/FolderPickerModal";

interface Props {
  agentId: AgentId | null;
  onClose: () => void;
  onPickProject: (project: Project, agentId: AgentId) => void;
  onCreateProject: (agentId: AgentId) => void;
}

/**
 * Opens when the user clicks an agent icon on the welcome screen.
 * Shows the recent project list (any project can be opened with any agent),
 * an "open a folder" action, and an option to scaffold a new one.
 */
export function AgentProjectModal({
  agentId,
  onClose,
  onPickProject,
  onCreateProject,
}: Props) {
  const agent = agentId ? getAgent(agentId) : null;
  const { projects } = useProjects();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePickFolder(path: string) {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      const project = await openProject(path, agent.id);
      setPickerOpen(false);
      onPickProject(project, agent.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!agentId}
      onClose={onClose}
      size="md"
      title={
        agent ? (
          <span className="flex items-center gap-2">
            <span
              className="flex size-6 items-center justify-center rounded-lg border border-white/[0.08]"
              style={{ background: `${agent.color}14` }}
            >
              <AgentIcon id={agent.id} size={14} />
            </span>
            <span>Open with {agent.name}</span>
          </span>
        ) : null
      }
    >
      {agent && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-foreground/55">
            Pick a project for this session, or open / create one.
          </p>

          {/* Recent projects */}
          {projects.length > 0 && (
            <div>
              <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-foreground/45">
                Recent projects
              </h3>
              <ul className="flex max-h-56 flex-col gap-1.5 overflow-auto">
                {projects.map((p) => {
                  const last = getAgent(p.lastAgent);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => onPickProject(p, agent.id)}
                        className="
                          group flex w-full items-center gap-3 rounded-lg
                          border border-white/[0.05] bg-white/[0.02]
                          px-3 py-2.5 text-left
                          transition-[background-color,border-color]
                          duration-150
                          hover:border-white/[0.14] hover:bg-white/[0.05]
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                        "
                      >
                        <AgentIcon id={last.id} size={16} className="shrink-0 opacity-80" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{p.name}</div>
                          <div className="truncate font-mono text-[10.5px] text-foreground/45">
                            {p.path}
                          </div>
                        </div>
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-foreground/35">
                          {relativeTime(p.lastOpenedAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-foreground/30">
            <span className="h-px flex-1 bg-white/[0.06]" />
            or
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>

          {error && (
            <p className="text-[11px] text-rose-400/80">{error}</p>
          )}

          {/* Open existing folder */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="
              group flex items-center gap-3 rounded-lg
              border border-white/[0.08] bg-white/[0.02]
              px-3 py-2.5 text-left
              transition-[background-color,border-color] duration-150
              hover:border-white/[0.16] hover:bg-white/[0.05]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
            "
          >
            <span className="flex size-7 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.04] text-foreground/65">
              <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            </span>
            <div>
              <div className="text-[13px] font-medium">Open a folder</div>
              <div className="text-[11px] text-foreground/45">
                Register an existing project on disk
              </div>
            </div>
          </button>

          {/* Create new */}
          <button
            type="button"
            onClick={() => onCreateProject(agent.id)}
            className="
              group flex items-center gap-3 rounded-lg
              border border-dashed border-white/[0.12] bg-transparent
              px-3 py-2.5 text-left
              transition-[background-color,border-color]
              duration-150
              hover:border-white/[0.25] hover:bg-white/[0.03]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
            "
          >
            <span
              className="
                flex size-7 items-center justify-center rounded-md
                border border-white/[0.1] bg-white/[0.04]
                text-foreground/65
                group-hover:text-foreground
                transition-colors
              "
            >
              <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <div className="text-[13px] font-medium">Create new project</div>
              <div className="text-[11px] text-foreground/45">
                Scaffold from a template
              </div>
            </div>
          </button>
        </div>
      )}

      <FolderPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePickFolder}
        busy={busy}
      />
    </Modal>
  );
}
