/**
 * Universal folder picker. Browses the *server's* filesystem via
 * `/api/fs/browse`, so it works in every shell (Tauri desktop, plain browser,
 * remote/server mode) — the project folder always lives on the host that runs
 * Clidable, never the client. No native dialog plugin required.
 *
 * Navigation: click a sub-folder to descend, ↑ to go to the parent, ⌂ to jump
 * home. "Open this folder" picks the directory currently shown.
 */
import { useEffect, useState } from "react";
import type { FsBrowseResponse } from "@shared/types";
import { browseDir } from "../../lib/fs-browse-client";
import { Modal } from "../ui/Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen absolute directory path. */
  onPick: (path: string) => void;
  /** True while the caller is opening the chosen folder (disables actions). */
  busy?: boolean;
}

export function FolderPickerModal({ open, onClose, onPick, busy }: Props) {
  const [view, setView] = useState<FsBrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Re)load from home each time the modal opens.
  useEffect(() => {
    if (!open) {
      setView(null);
      setError(null);
      return;
    }
    void navigate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function navigate(path: string | undefined) {
    setLoading(true);
    setError(null);
    try {
      setView(await browseDir(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="md"
      title="Open a folder"
    >
      <div className="flex flex-col gap-3">
        {/* Path bar + up/home controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => view?.parent && navigate(view.parent)}
            disabled={!view?.parent || loading}
            title="Parent folder"
            aria-label="Parent folder"
            className="
              flex size-7 shrink-0 items-center justify-center rounded-md
              border border-white/[0.08] bg-white/[0.03] text-foreground/60
              transition-colors hover:bg-white/[0.08] hover:text-foreground
              disabled:opacity-40 disabled:hover:bg-white/[0.03]
            "
          >
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => navigate(view?.home)}
            disabled={loading}
            title="Home folder"
            aria-label="Home folder"
            className="
              flex size-7 shrink-0 items-center justify-center rounded-md
              border border-white/[0.08] bg-white/[0.03] text-foreground/60
              transition-colors hover:bg-white/[0.08] hover:text-foreground
              disabled:opacity-40
            "
          >
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-8 9 8M5 10v10h14V10" />
            </svg>
          </button>
          <div className="min-w-0 flex-1 truncate rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11px] text-foreground/70">
            {view?.path ?? "…"}
          </div>
        </div>

        {/* Directory list */}
        <div className="h-64 overflow-auto rounded-lg border border-white/[0.06] bg-white/[0.015] p-1">
          {error ? (
            <p className="px-2 py-6 text-center text-[11.5px] text-rose-400/80">
              {error}
            </p>
          ) : loading && !view ? (
            <p className="px-2 py-6 text-center text-[11.5px] text-foreground/40">
              Loading…
            </p>
          ) : view && view.dirs.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11.5px] italic text-foreground/40">
              No sub-folders here.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {view?.dirs.map((d) => (
                <li key={d.path}>
                  <button
                    type="button"
                    onClick={() => navigate(d.path)}
                    disabled={loading}
                    className="
                      flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left
                      transition-colors hover:bg-white/[0.05]
                      focus:outline-none focus-visible:bg-white/[0.05]
                    "
                  >
                    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/45">
                      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                    </svg>
                    <span className="truncate text-[12.5px] text-foreground/80">
                      {d.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="
              rounded-lg px-3 py-1.5 text-[12px] text-foreground/60
              transition-colors hover:text-foreground disabled:opacity-40
            "
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => view && onPick(view.path)}
            disabled={!view || busy}
            className="
              rounded-lg border border-white/[0.12] bg-white/[0.06]
              px-3 py-1.5 text-[12px] font-medium text-foreground
              transition-colors hover:bg-white/[0.1]
              disabled:opacity-40 disabled:hover:bg-white/[0.06]
            "
          >
            {busy ? "Opening…" : "Open this folder"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
