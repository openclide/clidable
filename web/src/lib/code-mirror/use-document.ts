/**
 * Load + save a single file via Clidable's `/api/fs` endpoints. Ported
 * from terax-ai's `useDocument`, with `invoke()` swapped for `fetch`.
 *
 * Semantics preserved:
 *   • `doc.status` reflects load state (`loading` / `ready` / `binary` /
 *     `toolarge` / `error`).
 *   • `onChange(next)` updates the buffer and dirty flag.
 *   • `save()` is a no-op when not dirty (the editor calls it on every
 *     ⌘S, but we don't want to hit the disk for every keystroke after a
 *     save).
 *   • `reload()` is best-effort: returns `false` if the buffer is dirty
 *     so we never clobber unsaved edits, and bails when disk matches
 *     buffer to avoid a self-save → watcher → reload echo loop.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeToFileChanges } from "../file-watch-client";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type DocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

interface Options {
  /** Absolute (or cwd-relative) project root. */
  root: string;
  /** File path relative to `root`. */
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
}

async function fetchRead(root: string, path: string): Promise<ReadResult> {
  const qs = new URLSearchParams({ root, path });
  const res = await fetch(`/api/fs/read?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error ?? `read failed: ${res.status}`);
  }
  return (await res.json()) as ReadResult;
}

async function fetchWrite(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const qs = new URLSearchParams({ root, path });
  const res = await fetch(`/api/fs/write?${qs}`, {
    method: "PUT",
    body: content,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error ?? `write failed: ${res.status}`);
  }
}

export function useDocument({ root, path, onDirtyChange }: Options) {
  const [doc, setDoc] = useState<DocumentState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);

  const savedRef = useRef<string>("");
  const bufferRef = useRef<string>("");
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  // Load on path/root change.
  useEffect(() => {
    let cancelled = false;
    setDoc({ status: "loading" });
    setDirty(false);

    fetchRead(root, path)
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          savedRef.current = res.content;
          bufferRef.current = res.content;
          setDoc({ status: "ready", content: res.content, size: res.size });
        } else if (res.kind === "binary") {
          setDoc({ status: "binary", size: res.size });
        } else if (res.kind === "toolarge") {
          setDoc({ status: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDoc({ status: "error", message: String(e?.message ?? e) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [root, path]);

  const reload = useCallback((): boolean => {
    if (dirtyRef.current) return false;
    void fetchRead(root, path)
      .then((res) => {
        if (res.kind === "text") {
          if (res.content === savedRef.current) return;
          savedRef.current = res.content;
          bufferRef.current = res.content;
          setDirty(false);
          setDoc({ status: "ready", content: res.content, size: res.size });
        } else if (res.kind === "binary") {
          setDoc({ status: "binary", size: res.size });
        } else if (res.kind === "toolarge") {
          setDoc({ status: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((e) =>
        setDoc({ status: "error", message: String(e?.message ?? e) }),
      );
    return true;
  }, [root, path]);

  // Subscribe to file changes on this project. The watcher fires for
  // every disk write — agent edits via PTY, checkpoint restores, even
  // the user's own ⌘S elsewhere — so we get auto-reload for free in
  // all of those. `reload()` already (a) skips silently when the
  // buffer is dirty so unsaved edits survive, and (b) errors out
  // cleanly when the file is gone (deleted by a rewind, say) — the
  // user closes the now-error tab manually.
  useEffect(() => {
    return subscribeToFileChanges(root, (event) => {
      if (event.kind === "active") {
        // (Re)connected to this project's watcher — refresh from disk
        // because we may have missed events while inactive.
        reload();
        return;
      }
      // Path-match: the watcher emits paths relative to the project
      // root, forward-slash separated. We only react when *this*
      // file changed.
      if (event.paths.includes(path)) reload();
    });
  }, [root, path, reload]);

  const onChange = useCallback((next: string) => {
    bufferRef.current = next;
    setDirty(next !== savedRef.current);
  }, []);

  const save = useCallback(async () => {
    if (!dirtyRef.current) return;
    const content = bufferRef.current;
    await fetchWrite(root, path, content);
    savedRef.current = content;
    setDirty(false);
  }, [root, path]);

  return { doc, dirty, onChange, save, reload };
}
