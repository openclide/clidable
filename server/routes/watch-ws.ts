/**
 * WebSocket endpoint for `/api/watch`. One connection per project.
 *
 * Wire-up:
 *   ws://host/api/watch?projectPath=<path>
 *
 * Server pushes JSON text frames typed by `WatchServerMessage`. No
 * client→server traffic is needed — the projectPath is in the URL,
 * and disconnect = unsubscribe. Keep-alive is the browser's default
 * WS ping/pong; nothing app-level needed for v1.
 *
 * The handler attaches its unsubscribe-from-watcher closure to the
 * socket's data, so `close()` can tear it down without us having to
 * remember per-socket state in a separate map.
 */
import type { ServerWebSocket } from "bun";
import { watchProject } from "../watcher";
import type { WatchServerMessage } from "../../shared/types";

interface WatchSocketData {
  unsubscribe: (() => void) | null;
}

export const watchWebSocketHandler = {
  open(ws: ServerWebSocket<WatchSocketData>) {
    // `ws.data` was set in the upgrade handler — projectPath came in
    // on the URL. We attach the subscriber here so it lives for the
    // lifetime of the WS.
    const projectPath = (ws.data as WatchSocketData & { projectPath: string })
      .projectPath;
    try {
      const unsub = watchProject(projectPath, (paths) => {
        sendServer(ws, { type: "changed", paths: [...paths] });
      });
      ws.data.unsubscribe = unsub;
      sendServer(ws, { type: "ready" });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error(`[watch-ws] open ${projectPath}:`, msg);
      sendServer(ws, { type: "error", message: msg });
      ws.close();
    }
  },

  message(_ws: ServerWebSocket<WatchSocketData>, _raw: string | Buffer) {
    // No client→server protocol. We ignore any incoming frames.
  },

  close(ws: ServerWebSocket<WatchSocketData>) {
    ws.data.unsubscribe?.();
    ws.data.unsubscribe = null;
  },
};

function sendServer(
  ws: ServerWebSocket<WatchSocketData>,
  msg: WatchServerMessage,
): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Connection might have closed mid-flush. Drop silently.
  }
}
