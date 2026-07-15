/**
 * Single-file CodeMirror 6 editor. M1 surface — vim, autocomplete, theme
 * picker, and per-hunk diff controls are deferred. What ships here:
 *
 *   • Read + edit + ⌘S save against `/api/fs/{read,write}`.
 *   • Lazy language pack loaded on the first open of a given extension.
 *   • VS Code keymap for muscle memory (Cmd-X cuts a whole line, etc.).
 *   • Sensible failure modes (binary / too-large / network error) — the
 *     pane stays mounted and shows the reason instead of going blank.
 *
 * Extensions live in a `useMemo([])` so their array identity is stable
 * — @uiw/react-codemirror reconfigures the whole state when extensions
 * change identity, which would wipe undo history and scroll position
 * on every keystroke.
 */
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { redo, undo } from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";
import {
  buildSharedExtensions,
  languageCompartment,
} from "../../lib/code-mirror/extensions";
import { resolveLanguage } from "../../lib/code-mirror/language-resolver";
import { useDocument } from "../../lib/code-mirror/use-document";

export interface EditorPaneHandle {
  setQuery: (q: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearQuery: () => void;
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  /** Re-read the file from disk. Skips silently if the buffer is dirty. */
  reload: () => boolean;
  undo: () => void;
  redo: () => void;
}

interface Props {
  /** Absolute (or cwd-relative) project root passed to `/api/fs/*`. */
  root: string;
  /** File path relative to `root`. */
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  /** Fired on ⌘W. The parent owns the "discard unsaved?" prompt. */
  onClose?: () => void;
  /** Optional ref to expose the imperative handle. */
  handleRef?: (handle: EditorPaneHandle | null) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function EditorPane({
  root,
  path,
  onDirtyChange,
  onSaved,
  onClose,
  handleRef,
}: Props) {
  const { doc, onChange, save, reload } = useDocument({
    root,
    path,
    onDirtyChange,
  });

  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // Stabilize save / onSaved via refs — extensions are built once
  // (useMemo([])), so the keymap action must dereference current values
  // instead of capturing stale ones.
  const saveRef = useRef(save);
  saveRef.current = save;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pathRef = useRef(path);
  pathRef.current = path;

  const extensions = useMemo<Extension[]>(
    () => [
      ...buildSharedExtensions(),
      languageCompartment.of([]),
      // VS Code keymap at high precedence so it wins over basicSetup's
      // defaults for shared bindings (Cmd-D selection, line ops, etc.).
      Prec.highest(keymap.of(vscodeKeymap)),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            void (async () => {
              try {
                await saveRef.current();
                onSavedRef.current?.();
              } catch (err) {
                // Surface in the console for now; a toast will land later.
                console.error("[EditorPane] save failed", err);
              }
            })();
            return true;
          },
        },
        {
          key: "Mod-w",
          preventDefault: true,
          run: () => {
            onCloseRef.current?.();
            return true;
          },
        },
      ]),
    ],
    [],
  );

  // Reconfigure the language compartment when the file path changes (or
  // when the doc finishes loading — switching from "loading" to "ready"
  // remounts the view, so the very first reconfigure may dispatch into
  // a null view and silently drop).
  useEffect(() => {
    let cancelled = false;
    void resolveLanguage(path).then((extension) => {
      if (cancelled) return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: languageCompartment.reconfigure(extension ?? []),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [path, doc.status]);

  // Wire the imperative handle. Plain callback prop instead of
  // forwardRef — React 19 lets refs pass through props directly.
  useEffect(() => {
    if (!handleRef) return;
    const handle: EditorPaneHandle = {
      setQuery: (q: string) => {
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({ search: q, caseSensitive: false }),
          ),
        });
        if (q) findNext(view);
      },
      findNext: () => {
        const view = cmRef.current?.view;
        if (view) findNext(view);
      },
      findPrevious: () => {
        const view = cmRef.current?.view;
        if (view) findPrevious(view);
      },
      clearQuery: () => {
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch({
          effects: setSearchQuery.of(new SearchQuery({ search: "" })),
        });
      },
      focus: () => {
        cmRef.current?.view?.focus();
      },
      getSelection: () => {
        const view = cmRef.current?.view;
        if (!view) return null;
        const { from, to } = view.state.selection.main;
        if (from === to) return null;
        return view.state.sliceDoc(from, to);
      },
      getPath: () => pathRef.current,
      reload: () => reloadRef.current(),
      undo: () => {
        const view = cmRef.current?.view;
        if (view) undo(view);
      },
      redo: () => {
        const view = cmRef.current?.view;
        if (view) redo(view);
      },
    };
    handleRef(handle);
    return () => handleRef(null);
    // handleRef identity churn is the caller's responsibility — we wrap
    // it once and leave it. (Same pattern as terax-ai's EditorStack.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (doc.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-[11.5px] text-foreground/55">
        Loading…
      </div>
    );
  }
  if (doc.status === "error") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[11.5px] text-rose-400/80">
        {doc.message}
      </div>
    );
  }
  if (doc.status === "binary") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <div className="text-[12.5px] text-foreground">Binary file</div>
        <div className="text-[11px] text-foreground/55">
          {formatBytes(doc.size)} · preview not supported
        </div>
      </div>
    );
  }
  if (doc.status === "toolarge") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <div className="text-[12.5px] text-foreground">File too large</div>
        <div className="text-[11px] text-foreground/55">
          {formatBytes(doc.size)} exceeds the {formatBytes(doc.limit)} limit.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CodeMirror
        ref={cmRef}
        value={doc.content}
        onChange={onChange}
        extensions={extensions}
        height="100%"
        className="flex-1 min-h-0 overflow-hidden"
        theme="none"
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
      />
    </div>
  );
}
