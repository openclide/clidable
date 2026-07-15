/**
 * Multi-file editor stack. Renders every open tab as an absolutely
 * positioned `EditorPane`; only the active one is visible and
 * interactive. The inactive panes stay mounted so switching tabs
 * preserves scroll position, undo history, cursor location, and any
 * in-flight loads.
 *
 * Stable per-tab callbacks
 * ------------------------
 * Inline arrows in the `onDirtyChange` prop would change identity on
 * every parent render, which makes `EditorPane`'s effect that fans the
 * value out to the document hook fire spuriously and (worse) triggers
 * setState loops up here. Memoize one callback per path and reuse it.
 * Same trick terax-ai uses in its EditorStack.
 *
 * Callbacks for closed tabs are pruned when the tab list shrinks so
 * the cache doesn't grow without bound across a long session.
 */
import { useEffect, useRef } from "react";
import { EditorPane } from "./EditorPane";
import type { Tab } from "./CodePane";

interface Props {
  projectId: string;
  root: string;
  tabs: Tab[];
  activeIndex: number;
  onDirtyChange: (path: string, dirty: boolean) => void;
  onCloseActive: () => void;
}

export function EditorStack({
  projectId,
  root,
  tabs,
  activeIndex,
  onDirtyChange,
  onCloseActive,
}: Props) {
  // Always read the latest callbacks. Memoized per-tab wrappers (below)
  // read through these so they never go stale even though their own
  // identity stays pinned.
  const dirtyRef = useRef(onDirtyChange);
  const closeRef = useRef(onCloseActive);
  useEffect(() => {
    dirtyRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    closeRef.current = onCloseActive;
  }, [onCloseActive]);

  const dirtyCallbacks = useRef(new Map<string, (dirty: boolean) => void>());
  const getDirtyCallback = (path: string) => {
    let cb = dirtyCallbacks.current.get(path);
    if (!cb) {
      cb = (dirty: boolean) => dirtyRef.current(path, dirty);
      dirtyCallbacks.current.set(path, cb);
    }
    return cb;
  };

  // The close callback is the same for every tab — only the active one
  // ever fires it, since Cmd-W reaches the focused editor — so it's a
  // single ref-deref rather than a per-tab map.
  const closeCallback = useRef(() => closeRef.current()).current;

  // Drop stale per-tab callbacks when tabs close so the Map doesn't
  // grow unbounded across a long session.
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.path));
    for (const path of dirtyCallbacks.current.keys()) {
      if (!live.has(path)) dirtyCallbacks.current.delete(path);
    }
  }, [tabs]);

  return (
    <div className="relative h-full w-full">
      {tabs.map((tab, index) => {
        const visible = index === activeIndex;
        return (
          <div
            key={`${projectId}|${tab.path}`}
            aria-hidden={!visible}
            className={`absolute inset-0 ${
              visible ? "" : "invisible pointer-events-none"
            }`}
          >
            <EditorPane
              root={root}
              path={tab.path}
              onDirtyChange={getDirtyCallback(tab.path)}
              onClose={closeCallback}
            />
          </div>
        );
      })}
    </div>
  );
}
