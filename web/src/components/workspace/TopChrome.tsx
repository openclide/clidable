import { useRef, useState, type ReactNode } from "react";
import type { Project } from "../welcome/data";
import { WorkspaceTools, type WorkspaceTool } from "./WorkspaceTools";
import { ProjectTabs } from "./ProjectTabs";
import { AddProjectMenu } from "./AddProjectMenu";
import { PositionedPortal } from "../ui/PositionedPortal";
import { TerminalGlyph } from "./TerminalGlyph";
import { isTauri, hasMacTrafficLights } from "../../lib/shell";

type PreviewMode = "preview" | "code";

interface Props {
  openProjects: Project[];
  activeProjectId: string;
  /** Preview width as a % of the workspace row (0 = hidden, 100 = full). */
  previewPct: number;
  /** Side-pane view when it's visible. */
  previewMode: PreviewMode;
  onSelectProject: (id: string) => void;
  onCloseProject: (id: string) => void;
  onAddProject: (project: Project) => void;
  /** Show the side pane in this view (re-selecting the active view hides it). */
  onSelectView: (mode: PreviewMode) => void;
  /** Toggle the terminal/agents pane. */
  onToggleAgents: () => void;
  /** Set the preview's split width (%). */
  onSetPreviewSize: (pct: number) => void;
  /** Dev-server terminal sheet state + toggle (also reachable from the layout menu). */
  termOpen: boolean;
  onToggleTerminal: () => void;
  /** Terminal dock (roster of all terminals) visibility + toggle. */
  dockVisible: boolean;
  onToggleDock: () => void;
  onBack: () => void;
  onOpenTool?: (tool: WorkspaceTool) => void;
}

/**
 * Floating chrome at the very top of the workspace. macOS traffic lights
 * sit at the top-left so we leave room (pl-24). Layout: home chip,
 * project tabs strip, then on the right — workspace tools, then the
 * layout menu (which panes show + the split width).
 */
export function TopChrome({
  openProjects,
  activeProjectId,
  previewPct,
  previewMode,
  onSelectProject,
  onCloseProject,
  onAddProject,
  onSelectView,
  onToggleAgents,
  onSetPreviewSize,
  termOpen,
  onToggleTerminal,
  dockVisible,
  onToggleDock,
  onBack,
  onOpenTool,
}: Props) {
  const dragProps = isTauri() ? { "data-tauri-drag-region": true } : {};
  // Only reserve the top-left strip when macOS overlay traffic lights are
  // actually there — on web (and Windows/Linux) the space would just be dead.
  const trafficLightPad = hasMacTrafficLights();

  const [addOpen, setAddOpen] = useState(false);
  const addAnchorRef = useRef<HTMLDivElement>(null);

  return (
    <header
      {...dragProps}
      className={`flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-3 ${trafficLightPad ? "pl-24" : ""}`}
    >
      {/* Home → back to welcome / project picker */}
      <button
        type="button"
        onClick={onBack}
        title="All projects"
        aria-label="All projects"
        className="
          glass group flex size-7 items-center justify-center rounded-xl
          text-foreground/65
          transition-[color,border-color,transform] duration-150
          hover:-translate-y-px hover:border-white/[0.18] hover:text-foreground
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        "
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h14V10" />
        </svg>
      </button>

      {/* Project tabs + add */}
      <div ref={addAnchorRef} className="relative flex min-w-0 flex-1 items-center">
        <ProjectTabs
          projects={openProjects}
          activeId={activeProjectId}
          onSelect={onSelectProject}
          onClose={onCloseProject}
          onAdd={() => setAddOpen((o) => !o)}
        />
        {addOpen && (
          <AddProjectMenu
            excludeIds={openProjects.map((p) => p.id)}
            onPick={(p) => onAddProject(p)}
            onClose={() => setAddOpen(false)}
            anchorRef={addAnchorRef}
          />
        )}
      </div>

      {/* Right cluster: workspace tools · layout menu */}
      <WorkspaceTools onOpen={onOpenTool} />

      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-white/[0.08]" />

      <LayoutMenu
        previewPct={previewPct}
        previewMode={previewMode}
        onSelectView={onSelectView}
        onToggleAgents={onToggleAgents}
        onSetPreviewSize={onSetPreviewSize}
        termOpen={termOpen}
        onToggleTerminal={onToggleTerminal}
        dockVisible={dockVisible}
        onToggleDock={onToggleDock}
      />
    </header>
  );
}

const SIZE_PRESETS: ReadonlyArray<{ label: string; pct: number }> = [
  { label: "⅓", pct: 100 / 3 },
  { label: "½", pct: 50 },
  { label: "⅔", pct: 200 / 3 },
];

