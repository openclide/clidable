/**
 * WebSocket bridge for the dev-server proxy (M-E2). When a client upgrades
 * `/proxy/<port>/…`, we open a client WebSocket to `ws://127.0.0.1:<port>/…`
 * and pipe frames both ways — so HMR / live-reload sockets work through the
 * proxy in remote mode. Best-effort: any upstream failure closes the client.
 */
import type { ServerWebSocket } from "bun";

// Cap frames buffered before the upstream socket opens — a client that floods
// before (or while) upstream is still connecting must not grow memory without
// bound. On overflow we drop the bridge.
const MAX_QUEUED_FRAMES = 64;

export interface ProxyWsData {
  target: string;
  upstream: WebSocket | null;
  queue: (string | Uint8Array)[];
}

export const proxyWsHandler = {
  open(ws: ServerWebSocket<ProxyWsData>) {
    const d = ws.data;
    let up: WebSocket;
    try {
      up = new WebSocket(d.target);
    } catch {
      ws.close(1011, "proxy connect failed");
      return;
    }
    up.binaryType = "arraybuffer";
    up.onopen = () => {
      for (const m of d.queue) {
        try {
          up.send(m as Parameters<WebSocket["send"]>[0]);
        } catch {
          /* drop */
        }
      }
      d.queue.length = 0;
    };
    up.onmessage = (ev: MessageEvent) => {
      try {
        const data = ev.data;
        if (typeof data === "string") ws.send(data);
        else ws.send(new Uint8Array(data as ArrayBuffer));
      } catch {
        /* client gone */
      }
    };
    up.onclose = () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
    up.onerror = () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
    d.upstream = up;
  },

  message(ws: ServerWebSocket<ProxyWsData>, raw: string | Buffer) {
    const d = ws.data;
    if (d.upstream && d.upstream.readyState === 1 /* OPEN */) {
      try {
        d.upstream.send(raw as Parameters<WebSocket["send"]>[0]);
      } catch {
        /* upstream gone */
      }
    } else if (d.queue.length >= MAX_QUEUED_FRAMES) {
      ws.close(1011, "proxy upstream did not open in time");
    } else {
      d.queue.push(raw as string | Uint8Array);
    }
  },

  close(ws: ServerWebSocket<ProxyWsData>) {
    try {
      ws.data.upstream?.close();
    } catch {
      /* already closed */
    }
    ws.data.upstream = null;
  },
};
