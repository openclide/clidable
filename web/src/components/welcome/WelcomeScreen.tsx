import { useState } from "react";
import logoUrl from "../../../logo.png";
import packageJson from "../../../../package.json" with { type: "json" };
import { AgentRow } from "./AgentRow";
import { RecentWorkspaces } from "./RecentWorkspaces";
import { AgentProjectModal } from "./AgentProjectModal";
import { NewProjectModal } from "./NewProjectModal";
import { FolderPickerModal } from "../workspace/FolderPickerModal";
import { GlassPanel } from "../ui/GlassPanel";
import { isTauri } from "../../lib/shell";
import { openProject } from "../../lib/projects-client";
import type { AgentId, Project } from "./data";

/** Agent a project gets when opened/created from the workspaces panel without
 *  first picking one. Matches projects-client's lastAgent default; the user can
 *  switch agents in the workspace composer afterward. */
const DEFAULT_AGENT: AgentId = "claude";

interface Props {
  /** Open/create/pick-agent on a project → start a fresh workspace for it. */
  onNewProject: (project: Project, agentId: AgentId) => void;
  /** Resume a saved workspace from the list → restore its full state. */
  onResumeWorkspace: (workspaceId: string) => void;
}

export function WelcomeScreen({ onNewProject, onResumeWorkspace }: Props) {
  const [pickedAgent, setPickedAgent] = useState<AgentId | null>(null);
  // Agent the New-Project wizard is creating for (null = wizard closed).
  const [createAgent, setCreateAgent] = useState<AgentId | null>(null);

  // "Open a project" from the Recent-projects panel: pick a folder, register
  // it, and resume with whatever agent it last used (Claude for a fresh one).
  const [openPickerOpen, setOpenPickerOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  async function handleOpenFolder(path: string) {
    setOpening(true);
    setOpenError(null);
    try {
      const project = await openProject(path);
      setOpenPickerOpen(false);
      onNewProject(project, project.lastAgent);
    } catch (e) {
      setOpenError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="relative min-h-screen w-screen overflow-y-auto">
      {/* Tauri drag strip — sits in the empty top zone (above the hero) so
          the user can grab the window from the title-bar area like a native
          macOS app. macOS still handles its traffic-light clicks on top
          regardless of this strip. Gated on Tauri so the browser shell
          doesn't throw on the missing IPC. */}
      {isTauri() && (
        <div
          data-tauri-drag-region
          aria-hidden
          className="absolute inset-x-0 top-0 z-10 h-14"
        />
      )}

      {/* Reserve space for the macOS overlay traffic lights at the very top. */}
      <div className="mx-auto flex max-w-2xl flex-col items-stretch px-6 pt-16 pb-12 sm:pt-20">
        {/* Hero */}
        <header
          className="flex flex-col items-center text-center"
          style={{ animation: "enter-up 320ms cubic-bezier(0.2,0.7,0.2,1) both" }}
        >
          <img
            src={logoUrl}
            alt=""
            width={88}
            height={88}
            draggable={false}
            className="
              size-22 select-none
              drop-shadow-[0_0_28px_rgba(139,92,246,0.35)]
            "
          />
          <h1 className="mt-5 text-2xl font-medium tracking-tight">Clidable</h1>
          <p className="mt-1 text-sm text-foreground">
            CLI coding agents for everyone
          </p>
          <div className="mt-3 flex items-center gap-3 text-[10.5px] uppercase tracking-[0.16em] text-foreground/70">
            <span className="h-px w-10 bg-foreground/25" />
            v{packageJson.version}
            <span className="h-px w-10 bg-foreground/25" />
          </div>
        </header>

        {/* Agents */}
        <GlassPanel
          className="mt-10"
          padding="p-5"
          title="Pick an agent"
          subtitle="Each one runs in its own terminal session with full TUI"
          style={{ animation: "enter-up 360ms 80ms cubic-bezier(0.2,0.7,0.2,1) both" }}
        >
          <AgentRow onPick={setPickedAgent} />
        </GlassPanel>

        {/* Workspaces */}
        <GlassPanel
          className="mt-5"
          padding="p-5"
          title="Workspaces"
          subtitle="Click to resume — terminals, splits, and agents come back"
          style={{ animation: "enter-up 360ms 160ms cubic-bezier(0.2,0.7,0.2,1) both" }}
        >
          <RecentWorkspaces
            onOpen={onResumeWorkspace}
            onOpenFolder={() => setOpenPickerOpen(true)}
            onCreate={() => setCreateAgent(DEFAULT_AGENT)}
          />
          {openError && (
            <p className="mt-3 text-[11px] text-rose-400/80">{openError}</p>
          )}
        </GlassPanel>

        {/* Footer hint */}
        <p
          className="mt-10 text-center text-[11px] text-foreground"
          style={{ animation: "enter-up 360ms 240ms cubic-bezier(0.2,0.7,0.2,1) both" }}
        >
          Tip: clicking an agent lets you pick from any project, regardless of
          what it was last used with.
        </p>
      </div>

      {/* Modal that pops up when an agent icon is clicked */}
      <AgentProjectModal
        agentId={pickedAgent}
        onClose={() => setPickedAgent(null)}
        onPickProject={(p, id) => {
          setPickedAgent(null);
          onNewProject(p, id);
        }}
        onCreateProject={(id) => {
          setPickedAgent(null);
          setCreateAgent(id);
        }}
      />

      {/* New-project wizard — opens from the agent modal's "Create new" and
          the workspaces panel's "Create a project" action. */}
      <NewProjectModal
        agentId={createAgent}
        onClose={() => setCreateAgent(null)}
        onCreated={(project, id) => {
          setCreateAgent(null);
          onNewProject(project, id);
        }}
      />

      {/* Folder picker for the Recent-projects "Open a project" action. */}
      <FolderPickerModal
        open={openPickerOpen}
        onClose={() => setOpenPickerOpen(false)}
        onPick={handleOpenFolder}
        busy={opening}
      />
    </div>
  );
}
