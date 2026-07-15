/**
 * Multiplexed terminal WebSocket client.
 *
 * One global WS connection per browser; many sessions multiplexed by id.
 * Subscribers register callbacks for output/exit/error and call the
 * returned `dispose` when they're done. The client reconnects with
 * backoff on disconnect — subscribers stay registered and resubscribe
 * automatically once the socket reconnects.
 */
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
  /** Pending open params (re-sent on reconnect if not yet subscribed). */
  openParams?: {
    agent: TerminalAgentId;
    projectPath: string;
    cols: number;
    rows: number;
  };
}

class TerminalClient {
  private ws: WebSocket | null = null;
  private connecting = false;
  private subscribers = new Map<string, SubscriberEntry>();
  private reconnectDelay = 250;

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

  resize(id: string, cols: number, rows: number): void {
    const entry = this.subscribers.get(id);
    if (entry?.openParams) {
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
    }
    this.subscribers.delete(id);
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
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) return;
      if (this.ws.readyState === WebSocket.CONNECTING) return;
    }
    if (this.connecting) return;
    this.connecting = true;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/terminal`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      this.connecting = false;
      this.reconnectDelay = 250;
      this.ws = ws;
      // Send open (or subscribe, if the server already has the session
      // from a prior connection) for every known subscriber.
      for (const [id, entry] of this.subscribers) {
        if (entry.openParams) {
          ws.send(
            JSON.stringify({
              type: "open",
              id,
              ...entry.openParams,
            } satisfies TerminalClientMessage),
          );
        } else {
          ws.send(
            JSON.stringify({
              type: "subscribe",
              id,
            } satisfies TerminalClientMessage),
          );
        }
      }
    };

    ws.onmessage = (e) => this.onMessage(e);

    ws.onclose = () => {
      this.ws = null;
      this.connecting = false;
      // Reconnect with capped exponential backoff so long as we have
      // subscribers waiting.
      if (this.subscribers.size > 0) {
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
