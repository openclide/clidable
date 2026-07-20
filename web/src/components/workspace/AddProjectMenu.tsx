import { useEffect, useRef, useState } from "react";
import { relativeTime, type Project } from "../welcome/data";
import { openProject, useProjects } from "../../lib/projects-client";
import { FolderPickerModal } from "./FolderPickerModal";
import { NewProjectModal } from "../welcome/NewProjectModal";

interface Props {
  excludeIds: string[];
  onPick: (project: Project) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

/**
 * Popover for adding a project to this window. Lists recent projects not
 * already open, plus an "Open a folder…" action that registers a new one via
 * the universal folder picker. Anchored beneath the `+` button.
 */
export function AddProjectMenu({ excludeIds, onPick, onClose, anchorRef }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { projects } = useProjects();
  const available = projects.filter((p) => !excludeIds.includes(p.id));

  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Outside-click / Escape dismissal — suspended while the folder picker is
  // open (its modal portals to <body>, so a click inside it would otherwise
  // read as "outside" and close this popover, unmounting the modal).
  useEffect(() => {
    // Both portal to <body>; a click inside them would otherwise read as
    // "outside" this popover and close it (unmounting the modal mid-flow).
    if (pickerOpen || createOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose, pickerOpen, createOpen]);

  async function handlePickFolder(path: string) {
    setBusy(true);
    setError(null);
    try {
      const project = await openProject(path);
      onPick(project);
      setPickerOpen(false);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        ref={ref}
        role="menu"
        className="
          glass absolute top-[calc(100%+6px)] z-50
          flex w-[260px] flex-col gap-0.5 rounded-xl p-1.5
          shadow-[0_18px_40px_rgba(0,0,0,0.4)]
        "
      >
        {available.length === 0 ? (
          <p className="px-3 py-3 text-center text-[11.5px] text-foreground/45">
            No other recent projects.
          </p>
        ) : (
          available.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(p);
                onClose();
              }}
              className="
                group flex items-center gap-2 rounded-lg
                px-2.5 py-1.5 text-left
                transition-[background-color,color] duration-150
                hover:bg-white/[0.06]
                focus:outline-none focus-visible:bg-white/[0.06]
              "
            >
              <span
                className="
                  flex size-7 shrink-0 items-center justify-center rounded-lg
                  border border-white/[0.08] bg-white/[0.03]
                  text-foreground/55
                "
                aria-hidden
              >
                <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground/85">
                  {p.name}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-foreground/35">
                  {p.path}
                </span>
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-foreground/30">
                {relativeTime(p.lastOpenedAt)}
              </span>
            </button>
          ))
        )}

        <div className="my-1 h-px bg-white/[0.06]" />

        <button
          type="button"
          role="menuitem"
          onClick={() => setPickerOpen(true)}
          className="
            flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left
            text-[12px] font-medium text-foreground/80
            transition-[background-color,color] duration-150
            hover:bg-white/[0.06] hover:text-foreground
            focus:outline-none focus-visible:bg-white/[0.06]
          "
        >
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-foreground/55"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          </span>
          Open a folder…
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => setCreateOpen(true)}
          className="
            flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left
            text-[12px] font-medium text-foreground/80
            transition-[background-color,color] duration-150
            hover:bg-white/[0.06] hover:text-foreground
            focus:outline-none focus-visible:bg-white/[0.06]
          "
        >
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/[0.14] text-foreground/55"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          Create a project
        </button>

        {error && (
          <p className="px-3 py-1 text-[10.5px] text-rose-400/80">{error}</p>
        )}
      </div>

      <FolderPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePickFolder}
        busy={busy}
      />

      {/* Scaffold a new project, then add it to this window. Defaults to the
          Claude agent — the user can switch in the composer afterward. */}
      <NewProjectModal
        agentId={createOpen ? "claude" : null}
        onClose={() => setCreateOpen(false)}
        onCreated={(project) => {
          setCreateOpen(false);
          onPick(project);
          onClose();
        }}
      />
    </>
  );
}
