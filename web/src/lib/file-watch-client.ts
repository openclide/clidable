/**
 * Client for `/api/watch` with two pieces of cleverness:
 *
 *   1. **Single-project gate.** Only one project's WebSocket is ever
 *      open — the one declared "active" via `setActiveWatchedProject`.
 *      Other projects can have subscribers (the editor / changes
 *      panel / file tree in a hidden Code pane), but they sit idle
 *      until their project becomes active. This trims the resource
 *      footprint to "one fs.watch on the server, one WS on the wire,
 *      for the project the user is actively looking at."
 *
 *   2. **Active event on (re)connect.** When the WS opens (either the
 *      first subscription or a project-switch transition) the active
 *      project's subscribers each get a synthetic `{kind:"active"}`
 *      event. That's the signal to refetch from scratch — without it,
 *      switching back to a project after editing elsewhere would
 *      leave the editor / changes / tree showing pre-edit state.
 *
 * Auto-reconnect on transient drops (dev-server HMR, browser tab
 * suspend) uses exponential backoff capped at 30s. The active event
 * fires again on each reconnect for the same reason — we may have
 * missed events while disconnected.
 */
import type { WatchServerMessage } from "@shared/types";

export type FileWatchEvent =
  | { kind: "changed"; paths: readonly string[] }
  | { kind: "active" };

export type FileWatchListener = (event: FileWatchEvent) => void;

interface Connection {
  ws: WebSocket | null;
  subscribers: Set<FileWatchListener>;
  /** Set on teardown so a late `onclose` doesn't schedule a reconnect. */
  closed: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const connections = new Map<string, Connection>();
let activeProject: string | null = null;

/* ---------------------------------------------------------------------------
 * Active-project gate
 * ------------------------------------------------------------------------- */

/**
 * Set (or clear) the project whose file watcher should be live. Call
 * with `null` when the user leaves Code mode entirely.
 *
 * Transitions:
 *   • null → X:  open WS for X (if subscribers); fire active event
 *   • X → null:  close WS for X
 *   • X → Y:     close WS for X; open WS for Y; fire active event
 *   • X → X:     no-op
 */
export function setActiveWatchedProject(projectPath: string | null): void {
  if (projectPath === activeProject) return;

  // Tear down the WS for the previously-active project. Subscribers
  // for it stay attached — they'll re-arm if/when their project
  // becomes active again.
  if (activeProject !== null) {
    const conn = connections.get(activeProject);
    if (conn) closeSocketKeepConn(conn);
  }

  activeProject = projectPath;

  // Bring up the WS for the new active project if anyone's
  // subscribed. The active event fires from onopen below.
  if (projectPath !== null) {
    const conn = connections.get(projectPath);
    if (conn && conn.subscribers.size > 0) {
      ensureSocket(conn, projectPath);
    }
  }
}

/* ---------------------------------------------------------------------------
 * subscribe / unsubscribe
 * ------------------------------------------------------------------------- */

/**
 * Subscribe to file events for `projectPath`. The first subscriber
 * on an active project opens the WebSocket; the last unsubscriber on
 * any project tears its connection record down.
 *
 * If the project happens to already be active at subscribe time, the
 * subscriber receives a synthetic active event on the next tick so it
 * can refresh its state without racing the caller's render commit.
 */
export function subscribeToFileChanges(
  projectPath: string,
  listener: FileWatchListener,
): () => void {
  let conn = connections.get(projectPath);
  if (!conn) {
    conn = {
      ws: null,
      subscribers: new Set(),
      closed: false,
      reconnectAttempt: 0,
      reconnectTimer: null,
    };
    connections.set(projectPath, conn);
  }
  conn.subscribers.add(listener);

  if (projectPath === activeProject) {
    const wasOpen =
      conn.ws !== null && conn.ws.readyState === WebSocket.OPEN;
    ensureSocket(conn, projectPath);
    // Synthetic active event ONLY for late subscribers — joiners on
    // an already-open WS who'd otherwise miss the per-connection
    // active fan-out from `onopen`. If the WS isn't open yet (we're
    // the one who just spun it up), the onopen path covers everyone
    // and a microtask here would just double-up.
    if (wasOpen) {
      queueMicrotask(() => {
        if (conn!.subscribers.has(listener)) {
          try {
            listener({ kind: "active" });
          } catch (e) {
            console.error("[file-watch] subscriber threw on active", e);
          }
        }
      });
    }
  }

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    const c = connections.get(projectPath);
    if (!c) return;
    c.subscribers.delete(listener);
    if (c.subscribers.size === 0) {
      teardown(c);
      connections.delete(projectPath);
    }
  };
}

/* ---------------------------------------------------------------------------
 * WS lifecycle
 * ------------------------------------------------------------------------- */

function ensureSocket(conn: Connection, projectPath: string): void {
  if (conn.ws !== null) return;
  conn.closed = false;
  conn.ws = createSocket(projectPath);
  wireSocket(conn, projectPath);
}

function createSocket(projectPath: string): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const qs = new URLSearchParams({ projectPath });
  return new WebSocket(`${proto}://${window.location.host}/api/watch?${qs}`);
}

function wireSocket(conn: Connection, projectPath: string): void {
  const ws = conn.ws;
  if (!ws) return;
  ws.onopen = () => {
    conn.reconnectAttempt = 0;
    // Fire active event to every subscriber: we just (re)connected,
    // anything could've changed while we were silent.
    if (projectPath === activeProject) {
      for (const sub of conn.subscribers) {
        try {
          sub({ kind: "active" });
        } catch (e) {
          console.error("[file-watch] subscriber threw on (re)connect", e);
        }
      }
    }
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    let msg: WatchServerMessage;
    try {
      msg = JSON.parse(ev.data) as WatchServerMessage;
    } catch {
      return;
    }
    if (msg.type === "changed") {
      const event: FileWatchEvent = { kind: "changed", paths: msg.paths };
      for (const sub of conn.subscribers) {
        try {
          sub(event);
        } catch (e) {
          console.error("[file-watch] subscriber threw", e);
        }
      }
    } else if (msg.type === "error") {
      console.error(`[file-watch] server error ${projectPath}:`, msg.message);
    }
  };
  ws.onclose = () => {
    conn.ws = null;
    if (conn.closed) return;
    if (projectPath !== activeProject) {
      // We were intentionally stood down because the active project
      // changed. No reconnect.
      return;
    }
    // Transient drop — back off and retry. Cap at 30s.
    conn.reconnectAttempt += 1;
    const delay = Math.min(30_000, 250 * 2 ** Math.min(conn.reconnectAttempt, 6));
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      // If active project flipped in the interim, skip.
      if (projectPath !== activeProject) return;
      if (conn.subscribers.size === 0) return;
      conn.ws = createSocket(projectPath);
      wireSocket(conn, projectPath);
    }, delay);
  };
  ws.onerror = () => {
    /* onclose runs after; backoff there handles reconnect */
  };
}

/** Close the WS but keep the Connection record so subscribers stay attached. */
function closeSocketKeepConn(conn: Connection): void {
  if (conn.reconnectTimer !== null) {
    clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
  }
  if (conn.ws) {
    try {
      conn.ws.close();
    } catch {
      /* already closed */
    }
    conn.ws = null;
  }
}

function teardown(conn: Connection): void {
  conn.closed = true;
  if (conn.reconnectTimer !== null) {
    clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
  }
  if (conn.ws) {
    try {
      conn.ws.close();
    } catch {
      /* already closed */
    }
    conn.ws = null;
  }
}
