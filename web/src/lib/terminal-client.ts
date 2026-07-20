/**
 * Multiplexed terminal WebSocket client.
 *
 * One global WS connection per browser; many sessions multiplexed by id.
 * Subscribers register callbacks for output/exit/error and call the
 * returned `dispose` when they're done. The client reconnects with
 * backoff on disconnect — subscribers stay registered and resubscribe
 * automatically once the socket reconnects.
 */
import { clearLocalAgentStatus, setLocalAgentStatus } from "./agent-status";
import {
  TERMINAL_FRAME_KIND_INPUT,
  TERMINAL_FRAME_KIND_OUTPUT,
  TERMINAL_ID_BYTES,
  type TerminalAgentId,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from "@shared/types";

export interface TerminalSubscriberCallbacks {
  onOutput?: (data: Uint8Array) => void;
  onReady?: (replayLength: number) => void;
  onExit?: (code: number, signal: string | null) => void;
  onError?: (code: string, message: string) => void;
}

interface SubscriberEntry {
  id: string;
  callbacks: TerminalSubscriberCallbacks;
  /** Params to (re-)open this session, re-sent on every (re)connect. The
   *  server's `open` is idempotent — it spawns or re-attaches as needed. */
  openParams: {
    agent: TerminalAgentId;
    projectPath: string;
    cols: number;
    rows: number;
  };
}

/** Shared UTF-8 encoder for `writeText` — one instance, not one per keystroke. */
const TEXT_ENCODER = new TextEncoder();

class TerminalClient {
  /** The OPEN socket (send path), or null. */
  private ws: WebSocket | null = null;
  /** The newest socket, including one still CONNECTING. Event handlers
   *  compare against this so a superseded socket's open/close/message can
   *  never clobber the live connection's state (stale onclose used to reset
   *  the backoff flags and spawn a duplicate connection — double output). */
  private current: WebSocket | null = null;
  private subscribers = new Map<string, SubscriberEntry>();
  private reconnectDelay = 250;
  /** Last retained-id set sent to the server (open tabs + minimized). */
  private retained: string[] = [];
  /** User-given tab names mirrored to the server for the desktop tray, re-sent
   *  on every (re)connect so a fresh socket carries them. */
  private labels = new Map<string, string>();
  /** Kills requested while disconnected — flushed on the next open socket
   *  so "close terminal during a network blip" still SIGTERMs the PTY
   *  instead of leaving it to the 10-minute reaper. */
  private pendingKills = new Set<string>();

  /**
   * Open or attach to a session. Returns a dispose() that unsubscribes
   * but leaves the session running server-side. Use `kill(id)` to also
   * terminate the PTY.
   */
  open(
    id: string,
    agent: TerminalAgentId,
    projectPath: string,
    cols: number,
    rows: number,
    callbacks: TerminalSubscriberCallbacks,
  ): () => void {
    const entry: SubscriberEntry = {
      id,
      callbacks,
      openParams: { agent, projectPath, cols, rows },
    };
    this.subscribers.set(id, entry);
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Already connected — send opens straight away. If WS isn't ready
      // yet, the onopen handler will iterate subscribers and send for us.
      this.ws.send(
        JSON.stringify({
          type: "open",
          id,
          agent,
          projectPath,
          cols,
          rows,
        } satisfies TerminalClientMessage),
      );
    } else {
      this.ensureConnected();
    }
    return () => this.unsubscribe(id);
  }

  /** Send raw bytes to the PTY's stdin. */
  write(id: string, data: Uint8Array): void {
    if (!this.subscribers.has(id)) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const frame = new Uint8Array(
      new ArrayBuffer(1 + TERMINAL_ID_BYTES + data.byteLength),
    );
    frame[0] = TERMINAL_FRAME_KIND_INPUT;
    this.encodeId(id, frame, 1);
    frame.set(data, 1 + TERMINAL_ID_BYTES);
    this.ws.send(frame);
  }

  /** Send a UTF-8 string to the PTY's stdin — convenience over `write` for key
   *  sequences and pasted text (arrow/Esc keys, the touch key-bar, sends). */
  writeText(id: string, text: string): void {
    this.write(id, TEXT_ENCODER.encode(text));
  }

  /**
   * Mirror a tab's user-given name to the server (for the desktop tray). Pass
   * null/blank to clear it back to the agent-type name. Remembered and re-sent
   * on reconnect. Sessions the user never renamed send nothing.
   */
  setLabel(id: string, title: string | null): void {
    const trimmed = title?.trim() ?? "";
    if (trimmed) this.labels.set(id, trimmed);
    else if (!this.labels.delete(id)) return; // clearing an unnamed session: no-op
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "label",
          id,
          title: trimmed || null,
        } satisfies TerminalClientMessage),
      );
    }
  }

  /** Forget a label locally WITHOUT notifying the server (the session's own
   *  exit clears the server side). Called when a workspace unmounts so stale
   *  labels don't accumulate here and get re-sent on every reconnect. */
  dropLabel(id: string): void {
    this.labels.delete(id);
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.subscribers.get(id);
    if (entry) {
      entry.openParams.cols = cols;
      entry.openParams.rows = rows;
    }
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "resize",
        id,
        cols,
        rows,
      } satisfies TerminalClientMessage),
    );
  }

  /** Kill the PTY and unsubscribe locally. */
  kill(id: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ type: "close", id } satisfies TerminalClientMessage),
      );
    } else {
      this.pendingKills.add(id);
      this.ensureConnected();
    }
    this.subscribers.delete(id);
  }

  /**
   * Declare the full set of session ids this client owns (open tabs +
   * minimized terminals). Retained sessions are exempt from the server's
   * idle-session reaper even with no output subscriber. Idempotent — the
   * server diffs against the previous set; ids no longer listed are
   * released and start the normal detach-grace countdown.
   */
  retain(ids: string[]): void {
    // Compare as sets — the server diffs retention by membership, so a mere
    // reorder (same ids) shouldn't trigger a resend.
    const prev = new Set(this.retained);
    const same = ids.length === prev.size && ids.every((id) => prev.has(id));
    this.retained = ids;
    if (same) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ type: "retain", ids } satisfies TerminalClientMessage),
      );
    } else if (ids.length > 0) {
      // No socket (e.g. everything is minimized, so no subscriber kept it
      // alive) — reconnect; onopen re-sends the retained set. Releasing to an
      // empty set needs no socket: a prior socket already released everything
      // server-side when it closed, so don't reconnect just to send nothing.
      this.ensureConnected();
    }
  }

  private unsubscribe(id: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "unsubscribe",
          id,
        } satisfies TerminalClientMessage),
      );
    }
    this.subscribers.delete(id);
  }

  private ensureConnected(): void {
    // A CLOSING socket falls through — it can't carry traffic anymore, so a
    // replacement starts now; identity checks below keep its late events inert.
    const cur = this.current;
    if (
      cur &&
      (cur.readyState === WebSocket.OPEN ||
        cur.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/terminal`);
    ws.binaryType = "arraybuffer";
    this.current = ws;

    ws.onopen = () => {
      if (this.current !== ws) {
        // Superseded while connecting — don't fight the newer socket.
        ws.close();
        return;
      }
      this.reconnectDelay = 250;
      this.ws = ws;
      // Kills queued while offline go first, so a same-id reopen below
      // spawns fresh instead of attaching to the half-dead old session.
      for (const id of this.pendingKills) {
        ws.send(
          JSON.stringify({ type: "close", id } satisfies TerminalClientMessage),
        );
      }
      this.pendingKills.clear();
      // Re-declare retention next — a fresh connection has an empty
      // retained set server-side, and minimized terminals have no
      // subscriber below to re-attach them.
      if (this.retained.length > 0) {
        ws.send(
          JSON.stringify({
            type: "retain",
            ids: this.retained,
          } satisfies TerminalClientMessage),
        );
      }
      // Re-send any user-given tab names — a fresh connection's server has no
      // memory of them (or the server restarted), so the tray would otherwise
      // fall back to the agent-type name.
      for (const [id, title] of this.labels) {
        ws.send(
          JSON.stringify({
            type: "label",
            id,
            title,
          } satisfies TerminalClientMessage),
        );
      }
      // (Re)open every known subscriber. The server's `open` is idempotent —
      // it spawns a new session or re-attaches to an existing one, so we never
      // need a separate "subscribe" path.
      for (const [id, entry] of this.subscribers) {
        ws.send(
          JSON.stringify({
            type: "open",
            id,
            ...entry.openParams,
          } satisfies TerminalClientMessage),
        );
      }
    };

    // Identity-gated: a superseded socket must not deliver duplicate output
    // or tear down state that now belongs to its replacement.
    ws.onmessage = (e) => {
      if (this.current === ws) this.onMessage(e);
    };

    ws.onclose = () => {
      if (this.current !== ws) return; // stale socket's close — ignore
      this.current = null;
      this.ws = null;
      // Reconnect with capped exponential backoff so long as we have
      // subscribers waiting — or retained (e.g. minimized) sessions /
      // queued kills, which have no subscriber but need a connection to
      // reach the server.
      if (
        this.subscribers.size > 0 ||
        this.retained.length > 0 ||
        this.pendingKills.size > 0
      ) {
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(delay * 2, 5000);
        setTimeout(() => this.ensureConnected(), delay);
      }
    };

    ws.onerror = () => {
      // The onclose handler does the actual reconnect logic.
    };
  }

  private onMessage(e: MessageEvent): void {
    if (typeof e.data === "string") {
      const msg = JSON.parse(e.data) as TerminalServerMessage;
      this.handleControl(msg);
      return;
    }
    // Binary frame: output.
    const buf = new Uint8Array(e.data);
    if (buf.byteLength < 1 + TERMINAL_ID_BYTES) return;
    const kind = buf[0];
    if (kind !== TERMINAL_FRAME_KIND_OUTPUT) return;
    const id = this.decodeId(buf, 1);
    const entry = this.subscribers.get(id);
    if (!entry) return;
    entry.callbacks.onOutput?.(buf.subarray(1 + TERMINAL_ID_BYTES));
  }

  private handleControl(msg: TerminalServerMessage): void {
    if (msg.type === "ready") {
      const entry = this.subscribers.get(msg.id);
      entry?.callbacks.onReady?.(msg.replayLength);
      // Keep openParams around so a server restart / reconnect can spawn
      // a fresh session via `open` (the server is idempotent — existing
      // sessions are returned without re-spawning).
      return;
    }
    if (msg.type === "exit") {
      const entry = this.subscribers.get(msg.id);
      entry?.callbacks.onExit?.(msg.code, msg.signal);
      clearLocalAgentStatus(msg.id); // dead session has no status
      return;
    }
    if (msg.type === "status") {
      // Applied to the global store (not a per-view callback) so the dot shows
      // for terminals you're not looking at — background tabs and the dock — not
      // just the mounted one. A null state clears it (the session exited); this
      // is how a retained-only terminal, which gets no `exit` message, drops its
      // stale dot.
      if (msg.state === null) clearLocalAgentStatus(msg.id);
      else setLocalAgentStatus(msg.id, msg.state);
      return;
    }
    if (msg.type === "error") {
      const id = msg.id;
      if (id) {
        const entry = this.subscribers.get(id);
        entry?.callbacks.onError?.(msg.code, msg.message);
      } else {
        console.error("[terminal-client] error:", msg.code, msg.message);
      }
    }
  }

  private encodeId(id: string, out: Uint8Array, offset: number): void {
    if (id.length > TERMINAL_ID_BYTES) {
      console.error(
        `[terminal-client] session id "${id}" exceeds ${TERMINAL_ID_BYTES} bytes — input frames will be dropped`,
      );
    }
    for (let i = 0; i < TERMINAL_ID_BYTES; i++) {
      out[offset + i] = i < id.length ? id.charCodeAt(i) : 0;
    }
  }

  private decodeId(buf: Uint8Array, offset: number): string {
    let end = offset + TERMINAL_ID_BYTES;
    while (end > offset && buf[end - 1] === 0) end--;
    let out = "";
    for (let i = offset; i < end; i++) out += String.fromCharCode(buf[i]!);
    return out;
  }
}

export const terminalClient = new TerminalClient();
