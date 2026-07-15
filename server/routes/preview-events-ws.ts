/**
 * WebSocket endpoint for `/api/preview-events`. One connection per project.
 *
 *   ws://host/api/preview-events?projectPath=<path>
 *
 * Pushes `PreviewEventMessage` text frames. On connect it replays the
 * already-detected dev servers (so a pane opened after the server booted
 * still sees them), then streams new detections live. No client→server
 * traffic — projectPath is in the URL, disconnect = unsubscribe.
 */
import type { ServerWebSocket } from "bun";
import { getDetections, subscribeDetections } from "../preview/detector";
import type { PreviewEventMessage } from "../../shared/types";

interface PreviewSocketData {
  projectPath: string;
  unsubscribe: (() => void) | null;
}

export const previewEventsWebSocketHandler = {
  open(ws: ServerWebSocket<PreviewSocketData>) {
    const { projectPath } = ws.data;
    try {
      send(ws, { type: "ready" });
      for (const d of getDetections(projectPath)) {
        send(ws, { type: "detected", terminalId: d.terminalId, url: d.url });
      }
      ws.data.unsubscribe = subscribeDetections(projectPath, (d) => {
        send(ws, { type: "detected", terminalId: d.terminalId, url: d.url });
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error(`[preview-events] open ${projectPath}:`, msg);
      send(ws, { type: "error", message: msg });
      ws.close();
    }
  },

  message(_ws: ServerWebSocket<PreviewSocketData>, _raw: string | Buffer) {
    // No client→server protocol.
  },

  close(ws: ServerWebSocket<PreviewSocketData>) {
    ws.data.unsubscribe?.();
    ws.data.unsubscribe = null;
  },
};

function send(
  ws: ServerWebSocket<PreviewSocketData>,
  msg: PreviewEventMessage,
): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // socket may have closed mid-flush
  }
}