/**
 * Layout menu — a panel-glyph button (right pane fills when the preview is
 * visible) opening a dropdown that toggles which panes show and sets the
 * split width.
 */
function LayoutMenu({
  previewPct,
  previewMode,
  onSelectView,
  onToggleAgents,
  onSetPreviewSize,
  termOpen,
  onToggleTerminal,
  dockVisible,
  onToggleDock,
}: {
  previewPct: number;
  previewMode: PreviewMode;
  onSelectView: (mode: PreviewMode) => void;
  onToggleAgents: () => void;
  onSetPreviewSize: (pct: number) => void;
  termOpen: boolean;
  onToggleTerminal: () => void;
  dockVisible: boolean;
  onToggleDock: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const sidePaneVisible = previewPct > 0;
  const agentsVisible = previewPct < 100;
  const bothVisible = sidePaneVisible && agentsVisible;
  const activeSize = bothVisible
    ? SIZE_PRESETS.find((s) => Math.abs(s.pct - previewPct) <= 6)?.pct ?? null
    : null;

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Layout"
        aria-label="Layout menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`
          glass flex h-7 items-center gap-0.5 rounded-xl px-1.5
          transition-[color,border-color,background-color,transform] duration-150
          hover:-translate-y-px hover:border-white/[0.18]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
          ${sidePaneVisible ? "text-foreground/85" : "text-foreground/45"}
        `}
      >
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
          <line x1="14" y1="4.5" x2="14" y2="19.5" />
          {sidePaneVisible && (
            <rect x="15" y="6" width="4.5" height="12" rx="1" fill="currentColor" stroke="none" />
          )}
        </svg>
        <svg viewBox="0 0 24 24" width={9} height={9} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={`text-foreground/45 transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <PositionedPortal
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        width={216}
        placement="bottom"
        align="right"
        role="menu"
        className="glass flex flex-col gap-0.5 rounded-xl p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.4)]"
      >
        <MenuRow
          label="Agents"
          checked={agentsVisible}
          onClick={onToggleAgents}
          icon={
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 8l3.5 3.5L5 15" />
              <path d="M12 16h6" />
            </svg>
          }
        />
        <MenuRow
          label="Preview"
          checked={sidePaneVisible && previewMode === "preview"}
          onClick={() => onSelectView("preview")}
          icon={
            <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          }
        />
        <MenuRow
          label="Code"
          checked={sidePaneVisible && previewMode === "code"}
          onClick={() => onSelectView("code")}
          icon={
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
            </svg>
          }
        />
        <MenuRow
          label="Dev-server terminal"
          checked={termOpen}
          onClick={onToggleTerminal}
          icon={<TerminalGlyph />}
        />
        <MenuRow
          label="Terminal dock"
          checked={dockVisible}
          onClick={onToggleDock}
          icon={
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
              <line x1="3" y1="15" x2="21" y2="15" />
            </svg>
          }
        />

        <div className="mx-1 my-1 h-px bg-white/[0.06]" />

        <div className="px-2 pb-0.5 pt-0.5 text-[9.5px] uppercase tracking-wide text-foreground/35">
          Preview width
        </div>
        <div className="flex gap-1 px-1 pb-0.5">
          {SIZE_PRESETS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onSetPreviewSize(s.pct)}
              title={`Preview ${s.label}`}
              aria-label={`Preview width ${s.label}`}
              aria-pressed={activeSize === s.pct}
              className={`flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors ${
                activeSize === s.pct
                  ? "bg-white/[0.12] text-foreground"
                  : "text-foreground/55 hover:bg-white/[0.05] hover:text-foreground"
              }`}
            >
              <SplitIcon fraction={s.pct / 100} />
            </button>
          ))}
        </div>
      </PositionedPortal>
    </div>
  );
}

/** A panel split at the given preview fraction — the right (preview) pane is
 *  filled, the left (terminal) pane is empty. fraction ∈ (0,1). */
function SplitIcon({ fraction }: { fraction: number }) {
  const x0 = 3;
  const x1 = 21;
  const y0 = 5.5;
  const y1 = 18.5;
  const divX = x0 + (x1 - x0) * (1 - fraction);
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx="2.5" />
      <line x1={divX} y1={y0} x2={divX} y2={y1} />
      <rect
        x={divX + 1}
        y={y0 + 1.6}
        width={x1 - 1 - (divX + 1)}
        height={y1 - y0 - 3.2}
        rx="1.2"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

function MenuRow({
  icon,
  label,
  checked,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-foreground/80 transition-colors hover:bg-white/[0.06] hover:text-foreground"
    >
      <span className="flex w-4 justify-center text-foreground/55">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="flex w-4 justify-center text-foreground/70">
        {checked && (
          <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        )}
      </span>
    </button>
  );
}
