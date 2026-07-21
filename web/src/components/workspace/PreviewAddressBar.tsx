/**
 * Preview address capsule — the unified URL control in the SidePane toolbar
 * (preview mode). One pill holds everything about the running dev server:
 *
 *   [ ●  ↺   http://localhost:5173          ▾   ↗ ]
 *     │  │   └ editable URL                  │   └ open in system browser
 *     │  └ reload                            └ ports menu (detected first)
 *     └ status dot = Run/Stop toggle (emerald = running)
 *
 * Replaces the old row of separate pills (reload · Ports · url · open) plus a
 * standalone Run/Stop button — collapsing them into a single capsule to
 * de-clutter the toolbar. The dot reflects the M-F dev-server state and
 * doubles as its Run/Stop control; the ▾ menu surfaces M-C/M-D detected ports
 * ahead of the curated presets.
 */
import { useEffect, useRef, useState } from "react";
import { PositionedPortal } from "../ui/PositionedPortal";
import { TerminalGlyph } from "./TerminalGlyph";
import { ProjectBadge, duplicatedInitials } from "./ProjectBadge";
import { normalizeUrl, probeUrl } from "../../lib/preview-url";

interface PortPreset {
  port: number;
  label: string;
}

// Curated dev-server ports, frontend-frequency-first.
const PORT_PRESETS: readonly PortPreset[] = [
  { port: 5173, label: "Vite" },
  { port: 3000, label: "Next.js / Node" },
  { port: 3001, label: "Next.js (alt)" },
  { port: 4321, label: "Astro" },
  { port: 4200, label: "Angular" },
  { port: 8080, label: "Webpack / Vue" },
  { port: 8081, label: "Metro (RN)" },
  { port: 8000, label: "Django / FastAPI" },
  { port: 5000, label: "Flask" },
  { port: 6006, label: "Storybook" },
  { port: 7860, label: "Gradio" },
  { port: 11434, label: "Ollama" },
];

interface Props {
  /** The current raw URL (what the user typed), or "". */
  url: string;
  onSubmit: (normalized: string) => void;
  onReload: () => void;
  /** M-F dev-server state — the status dot doubles as its Run/Stop control. */
  devRunning: boolean;
  devBusy: boolean;
  onToggleDev: () => void;
  /** Detected dev-server URLs (M-C/M-D), listed in the ▾ menu. */
  detectedUrls: readonly string[];
  /** Open projects — folded into the ▾ menu so the app + URL share one
   *  dropdown. Empty/single-project hides the apps section. */
  projects: ReadonlyArray<{ id: string; name: string }>;
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  /** Open the dev-server terminal sheet. In preview mode this lives in the
   *  ports menu (after the detected ports) rather than as a toolbar icon. */
  onOpenTerminal?: () => void;
  /** Open the "Configure dev server" form (command · port · url). */
  onConfigure?: () => void;
}

