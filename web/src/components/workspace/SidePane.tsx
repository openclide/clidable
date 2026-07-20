import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectFramework } from "@shared/types";
import { PreviewPane, VIEWPORTS, type Viewport } from "./PreviewPane";
import { PreviewAddressBar } from "./PreviewAddressBar";
import { DevTerminalPanel } from "./DevTerminalPanel";
import { CodePane } from "./CodePane";
import { TerminalGlyph } from "./TerminalGlyph";
import type { Project } from "../welcome/data";
import { setActiveWatchedProject } from "../../lib/file-watch-client";
import {
  getStoredPreviewUrl,
  isLoopbackHost,
  resolvePreviewUrl,
  setStoredPreviewUrl,
} from "../../lib/preview-url";
import { useDevServerDetections } from "../../lib/preview-events-client";
import {
  getDevServerStatus,
  startDevServer,
  stopDevServer,
} from "../../lib/projects-client";
import { PositionedPortal } from "../ui/PositionedPortal";

type Mode = "preview" | "code";

const MODES: Array<{ id: Mode; label: string }> = [
  { id: "preview", label: "Preview" },
  { id: "code", label: "Code" },
];

interface SidePaneProps {
  openProjects: Project[];
  previewProjectId: string;
  onPreviewProjectChange: (id: string) => void;
  /** Preview vs Code — lifted to WorkspaceScreen so the top-bar layout menu
   *  and the in-pane Segmented stay in sync. */
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  /** Dev-server terminal sheet — also lifted, so the layout menu can toggle it. */
  termOpen: boolean;
  onTermOpenChange: (open: boolean) => void;
}

/**
 * Right pane: fluid segmented switcher between Preview and Code on the
 * left, Preview-only controls (project · URL · viewport) on the right of
 * the same toolbar row.
 */
