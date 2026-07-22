/**
 * New-project wizard (§7). Pick a template, a parent folder, and a name;
 * the server scaffolds it (official scaffolder, non-interactive), git-inits,
 * and registers it. On success the project opens straight into the workspace.
 */
import { useEffect, useState } from "react";
import { PROJECT_TEMPLATES, type ProjectTemplateId } from "@shared/types";
import { Modal } from "../ui/Modal";
import { AgentIcon } from "../icons/AgentIcon";
import { createProject, type Project } from "../../lib/projects-client";
import { browseDir } from "../../lib/fs-browse-client";
import { FolderPickerModal } from "../workspace/FolderPickerModal";
import { getAgent, type AgentId } from "./data";

interface Props {
  agentId: AgentId | null;
  onClose: () => void;
  onCreated: (project: Project, agentId: AgentId) => void;
}

export function NewProjectModal({ agentId, onClose, onCreated }: Props) {
  const agent = agentId ? getAgent(agentId) : null;
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [template, setTemplate] = useState<ProjectTemplateId>("vite-react");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the location to wherever Clidable was launched from, so a new
  // project lands next to what you were already working on. Falls back to home
  // when there's no usable launch dir — notably a Finder/Dock-launched desktop
  // app, whose cwd is "/".
  useEffect(() => {
    if (!agentId) {
      setName("");
      setParentDir(null);
      setError(null);
      setBusy(false);
      return;
    }
    browseDir()
      .then((v) => setParentDir((cur) => cur ?? v.cwd ?? v.home))
      .catch(() => {/* leave null; user picks manually */});
  }, [agentId]);

  const canCreate = !!parentDir && name.trim().length > 0 && !busy;

  async function handleCreate() {
    if (!agent || !parentDir) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createProject(
        { parentDir, name: name.trim(), template },
        agent.id,
      );
      onCreated(project, agent.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!agentId}
      onClose={busy ? () => {} : onClose}
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
            <span>New project with {agent.name}</span>
          </span>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {/* Name */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">
            Project name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-app"
            autoFocus
            spellCheck={false}
            disabled={busy}
            className="
              rounded-lg border border-white/[0.08] bg-white/[0.03]
              px-3 py-2 text-[13px] text-foreground
              placeholder:text-foreground/30
              focus:border-white/[0.2] focus:outline-none
            "
          />
        </label>

        {/* Location */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">
            Location
          </span>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[11px] text-foreground/70">
              {parentDir ? `${parentDir}/${name.trim() || "…"}` : "Choose a folder…"}
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={busy}
              className="
                shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.04]
                px-3 py-2 text-[12px] text-foreground/80
                transition-colors hover:bg-white/[0.08] disabled:opacity-40
              "
            >
              Change…
            </button>
          </div>
        </div>

        {/* Template */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">
            Template
          </span>
          <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-auto sm:grid-cols-2">
            {PROJECT_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                disabled={busy}
                className={`
                  flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left
                  transition-colors
                  ${
                    template === t.id
                      ? "border-white/[0.22] bg-white/[0.07]"
                      : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                  }
                `}
              >
                <span className="text-[12.5px] font-medium text-foreground/90">
                  {t.label}
                </span>
                <span className="text-[10.5px] text-foreground/45">
                  {t.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-[11px] text-rose-400/80">{error}</p>}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-[12px] text-foreground/60 transition-colors hover:text-foreground disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className="
              rounded-lg border border-white/[0.12] bg-white/[0.06]
              px-3 py-1.5 text-[12px] font-medium text-foreground
              transition-colors hover:bg-white/[0.1]
              disabled:opacity-40 disabled:hover:bg-white/[0.06]
            "
          >
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>

      <FolderPickerModal
        open={pickerOpen}
        initialPath={parentDir}
        onClose={() => setPickerOpen(false)}
        onPick={(path) => {
          setParentDir(path);
          setPickerOpen(false);
        }}
      />
    </Modal>
  );
}
