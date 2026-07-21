/**
 * WebSocket handler for `/api/terminal` — one connection per browser,
 * many sessions multiplexed by id.
 *
 * Text frames carry control messages (open/subscribe/resize/close + ready/
 * exit/error). Binary frames carry PTY I/O with a tiny header:
 *
 *   [0]      uint8     kind   0 = input (C→S), 1 = output (S→C)
 *   [1..36]  ASCII     id     fixed-width session id (right-padded with NUL)
 *   [37..]   bytes     data   raw PTY bytes
 *
 * The fixed-width id keeps the parser allocation-free in the hot path.
 */
import type { ServerWebSocket } from "bun";
import { sessionManager } from "../pty/manager";
import { type Session, type SessionSubscriber } from "../pty/session";
import { getAgentStatus, onAgentStatus } from "../pty/agent-status";
import { setSessionLabel } from "../pty/session-label";
import {
  TERMINAL_FRAME_KIND_INPUT,
  TERMINAL_FRAME_KIND_OUTPUT,
  TERMINAL_ID_BYTES,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from "../../shared/types";

/** The `open` control message, kept so a stale-resume relaunch can replay the
 *  exact spawn the client asked for. */
type TerminalOpenMessage = Extract<TerminalClientMessage, { type: "open" }>;

interface TerminalSocketData {
  /** Map of session-id → subscriber registered for THIS socket. */
  subs: Map<string, SessionSubscriber>;
  /** Session ids this client declared ownership of via `retain` — kept even
   *  for ids with no live session yet, so retention can be re-applied after
   *  `open` finishes spawning (retain can race an in-flight spawn). */
  retained: Set<string>;
  /** Ids already relaunched once after a stale resume. A fresh spawn carries no
   *  resume args and so can't fail the same way — but if clearing the ref ever
   *  fails (its write is best-effort), this is what stops a respawn loop. */
  resumeRetried: Set<string>;
}

// Every open terminal socket, so a status change can be fanned out to whichever
// connections are subscribed to the affected session.
const terminalSockets = new Set<ServerWebSocket<TerminalSocketData>>();

// Registered once: push each status change to every socket that cares about
// that id — whether it's actively subscribed (visible) OR merely retained
// (a background tab / minimized terminal). The latter is what lets the dock and
// off-screen tab chips show a live status dot without being rendered.
onAgentStatus((id, state) => {
  for (const ws of terminalSockets) {
    if (
      ws.readyState === 1 /* OPEN */ &&
      (ws.data.subs.has(id) || ws.data.retained.has(id))
    ) {
      sendServer(ws, { type: "status", id, state });
    }
  }
});

export const terminalWebSocketHandler = {
  open(ws: ServerWebSocket<TerminalSocketData>) {
    ws.data = {
      subs: new Map(),
      retained: new Set(),
      resumeRetried: new Set(),
    };
    terminalSockets.add(ws);
  },

  async message(
    ws: ServerWebSocket<TerminalSocketData>,
    raw: string | Buffer,
  ) {
    if (typeof raw !== "string") {
      // Binary frame: PTY input.
      handleBinaryFrame(ws, raw);
      return;
    }
    let msg: TerminalClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendServer(ws, {
        type: "error",
        code: "BAD_JSON",
        message: "Could not parse control frame as JSON",
      });
      return;
    }
    await handleControl(ws, msg);
  },

  close(ws: ServerWebSocket<TerminalSocketData>) {
    // Unsubscribe everything but keep sessions running so they can be
    // re-attached by the next client connection.
    for (const [id, sub] of ws.data.subs) {
      const session = sessionManager.get(id);
      session?.unsubscribe(sub);
    }
    ws.data.subs.clear();
    // Drop this connection's retentions — with no client left claiming them,
    // the sessions start the normal detach-grace countdown.
    for (const id of ws.data.retained) {
      sessionManager.get(id)?.release(ws);
    }
    ws.data.retained.clear();
    terminalSockets.delete(ws);
  },

  // Backpressure: pause-resume support could go here later.
};