export function SidePane({
  openProjects,
  previewProjectId,
  onPreviewProjectChange,
  mode,
  onModeChange,
  termOpen,
  onTermOpenChange,
}: SidePaneProps) {
  const [viewport, setViewport] = useState<Viewport>("Desktop");
  // Raw URL the user typed (per project); the iframe loads the *resolved*
  // form. `nonce` bumps to force a cross-origin-safe reload (remount).
  const [rawUrl, setRawUrl] = useState("");
  const [nonce, setNonce] = useState(0);

  const project =
    openProjects.find((p) => p.id === previewProjectId) ?? openProjects[0];

  // Gate the file watcher to the project the user is actively looking
  // at in the Code pane. When the user is in Preview mode (or has no
  // project open), no WS connections, no fs.watch traffic. On entry
  // / project switch / SidePane re-mount, file-watch-client fires a
  // synthetic active event so the editor + changes + tree all
  // refresh from disk.
  const watchedPath =
    mode === "code" && project ? project.path : null;
  useEffect(() => {
    setActiveWatchedProject(watchedPath);
    return () => {
      // Clear on unmount so a re-mount (e.g. project-close + reopen)
      // doesn't leave a stale active project hanging around.
      setActiveWatchedProject(null);
    };
  }, [watchedPath]);

  // Load the stored preview URL when the previewed project changes.
  const projectId = project?.id ?? null;
  const projectPath = project?.path ?? null;
  useEffect(() => {
    setRawUrl(projectId ? getStoredPreviewUrl(projectId) : "");
  }, [projectId]);

  const handleSubmitUrl = (normalized: string) => {
    setRawUrl(normalized);
    if (projectId) setStoredPreviewUrl(projectId, normalized);
    setNonce((n) => n + 1);
  };
  const handleReload = () => setNonce((n) => n + 1);

  const resolvedUrl = rawUrl ? resolvePreviewUrl(rawUrl) : "";

  // M-C: dev-server URLs detected from terminal output for this project.
  // Keyed by projectPath — the server records detections under the absolute
  // project path, not the UUID. Offer the newest URL not already loaded.
  const detections = useDevServerDetections(projectPath);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  // Reset dismissals on project switch so a URL dismissed in one project
  // doesn't silently suppress the same URL in another.
  useEffect(() => setDismissed(new Set()), [projectPath]);
  // Newest detection that isn't already loaded or dismissed (scan backward, no
  // array copy/reverse per render).
  const suggestion = useMemo(() => {
    for (let i = detections.length - 1; i >= 0; i--) {
      const d = detections[i]!;
      if (d.url !== rawUrl && !dismissed.has(d.url)) return d;
    }
    return null;
  }, [detections, rawUrl, dismissed]);

  // M-F: own-the-spawn dev server. We assign the port, so on start we know
  // the URL and auto-fill the address bar — no detection guessing.
  const [devRunning, setDevRunning] = useState(false);
  const [devBusy, setDevBusy] = useState(false);
  useEffect(() => {
    setDevRunning(false);
    if (!projectPath) return;
    let cancelled = false;
    const framework = project?.framework;
    void (async () => {
      try {
        const status = await getDevServerStatus(projectPath);
        if (cancelled) return;
        if (status.running) {
          setDevRunning(true);
          return;
        }
        // Auto-run on open: start the dev server (a free port we assign) and
        // auto-fill the preview. Once per project per session — so a manual
        // Stop sticks and re-focusing doesn't re-spawn — and only for
        // frameworks we know how to launch (others no-op gracefully).
        if (autoRunAttempted.has(projectPath) || !isAutoRunnable(framework)) {
          return;
        }
        autoRunAttempted.add(projectPath);
        setDevBusy(true);
        try {
          const { url } = await startDevServer(projectPath);
          if (!cancelled) {
            setDevRunning(true);
            handleSubmitUrl(url);
          }
        } catch {
          // No dev script / failed to start — leave the preview empty; the
          // user can still run it manually with the ▶ button.
        } finally {
          if (!cancelled) setDevBusy(false);
        }
      } catch {
        // status fetch failed — ignore
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // Keep the Run/Stop dot truthful. "Running" is now port-based, so a Ctrl-C in
  // the terminal (or a crash) flips the dot without the user touching it. Cheap
  // local check; paused while a Run/Stop transition is in flight.
  useEffect(() => {
    // Only worth polling when there's something to catch going down: the server
    // is running, or the terminal panel is open (where a Ctrl-C can stop it).
    // Idle (stopped + panel closed) → no polling.
    if (!projectPath || (!devRunning && !termOpen)) return;
    const id = setInterval(() => {
      if (devBusy) return;
      void getDevServerStatus(projectPath)
        .then((s) => setDevRunning(s.running))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [projectPath, devBusy, devRunning, termOpen]);

  const toggleDevServer = async () => {
    if (!projectPath) return;
    setDevBusy(true);
    try {
      if (devRunning) {
        await stopDevServer(projectPath);
        setDevRunning(false);
        // The port frees asynchronously (SIGTERM, then SIGKILL ~1.2s later);
        // stay "busy" through that window so the status poll doesn't see the
        // still-listening port and flip the dot back to running.
        await new Promise((r) => setTimeout(r, 1600));
      } else {
        const { url } = await startDevServer(projectPath);
        setDevRunning(true);
        handleSubmitUrl(url); // auto-fill from the port we assigned
      }
    } catch (e) {
      console.error("[sidepane] dev server toggle failed", e);
    } finally {
      setDevBusy(false);
    }
  };

  // Desktop: the code-mode file explorer can be collapsed (toggled from the
  // toolbar, right of the Code button) to give the editor full width.
  const [explorerOpen, setExplorerOpen] = useState(true);

  return (
    <section className="glass relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      {/* One-line toolbar. On mobile the Preview/Code switch is redundant with
          the bottom tab bar, so the segment control is hidden; in code mode the
          whole toolbar is hidden (CodePane shows its own Files/Changes row). */}
      <div
        className={`${
          mode === "code" ? "hidden md:flex" : "flex"
        } shrink-0 items-center gap-2 px-3 pt-3`}
      >
        <div className="hidden md:contents">
          <Segmented value={mode} onChange={onModeChange} />
        </div>

        {/* Collapse/expand the code-mode file explorer — grouped just right of
            the Code button. (Toolbar hidden on mobile, where the explorer is a
            slide-over drawer.) */}
        {mode === "code" && (
          <ExplorerToggle
            open={explorerOpen}
            onClick={() => setExplorerOpen((v) => !v)}
          />
        )}

        {/* Preview-only controls — flex-1 in preview; removed from layout in
            code mode so the terminal toggle can pin to the far right. */}
        <div
          aria-hidden={mode !== "preview"}
          className={`
            ml-2 flex flex-1 items-center gap-2
            ${mode === "preview" ? "opacity-100" : "hidden"}
          `}
        >
          <PreviewAddressBar
            url={rawUrl}
            onSubmit={handleSubmitUrl}
            onReload={handleReload}
            devRunning={devRunning}
            devBusy={devBusy}
            onToggleDev={() => void toggleDevServer()}
            detectedUrls={detections.map((d) => d.url)}
            projects={openProjects}
            activeProjectId={previewProjectId}
            onSelectProject={onPreviewProjectChange}
            onOpenTerminal={projectPath ? () => onTermOpenChange(true) : undefined}
          />
          <ViewportSwitcher value={viewport} onChange={setViewport} />
        </div>

        {/* Dev-server terminal toggle — pinned to the far right in code mode
            (the preview controls are hidden there, so ml-auto sticks it to the
            edge). In Preview it's surfaced inside the ports menu instead. */}
        {projectPath && mode === "code" && (
          <TerminalToggle
            className="ml-auto"
            open={termOpen}
            onClick={() => onTermOpenChange(!termOpen)}
          />
        )}
      </div>

      {/* Tab content cross-fades. In mobile code mode the toolbar above is
          hidden, so add the top padding it used to provide — otherwise
          CodePane's chrome row butts against the card's rounded corner and the
          overflow-hidden clips it. */}
      <div
        className={`relative mt-2 min-h-0 flex-1 ${
          mode === "code" ? "pt-3 md:pt-0" : ""
        }`}
      >
        <div
          aria-hidden={mode !== "preview"}
          // Marks the region the desktop screenshot captures — only
          // while preview is the visible tab, so we never grab the
          // cross-faded/hidden pane. Kept in sync with
          // SCREENSHOT_TARGET_ATTR in lib/screenshot.ts.
          data-screenshot-target={mode === "preview" ? "" : undefined}
          className={`
            absolute inset-0
            transition-opacity duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
            ${mode === "preview" ? "opacity-100" : "pointer-events-none opacity-0"}
          `}
        >
          <PreviewPane
            url={resolvedUrl}
            visible={mode === "preview"}
            viewport={viewport}
            nonce={nonce}
            external={isExternalUrl(rawUrl)}
            onReload={handleReload}
          />

          {/* Detected dev-server chip (M-C). Dismissible; never auto-hijacks. */}
          {suggestion && mode === "preview" && (
            <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/[0.1] bg-black/65 px-3 py-1.5 text-[11.5px] text-foreground/85 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-md">
                <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />
                <span>Dev server on {portLabel(suggestion.url)}</span>
                <button
                  type="button"
                  onClick={() => handleSubmitUrl(suggestion.url)}
                  className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-white/20"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDismissed((s) => new Set(s).add(suggestion.url))
                  }
                  aria-label="Dismiss"
                  className="flex size-4 items-center justify-center rounded text-foreground/40 transition-colors hover:text-foreground"
                >
                  <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
        <div
          aria-hidden={mode !== "code"}
          className={`
            absolute inset-0
            transition-opacity duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
            ${mode === "code" ? "opacity-100" : "pointer-events-none opacity-0"}
          `}
        >
          {project ? (
            <CodePane
              project={project}
              explorerOpen={explorerOpen}
              termOpen={termOpen}
              onToggleTerminal={() => onTermOpenChange(!termOpen)}
            />
          ) : null}
        </div>
      </div>

      {/* Dev-server terminal — a non-modal bottom sheet that slides up over the
          lower part of the preview/code, leaving the top visible + interactive. */}
      {termOpen && projectPath && (
        <BottomSheet>
          <DevTerminalPanel
            projectPath={projectPath}
            onClose={() => onTermOpenChange(false)}
          />
        </BottomSheet>
      )}
    </section>
  );
}

function Segmented({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const activeIndex = MODES.findIndex((m) => m.id === value);
  // The indicator width is one Nth of the (padded) track — `4px` is the
  // sum of the rail's left + right padding so the indicator's edges
  // sit flush with the buttons' edges at each step.
  const sliceWidth = `calc((100% - 4px) / ${MODES.length})`;
  return (
    <div className="relative flex h-7 shrink-0 items-center rounded-xl bg-white/[0.025] p-0.5">
      <span
        aria-hidden
        className="
          absolute inset-y-0.5 rounded-lg
          bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]
          transition-transform duration-250 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        "
        style={{
          left: 2,
          width: sliceWidth,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          className={`
            relative z-[1] flex h-full min-w-[64px] items-center justify-center
            rounded-lg px-3 text-[12px] tracking-tight
            transition-colors duration-200
            ${m.id === value ? "text-foreground" : "text-foreground/55 hover:text-foreground/85"}
          `}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// Projects we've already attempted to auto-run this session — kept at module
// scope so it survives SidePane re-mounts and so a manual Stop isn't
// immediately undone by re-focusing the project.
const autoRunAttempted = new Set<string>();

// Frameworks the server's dev-server knows how to launch (mirrors devPlan).
// Other projects (python/rust/go/expo/unknown — or no dev script) skip
// auto-run; the ▶ button is still available.
const AUTO_RUNNABLE: ReadonlySet<ProjectFramework> = new Set([
  "nextjs",
  "vite",
  "sveltekit",
  "astro",
  "nuxt",
  "remix",
  "hono",
  "node",
]);

function isAutoRunnable(framework: ProjectFramework | undefined): boolean {
  return framework !== undefined && AUTO_RUNNABLE.has(framework);
}

/** True when the entered URL points at a non-loopback (external) origin —
 *  drives the iframe's X-Frame-Options hint. */
function isExternalUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    return !isLoopbackHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/** ":5173" from a detected URL; falls back to the raw string. */
function portLabel(url: string): string {
  try {
    const p = new URL(url).port;
    return p ? `:${p}` : url;
  } catch {
    return url;
  }
}

function ViewportSwitcher({
  value,
  onChange,
}: {
  value: Viewport;
  onChange: (v: Viewport) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  // Collapsed to a single dropdown (current device icon + chevron) instead of
  // a 3-icon segmented control — responsive preview is an occasional action,
  // so it doesn't earn three permanent slots in the toolbar.
  return (
    <div className="relative shrink-0">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Viewport: ${value}`}
        aria-label={`Viewport: ${value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="
          flex h-7 items-center gap-1 rounded-xl
          bg-white/[0.025] px-2
          text-foreground/65
          transition-[background-color,color] duration-150
          hover:bg-white/[0.05] hover:text-foreground
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        "
      >
        <ViewportIcon v={value} />
        <svg
          viewBox="0 0 24 24"
          width={9}
          height={9}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-foreground/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <PositionedPortal
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        width={150}
        placement="bottom"
        align="right"
        role="menu"
        className="
          glass flex flex-col gap-0.5 rounded-xl p-1.5
          shadow-[0_18px_40px_rgba(0,0,0,0.4)]
        "
      >
        {VIEWPORTS.map((v) => (
          <button
            key={v}
            type="button"
            role="menuitemradio"
            aria-checked={v === value}
            onClick={() => {
              onChange(v);
              setOpen(false);
            }}
            className={`
              flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left
              text-[12px] transition-colors
              ${
                v === value
                  ? "bg-white/[0.06] text-foreground"
                  : "text-foreground/70 hover:bg-white/[0.05] hover:text-foreground"
              }
            `}
          >
            <span className="flex w-4 justify-center">
              <ViewportIcon v={v} />
            </span>
            <span className="flex-1">{v}</span>
            {v === value && (
              <svg
                viewBox="0 0 24 24"
                width={12}
                height={12}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-emerald-400/80"
              >
                <path d="M5 12l5 5L20 7" />
              </svg>
            )}
          </button>
        ))}
      </PositionedPortal>
    </div>
  );
}

/**
 * Non-modal bottom sheet: an elevated panel pinned to the bottom of the pane
 * that slides up *over* the content (the section is `relative` + clips to its
 * rounded corners). Non-modal — the visible top of the content stays
 * interactive (no backdrop). Animates in on mount.
 */
function BottomSheet({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <div
      className={`
        absolute inset-x-0 bottom-0 z-20 flex h-[56%] min-h-[200px] flex-col
        overflow-hidden rounded-t-2xl border-t border-white/10
        bg-[#0b0b0f]/92 shadow-[0_-18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl
        transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        ${shown ? "translate-y-0" : "translate-y-full"}
      `}
    >
      <div className="flex shrink-0 justify-center pt-1.5">
        <span aria-hidden className="h-1 w-9 rounded-full bg-white/15" />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** Toolbar toggle for collapsing the code-mode file explorer (desktop). */
function ExplorerToggle({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open}
      title={open ? "Hide file explorer" : "Show file explorer"}
      aria-label={open ? "Hide file explorer" : "Show file explorer"}
      className={`flex size-7 shrink-0 items-center justify-center rounded-xl transition-colors duration-150 ${
        open
          ? "bg-white/[0.1] text-foreground"
          : "bg-white/[0.025] text-foreground/55 hover:bg-white/[0.05] hover:text-foreground"
      }`}
    >
      <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <line x1="9" y1="4.5" x2="9" y2="19.5" />
      </svg>
    </button>
  );
}

/** Toolbar toggle for the dev-server terminal bottom sheet. */
function TerminalToggle({
  open,
  onClick,
  className = "",
}: {
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={open ? "Hide dev-server terminal" : "Show dev-server terminal"}
      aria-label={open ? "Hide dev-server terminal" : "Show dev-server terminal"}
      aria-pressed={open}
      className={`flex size-7 shrink-0 items-center justify-center rounded-xl transition-colors duration-150 ${className} ${
        open
          ? "bg-white/[0.1] text-foreground"
          : "bg-white/[0.025] text-foreground/55 hover:bg-white/[0.05] hover:text-foreground"
      }`}
    >
      <TerminalGlyph />
    </button>
  );
}

function ViewportIcon({ v }: { v: Viewport }) {
  if (v === "Desktop") {
    return (
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="5" width="19" height="11.5" rx="1.6" />
        <path d="M9 20h6M12 16.5v3.5" />
      </svg>
    );
  }
  if (v === "Tablet") {
    return (
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="3" width="12" height="18" rx="1.8" />
        <path d="M12 18.2h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="3" width="8" height="18" rx="1.8" />
      <path d="M11 18h2" />
    </svg>
  );
}
