import { useEffect, useState } from "react";
import { WelcomeScreen } from "./components/welcome/WelcomeScreen";
import { WorkspaceScreen } from "./components/workspace/WorkspaceScreen";
import type { AgentId, Project } from "./components/welcome/data";
import { openProject, touchProject } from "./lib/projects-client";
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  touchWorkspace,
  type WorkspaceFull,
} from "./lib/workspaces-client";

type View =
  | { kind: "welcome" }
  | { kind: "workspace"; workspace: WorkspaceFull };

export function App() {
  const [view, setView] = useState<View>({ kind: "welcome" });
  // Surfaced when a deep-link (`?cwd=` / `?workspace=`) fails — e.g. a stale
  // shared URL, or `clidable open <path>` on a folder that's gone.
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  // Open / create / pick-agent → always a FRESH workspace for the project.
  // touchProject records lastAgent synchronously (so the seeded terminal uses
  // it) and bumps the project's recency; createWorkspace mints the row. Shared
  // by the welcome flow and the `?cwd=` deep-link (which passes no agent).
  const openWorkspaceFor = async (project: Project, agentId?: AgentId) => {
    if (agentId) {
      void touchProject(project.id, agentId).catch((e) =>
        console.error("[app] touchProject failed", e),
      );
    }
    const workspace = await createWorkspace({ projectIds: [project.id] });
    setView({ kind: "workspace", workspace });
  };

  // Resume an existing workspace — restore its full state. Shared by the home
  // list and the `?workspace=` deep-link.
  const resumeWorkspace = async (id: string) => {
    const workspace = await getWorkspace(id);
    if (!workspace) return; // vanished (all projects removed) — list refreshes
    void touchWorkspace(id).catch((e) =>
      console.error("[app] touchWorkspace failed", e),
    );
    setView({ kind: "workspace", workspace });
  };

  // Deep-link on first load — the seam every UI surface (a second desktop
  // window, `clidable open <dir>`, a shared URL) uses to land straight in a
  // workspace instead of the home screen:
  //   ?workspace=<id>  → resume it
  //   ?cwd=<abs path>  → RESUME the most-recent workspace that already contains
  //                      this folder (so `clidable open .` reopens where you left
  //                      off instead of piling up new workspaces); create a fresh
  //                      one only if none exists — or if ?new=1 forces it.
  // The param is stripped immediately so a manual reload doesn't re-fire. Runs
  // once, best-effort.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wsId = params.get("workspace");
    const cwd = params.get("cwd");
    const forceNew = params.get("new") === "1";
    if (!wsId && !cwd) return;
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      try {
        if (wsId) {
          await resumeWorkspace(wsId);
          return;
        }
        if (!cwd) return;
        const project = await openProject(cwd);
        if (!forceNew) {
          // listWorkspaces is most-recent-first, so the first match is the
          // latest workspace whose open projects include this folder.
          const existing = (await listWorkspaces()).find((w) =>
            w.projects.some((p) => p.id === project.id),
          );
          if (existing) {
            await resumeWorkspace(existing.id);
            return;
          }
        }
        await openWorkspaceFor(project);
      } catch (e) {
        console.error("[app] deep-link failed", e);
        setDeepLinkError((e as Error)?.message ?? "Could not open that location.");
      }
    })();
    // Mount-only: the deep-link is consumed once at load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view.kind === "workspace") {
    return (
      <WorkspaceScreen
        workspace={view.workspace}
        onBack={() => setView({ kind: "welcome" })}
      />
    );
  }

  return (
    <>
      {deepLinkError && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4"
          style={{ animation: "enter-up 240ms cubic-bezier(0.2,0.7,0.2,1) both" }}
        >
          <div className="flex max-w-lg items-start gap-3 rounded-xl border border-rose-400/25 bg-rose-500/15 px-4 py-2.5 text-[13px] text-rose-100 shadow-lg backdrop-blur-md">
            <span className="min-w-0">
              Couldn’t open that location — {deepLinkError}
            </span>
            <button
              type="button"
              onClick={() => setDeepLinkError(null)}
              aria-label="Dismiss"
              className="-mr-1 shrink-0 rounded-md px-1 text-rose-200/70 transition-colors hover:bg-white/10 hover:text-rose-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <WelcomeScreen
        onNewProject={(project, agentId) => void openWorkspaceFor(project, agentId)}
        onResumeWorkspace={(id) => void resumeWorkspace(id)}
      />
    </>
  );
}