function sendServer(
  ws: ServerWebSocket<TerminalSocketData>,
  msg: TerminalServerMessage,
): void {
  ws.send(JSON.stringify(msg));
}

async function handleControl(
  ws: ServerWebSocket<TerminalSocketData>,
  msg: TerminalClientMessage,
): Promise<void> {
  if (msg.type === "open") {
    try {
      const session = await sessionManager.open({
        id: msg.id,
        agent: msg.agent,
        projectPath: msg.projectPath,
        cols: msg.cols,
        rows: msg.rows,
      });
      // The socket may have closed while the spawn was in flight (page
      // reload mid-open). Attaching its dead subscriber would pin the
      // session (detachedAt stays null) so the reaper could never collect
      // it — bail and let the fresh session sit detached instead.
      if (ws.readyState !== 1 /* OPEN */) return;
      attachSubscriber(ws, session, msg);
      // A `retain` for this id may have arrived while the spawn was still
      // in flight (no session to pin yet) — apply it now.
      if (ws.data.retained.has(session.id)) session.retain(ws);
      sendServer(ws, {
        type: "ready",
        id: session.id,
        agent: session.agent,
        replayLength: session.replayLength,
      });
      if (session.replayLength > 0) {
        sendOutputFrame(ws, session.id, session.getReplay());
      }
      // Snapshot the current live status so a (re)attaching client shows the
      // right dot immediately, without waiting for the next transition.
      const status = getAgentStatus(session.id);
      if (status) sendServer(ws, { type: "status", id: session.id, state: status });
    } catch (err) {
      const e = err as Error & { code?: string };
      sendServer(ws, {
        type: "error",
        id: msg.id,
        code: e.code ?? "OPEN_FAILED",
        message: e.message ?? "Failed to open session",
      });
    }
    return;
  }

  if (msg.type === "unsubscribe") {
    const sub = ws.data.subs.get(msg.id);
    if (sub) {
      sessionManager.get(msg.id)?.unsubscribe(sub);
      ws.data.subs.delete(msg.id);
    }
    return;
  }

  if (msg.type === "resize") {
    sessionManager.get(msg.id)?.resize(msg.cols, msg.rows);
    return;
  }

  if (msg.type === "label") {
    // Session-scoped, not socket-scoped: the tray shows names for every
    // window's agents, so it's global and outlives this connection (cleared
    // only on retitle-to-blank or when the process exits).
    setSessionLabel(msg.id, msg.title);
    return;
  }

  if (msg.type === "close") {
    const sub = ws.data.subs.get(msg.id);
    if (sub) {
      sessionManager.get(msg.id)?.unsubscribe(sub);
      ws.data.subs.delete(msg.id);
    }
    ws.data.retained.delete(msg.id);
    sessionManager.kill(msg.id);
    return;
  }

  if (msg.type === "retain") {
    const prev = ws.data.retained;
    const next = new Set(msg.ids);
    // Release sessions this client no longer claims…
    for (const id of prev) {
      if (!next.has(id)) sessionManager.get(id)?.release(ws);
    }
    // …and pin every claimed one (idempotent; ids without a live session
    // stay in the set and get pinned when their `open` completes).
    for (const id of next) {
      sessionManager.get(id)?.retain(ws);
      // Snapshot the current status for a newly-retained (e.g. minimized)
      // terminal, so its dock dot is right immediately — not only after the
      // next live transition.
      if (!prev.has(id)) {
        const status = getAgentStatus(id);
        if (status) sendServer(ws, { type: "status", id, state: status });
      }
    }
    ws.data.retained = next;
    return;
  }
}

