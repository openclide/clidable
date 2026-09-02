/**
 * Universal folder picker. Browses the *server's* filesystem via
 * `/api/fs/browse`, so it works in every shell (Tauri desktop, plain browser,
 * remote/server mode) — the project folder always lives on the host that runs
 * Clidable, never the client. No native dialog plugin required.
 *
 * Navigation: click a sub-folder to descend, ↑ for the parent, ⌂ for home, or
 * type a path in the bar and press Enter. On Windows with more than one drive
 * mounted, a row of drive chips is shown too — every root is its own tree
 * there, so walking up from C:\ can never reach D:\. "Open this folder" picks
 * the directory shown, submitting any typed path first.
 */
import { useEffect, useRef, useState } from "react";
import type { FsBrowseResponse } from "@shared/types";
import { browseDir } from "../../lib/fs-browse-client";
import { resolveTypedPath } from "../../lib/path-input";
import { Modal } from "../ui/Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen absolute directory path. */
  onPick: (path: string) => void;
  /** True while the caller is opening the chosen folder (disables actions). */
  busy?: boolean;
  /**
   * Directory to open at. Use it when the caller already shows a path the user
   * is about to change — reopening somewhere else makes them navigate back to
   * where they already were. Omitted → the server's default (the launch dir,
   * falling back to home).
   */
  initialPath?: string | null;
}

export function FolderPickerModal({ open, onClose, onPick, busy, initialPath }: Props) {
  const [view, setView] = useState<FsBrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Typed path, or null when the field just mirrors where we are. Survives a
   *  FAILED navigation so a typo can be corrected rather than retyped. */
  const [draft, setDraft] = useState<string | null>(null);

  /**
   * Monotonic id of the newest navigation. Anything older that finishes late is
   * DISCARDED: the input can be submitted while a slow browse is still in
   * flight, so without this a 1.5s network-share response could land after the
   * user's newer request and silently drag them back, erasing what they typed.
   * Also bumped on close, so a late response can't repopulate a shut modal.
   */
  const nav = useRef(0);

  /** The typed path resolved against where we are, or null if unusable. */
  function pendingTarget(): string | null {
    return draft === null ? null : resolveTypedPath(draft, { currentDir: view?.path, home: view?.home });
  }

  function submitPath(): void {
    const target = pendingTarget();
    if (target) void navigate(target);
  }

  // (Re)load each time the modal opens: at the caller's current path when it
  // has one, else the server default.
  useEffect(() => {
    if (!open) {
      nav.current += 1; // abandon any in-flight browse
      setView(null);
      setError(null);
      setDraft(null);
      setLoading(false);
      return;
    }
    void navigate(initialPath ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function navigate(path: string | undefined) {
    const id = ++nav.current;
    setLoading(true);
    setError(null);
    try {
      const next = await browseDir(path);
      if (id !== nav.current) return; // superseded
      setView(next);
      // Cleared HERE, not in an effect keyed on view.path: a navigation can
      // succeed and land on the same path (a trailing slash, "~" while already
      // home), which would leave the typed text sitting over a stale location.
      setDraft(null);
    } catch (e) {
      if (id !== nav.current) return;
      setError((e as Error).message);
    } finally {
      if (id === nav.current) setLoading(false);
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
          {/*
            Editable, not a label. Clicking through a tree is fine for nearby
            folders and terrible for a path you already know — and on Windows it
            was the only way to reach a drive the picker couldn't walk to.
            Enter navigates, Escape reverts.
          */}
          <input
            type="text"
            value={draft ?? view?.path ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitPath();
              } else if (e.key === "Escape" && draft !== null) {
                // Escape in a dirty field means "undo my typing", not "close the
                // dialog". Modal is a native <dialog>, where Escape is a close
                // REQUEST — cancelable only by preventDefault(); stopPropagation
                // alone lets the dialog close and lose the user's place.
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
              }
            }}
            onFocus={(e) => e.currentTarget.select()}
            // NOT disabled while loading: disabling a focused input blurs it, so
            // a failed navigation would drop the caret and the very draft we
            // keep for correcting the typo. Submitting mid-load is harmless.
            readOnly={loading}
            spellCheck={false}
            autoComplete="off"
            aria-label="Folder path — type one and press Enter"
            placeholder="Type a path and press Enter"
            className="
              min-w-0 flex-1 truncate rounded-md border border-white/[0.06]
              bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11px] text-foreground/70
              outline-none transition-colors
              placeholder:text-foreground/30
              focus:border-accent/40 focus:bg-white/[0.04] focus:text-foreground
              read-only:opacity-60
            "
          />
        </div>

        {/*
          Drive switcher — Windows only; the server sends an empty list on
          macOS/Linux, where `/` already reaches everything. Without it a drive
          other than the one Clidable started on is unreachable: ↑ dead-ends at
          the drive root and no directory lists the other drives.
        */}
        {view && view.drives.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {view.drives.map((d) => {
              const active = view.path.slice(0, 3).toUpperCase() === d.toUpperCase();
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => navigate(d)}
                  disabled={loading}
                  title={`Browse ${d}`}
                  aria-current={active ? "true" : undefined}
                  className={`
                    rounded-md border px-2 py-1 font-mono text-[11px] transition-colors
                    disabled:opacity-40
                    ${
                      active
                        ? "border-accent/40 bg-accent/15 text-foreground"
                        : "border-white/[0.08] bg-white/[0.03] text-foreground/60 hover:bg-white/[0.08] hover:text-foreground"
                    }
                  `}
                >
                  {d.replace(/\\$/, "")}
                </button>
              );
            })}
          </div>
        )}

        {/*
          Error sits ABOVE the list, not instead of it: a typo in the path bar
          shouldn't wipe the folder listing the user was browsing. Only shown
          here when there IS a listing to preserve — otherwise the empty-state
          below renders it.
        */}
        {view && error && (
          <p role="alert" className="px-0.5 text-[11.5px] text-rose-400/80">
            {error}
          </p>
        )}

        {/* Directory list */}
        <div className="h-64 overflow-auto rounded-lg border border-white/[0.06] bg-white/[0.015] p-1">
          {!view && error ? (
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
            // A typed-but-unsubmitted path is VISIBLE in the bar; opening
            // view.path would silently open a different folder than the one on
            // screen. Go there first — the label says so, and the user sees
            // where they landed before anything opens. An unusable draft (blank,
            // or all whitespace) is discarded instead of making this a no-op.
            onClick={() => {
              const target = pendingTarget();
              if (target) void navigate(target);
              else if (draft !== null) setDraft(null);
              else if (view) onPick(view.path);
            }}
            disabled={!view || busy}
            className="
              rounded-lg border border-white/[0.12] bg-white/[0.06]
              px-3 py-1.5 text-[12px] font-medium text-foreground
              transition-colors hover:bg-white/[0.1]
              disabled:opacity-40 disabled:hover:bg-white/[0.06]
            "
          >
            {busy ? "Opening…" : pendingTarget() ? "Go" : "Open this folder"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