export function PreviewAddressBar({
  url,
  onSubmit,
  onReload,
  devRunning,
  devBusy,
  onToggleDev,
  detectedUrls,
  projects,
  activeProjectId,
  onSelectProject,
  onOpenTerminal,
  onConfigure,
}: Props) {
  const [draft, setDraft] = useState(url);
  const [menuOpen, setMenuOpen] = useState(false);
  const [checking, setChecking] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const portsBtnRef = useRef<HTMLButtonElement>(null);

  // Keep the draft synced when the URL changes externally (project switch,
  // detection chip, dev-server auto-fill, etc.).
  useEffect(() => setDraft(url), [url]);

  const submit = () => {
    const next = normalizeUrl(draft);
    if (!next) {
      setNotice("Enter a URL or pick a port.");
      return;
    }
    setNotice(null);
    if (next !== url) onSubmit(next);
    else onReload();
  };

  const tryPort = async (port: number) => {
    setNotice(null);
    setChecking(port);
    const candidate = `http://localhost:${port}`;
    const ok = await probeUrl(candidate);
    setChecking(null);
    setMenuOpen(false);
    if (!ok) {
      setNotice(`Nothing listening on :${port}.`);
      return;
    }
    setDraft(candidate);
    onSubmit(candidate);
  };

  // Detected URLs are already known-live, so navigate straight to them.
  const openDetected = (candidate: string) => {
    setNotice(null);
    setMenuOpen(false);
    setDraft(candidate);
    onSubmit(candidate);
  };

  const detected = dedupeDetected(detectedUrls);
  const hasApps = projects.length > 1;
  const currentApp = projects.find((p) => p.id === activeProjectId);
  const dups = duplicatedInitials(projects.map((p) => p.name));

  const selectApp = (id: string) => {
    setMenuOpen(false);
    onSelectProject(id);
  };

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-lg bg-white/[0.025] pl-1.5 pr-1">
        <StatusDot running={devRunning} busy={devBusy} onClick={onToggleDev} />

        <CapsuleButton onClick={onReload} title="Reload" label="Reload preview">
          <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </CapsuleButton>

        <input
          ref={inputRef}
          value={draft}
          placeholder="localhost:3000"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(url);
              inputRef.current?.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[11.5px] text-foreground/80 placeholder:text-foreground/30 focus:outline-none"
        />

        <button
          ref={portsBtnRef}
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          title={
            hasApps && currentApp
              ? `App: ${currentApp.name} · ports`
              : "Dev-server ports"
          }
          aria-label={hasApps ? "App and ports" : "Dev-server ports"}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1 text-foreground/55 transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          {hasApps && currentApp && (
            <ProjectBadge
              name={currentApp.name}
              size={16}
              tinted={dups.has(currentApp.name.charAt(0).toUpperCase())}
            />
          )}
          <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-150 ${menuOpen ? "rotate-180" : ""}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <CapsuleButton
          onClick={() => {
            if (url) window.open(url, "_blank", "noopener");
          }}
          disabled={!url}
          title="Open in system browser"
          label="Open in system browser"
        >
          <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
        </CapsuleButton>
      </div>

      {notice && (
        <span className="absolute -bottom-5 left-9 truncate text-[10px] text-amber-300/80">
          {notice}
        </span>
      )}

      <PositionedPortal
        anchorRef={portsBtnRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        width={216}
        placement="bottom"
        align="right"
        role="menu"
        className="glass flex max-h-80 flex-col gap-0.5 overflow-auto rounded-xl p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.4)]"
      >
        {hasApps && (
          <>
            <MenuLabel>Apps</MenuLabel>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={p.id === activeProjectId}
                onClick={() => selectApp(p.id)}
                className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-foreground/75 transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ProjectBadge
                    name={p.name}
                    size={16}
                    tinted={dups.has(p.name.charAt(0).toUpperCase())}
                  />
                  <span className="truncate">{p.name}</span>
                </span>
                {p.id === activeProjectId && (
                  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-400/80">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </button>
            ))}
            <div className="mx-1 my-1 h-px bg-white/[0.06]" />
          </>
        )}

        {detected.length > 0 && (
          <>
            <MenuLabel>Detected</MenuLabel>
            {detected.map((d) => (
              <button
                key={d.url}
                type="button"
                role="menuitem"
                onClick={() => openDetected(d.url)}
                className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-foreground/75 transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-emerald-400/70" />
                  <span className="truncate">{d.host}</span>
                </span>
                <span className="font-mono text-[10.5px] text-foreground/40">
                  :{d.port}
                </span>
              </button>
            ))}
            <div className="mx-1 my-1 h-px bg-white/[0.06]" />
          </>
        )}

        {/* Dev-server terminal + config — sit after any detected ports. */}
        {(onOpenTerminal || onConfigure) && (
          <>
            {onOpenTerminal && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenTerminal();
                }}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-foreground/75 transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <TerminalGlyph size={13} className="shrink-0 text-foreground/55" />
                <span className="truncate">Dev-server terminal</span>
              </button>
            )}
            {onConfigure && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onConfigure();
                }}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-foreground/75 transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/55">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span className="truncate">Configure dev server…</span>
              </button>
            )}
            <div className="mx-1 my-1 h-px bg-white/[0.06]" />
          </>
        )}

        <MenuLabel>Common ports</MenuLabel>
        {PORT_PRESETS.map((p) => (
          <button
            key={p.port}
            type="button"
            role="menuitem"
            onClick={() => void tryPort(p.port)}
            className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-foreground/75 transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <span>{p.label}</span>
            <span className="font-mono text-[10.5px] text-foreground/40">
              {checking === p.port ? "checking…" : `:${p.port}`}
            </span>
          </button>
        ))}
      </PositionedPortal>
    </div>
  );
}

/** Status dot that doubles as the dev-server Run/Stop toggle. Rests as a dot
 *  (matching the toolbar sketch); hover reveals the action it performs. */
function StatusDot({
  running,
  busy,
  onClick,
}: {
  running: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={busy ? "Working…" : running ? "Stop dev server" : "Run dev server"}
      aria-label={busy ? "Dev server working" : running ? "Stop dev server" : "Run dev server"}
      className="group flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:hover:bg-transparent"
    >
      {busy ? (
        <span className="size-3 animate-spin rounded-full border-[1.5px] border-emerald-300/80 border-t-transparent" />
      ) : running ? (
        <>
          <span className="size-2 rounded-full bg-emerald-400/80 group-hover:hidden" />
          <svg className="hidden size-3 text-rose-300 group-hover:block" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="3" />
          </svg>
        </>
      ) : (
        <>
          <span className="size-2 rounded-full bg-foreground/25 group-hover:hidden" />
          <svg className="hidden size-3 text-emerald-300 group-hover:block" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4l14 8-14 8z" />
          </svg>
        </>
      )}
    </button>
  );
}

/** A ghost icon button sized to sit inside the capsule. */
function CapsuleButton({
  children,
  onClick,
  disabled,
  title,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/55 transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground/55"
    >
      {children}
    </button>
  );
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-0.5 pt-1 text-[9.5px] uppercase tracking-wide text-foreground/35">
      {children}
    </div>
  );
}

/** Unique detected origins (newest-first), each as {url, host, port}. Skips
 *  entries we can't parse, and collapses repeats of the same port. */
function dedupeDetected(
  urls: readonly string[],
): Array<{ url: string; host: string; port: number }> {
  const out: Array<{ url: string; host: string; port: number }> = [];
  const seen = new Set<number>();
  for (let i = urls.length - 1; i >= 0; i--) {
    const raw = urls[i]!;
    try {
      const u = new URL(raw);
      const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
      if (seen.has(port)) continue;
      seen.add(port);
      out.push({ url: raw, host: u.hostname, port });
    } catch {
      // unparseable detection — skip
    }
  }
  return out;
}