function attachSubscriber(
  ws: ServerWebSocket<TerminalSocketData>,
  session: Session,
  open: TerminalOpenMessage,
): void {
  // If this socket already subscribed to this session, drop the old sub.
  const prior = ws.data.subs.get(session.id);
  if (prior) session.unsubscribe(prior);

  const sub: SessionSubscriber = {
    onOutput: (chunk) => sendOutputFrame(ws, session.id, chunk),
    onExit: (code, signal) => {
      // A resume against a stale ref isn't the agent quitting — it's a session
      // that never existed (the id was minted at SessionStart, before the agent
      // had written any conversation). Relaunch clean instead of reporting an
      // exit, which would strand the pane on "close this tab to free it".
      if (session.didResumeFailFast() && !ws.data.resumeRetried.has(session.id)) {
        ws.data.resumeRetried.add(session.id);
        void respawnFresh(ws, open, code, signal);
        return;
      }
      sendServer(ws, { type: "exit", id: session.id, code, signal });
    },
  };
  session.subscribe(sub);
  ws.data.subs.set(session.id, sub);
}

/**
 * Re-open a terminal whose resume turned out to be stale. The failed attempt
 * already cleared the session ref, so this spawns the agent fresh under the
 * same terminal id — the pane keeps its identity and the new output simply
 * continues below the failure, which stays visible in the scrollback.
 *
 * The retry is one-shot while it's in flight — the guard in attachSubscriber,
 * plus the fact that a fresh spawn carries no resume args to fail at. It is
 * released again on success so a *later* stale resume for the same id (history
 * deleted, id rotated by /clear) can still recover on this same long-lived
 * socket.
 */
async function respawnFresh(
  ws: ServerWebSocket<TerminalSocketData>,
  open: TerminalOpenMessage,
  code: number,
  signal: string | null,
): Promise<void> {
  try {
    // Drop the dead session's subscriber first: attachSubscriber assumes the
    // `prior` it finds belongs to the session it was handed, which stops being
    // true the moment a different Session takes over this id.
    ws.data.subs.delete(open.id);
    const session = await sessionManager.open({
      id: open.id,
      agent: open.agent,
      projectPath: open.projectPath,
      cols: open.cols,
      rows: open.rows,
    });
    if (ws.readyState !== 1 /* OPEN */) return;
    attachSubscriber(ws, session, open);
    if (ws.data.retained.has(session.id)) session.retain(ws);
    ws.data.resumeRetried.delete(open.id);
  } catch (err) {
    // Nothing left to fall back to. Report the exit the client would have got
    // had we not swallowed it, so its normal session-ended handling runs
    // instead of leaving the pane waiting on output that will never come.
    console.error(`[terminal-ws] respawn after stale resume failed:`, err);
    sendServer(ws, { type: "exit", id: open.id, code, signal });
  }
}

function handleBinaryFrame(
  _ws: ServerWebSocket<TerminalSocketData>,
  buf: Buffer,
): void {
  if (buf.byteLength < 1 + TERMINAL_ID_BYTES) return;
  const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const kind = view[0];
  if (kind !== TERMINAL_FRAME_KIND_INPUT) return; // Only INPUT is C→S.
  const id = decodeId(view, 1);
  const data = view.subarray(1 + TERMINAL_ID_BYTES);
  sessionManager.get(id)?.write(data);
}

function sendOutputFrame(
  ws: ServerWebSocket<TerminalSocketData>,
  id: string,
  data: Uint8Array,
): void {
  const frame = new Uint8Array(1 + TERMINAL_ID_BYTES + data.byteLength);
  frame[0] = TERMINAL_FRAME_KIND_OUTPUT;
  encodeId(id, frame, 1);
  frame.set(data, 1 + TERMINAL_ID_BYTES);
  ws.send(frame);
}

function encodeId(id: string, out: Uint8Array, offset: number): void {
  if (id.length > TERMINAL_ID_BYTES) {
    // Truncating would silently mis-route output frames. Log loudly.
    console.error(
      `[terminal-ws] session id "${id}" exceeds ${TERMINAL_ID_BYTES} bytes — frames will be dropped`,
    );
  }
  for (let i = 0; i < TERMINAL_ID_BYTES; i++) {
    out[offset + i] = i < id.length ? id.charCodeAt(i) : 0;
  }
}

function decodeId(buf: Uint8Array, offset: number): string {
  let end = offset + TERMINAL_ID_BYTES;
  while (end > offset && buf[end - 1] === 0) end--;
  let out = "";
  for (let i = offset; i < end; i++) out += String.fromCharCode(buf[i]!);
  return out;
}
