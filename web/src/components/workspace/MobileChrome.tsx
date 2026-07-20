import { useRef, useState } from "react";
import type { Project } from "../welcome/data";
import { WORKSPACE_TOOLS, type WorkspaceTool } from "./WorkspaceTools";
import { AddProjectMenu } from "./AddProjectMenu";
import { PositionedPortal } from "../ui/PositionedPortal";
import { ProjectBadge, duplicatedInitials } from "./ProjectBadge";

interface Props {
  openProjects: Project[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onCloseProject: (id: string) => void;
  onAddProject: (project: Project) => void;
  onBack: () => void;
  onOpenTool: (tool: WorkspaceTool) => void;
}

/** Which (if any) top-chrome popover is open — one union instead of three
 *  booleans, so impossible combinations (e.g. projects + tools) can't happen. */
type OpenMenu = "none" | "projects" | "add" | "tools";

/**
 * Compact top chrome for the mobile shell: a project switcher on the left and
 * a tools menu on the right — both collapsed to a single glass chip that opens
 * to reveal more (vs the desktop's always-visible tab strip + tool cluster).
 */
export function MobileChrome({
  openProjects,
  activeProjectId,
  onSelectProject,
  onCloseProject,
  onAddProject,
  onBack,
  onOpenTool,
}: Props) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>("none");
  const projAnchor = useRef<HTMLButtonElement>(null);
  const toolsAnchor = useRef<HTMLButtonElement>(null);

  const active = openProjects.find((p) => p.id === activeProjectId) ?? openProjects[0];
  const canClose = openProjects.length > 1;
  const dups = duplicatedInitials(openProjects.map((p) => p.name));
  const tinted = (name: string) => dups.has(name.charAt(0).toUpperCase());

  return (
    <header
      className="flex shrink-0 items-center gap-2 px-3 pb-2"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
    >
      {/* Project switcher (relative so the AddProjectMenu popover anchors here) */}
      <div className="relative flex min-w-0 flex-1">
        <button
          ref={projAnchor}
          type="button"
          onClick={() => setOpenMenu((m) => (m === "projects" ? "none" : "projects"))}
          aria-haspopup="menu"
          aria-expanded={openMenu === "projects"}
          className="
            glass flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-1.5
            text-foreground/85
            transition-[border-color] duration-150
            hover:border-white/[0.18]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
          "
        >
          <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium tracking-tight">
            {active?.name ?? "No project"}
          </span>
          <Chevron open={openMenu === "projects"} />
        </button>

        {openMenu === "add" && (
          <AddProjectMenu
            excludeIds={openProjects.map((p) => p.id)}
            onPick={(p) => {
              onAddProject(p);
              setOpenMenu("none");
            }}
            onClose={() => setOpenMenu("projects")}
            anchorRef={projAnchor}
          />
        )}
      </div>

      {/* Tools */}
      <button
        ref={toolsAnchor}
        type="button"
        onClick={() => setOpenMenu((m) => (m === "tools" ? "none" : "tools"))}
        title="Tools"
        aria-label="Tools"
        aria-haspopup="menu"
        aria-expanded={openMenu === "tools"}
        className="
          glass flex size-9 shrink-0 items-center justify-center rounded-xl
          text-foreground/70
          transition-[border-color,color] duration-150
          hover:border-white/[0.18] hover:text-foreground
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        "
      >
        <svg viewBox="0 0 24 24" width={17} height={17} fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {/* Project menu */}
      <PositionedPortal
        anchorRef={projAnchor}
        open={openMenu === "projects"}
        onClose={() => setOpenMenu("none")}
        width={248}
        placement="bottom"
        align="left"
        role="menu"
        className="glass flex max-h-[60vh] flex-col gap-0.5 overflow-auto rounded-2xl p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
      >
        {openProjects.map((p) => (
          <div
            key={p.id}
            className={`flex items-center gap-2 rounded-xl px-2 py-2 ${
              p.id === activeProjectId ? "bg-white/[0.08]" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onSelectProject(p.id);
                setOpenMenu("none");
              }}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <ProjectBadge name={p.name} tinted={tinted(p.name)} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85">
                {p.name}
              </span>
              {p.id === activeProjectId && (
                <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/70">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            {canClose && (
              <button
                type="button"
                aria-label={`Close ${p.name}`}
                onClick={() => onCloseProject(p.id)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/35 hover:bg-white/[0.08] hover:text-foreground/80"
              >
                <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            )}
          </div>
        ))}

        <div className="mx-1 my-1 h-px bg-white/[0.06]" />

        <button
          type="button"
          onClick={() => setOpenMenu("add")}
          className="flex items-center gap-2 rounded-xl px-2 py-2 text-left text-[13px] text-foreground/80 hover:bg-white/[0.06] hover:text-foreground"
        >
          <span className="flex size-6 items-center justify-center rounded-md border border-white/[0.1] text-foreground/60">
            <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          Add project
        </button>
      </PositionedPortal>

      {/* Tools menu */}
      <PositionedPortal
        anchorRef={toolsAnchor}
        open={openMenu === "tools"}
        onClose={() => setOpenMenu("none")}
        width={216}
        placement="bottom"
        align="right"
        role="menu"
        className="glass flex flex-col gap-0.5 rounded-2xl p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
      >
        {WORKSPACE_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenTool(t.id);
              setOpenMenu("none");
            }}
            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] text-foreground/80 transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <span className="flex w-5 justify-center text-foreground/60">{t.icon(15)}</span>
            <span>{t.label}</span>
          </button>
        ))}

        <div className="mx-1 my-1 h-px bg-white/[0.06]" />

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpenMenu("none");
            onBack();
          }}
          className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] text-foreground/80 transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <span className="flex w-5 justify-center text-foreground/60">
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-8 9 8" />
              <path d="M5 10v10h14V10" />
            </svg>
          </span>
          All projects
        </button>
      </PositionedPortal>
    </header>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-foreground/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
