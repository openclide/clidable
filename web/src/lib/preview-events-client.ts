/**
 * Client for `/api/preview-events` — the dev-server URL detections for a
 * project. Opens one WebSocket per previewed project and accumulates the
 * detected loopback URLs (server replays existing ones on connect).
 */
import { useEffect, useState } from "react";
import type { PreviewEventMessage } from "@shared/types";

export interface DetectedServer {
  terminalId: string;
  url: string;
}

export function useDevServerDetections(
  projectPath: string | null,
): DetectedServer[] {
  const [servers, setServers] = useState<DetectedServer[]>([]);

  useEffect(() => {
    setServers([]);
    if (!projectPath) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/preview-events?projectPath=${encodeURIComponent(projectPath)}`;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    // Reconnect on drop (server restart / network blip) — the server replays
    // existing detections on connect, so the list (deduped) repopulates.
    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(url);
      } catch {
        retry = setTimeout(connect, 2000);
        return;
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as PreviewEventMessage;
          if (msg.type === "detected") {
            setServers((prev) =>
              prev.some((s) => s.url === msg.url)
                ? prev
                : [...prev, { terminalId: msg.terminalId, url: msg.url }],
            );
          }
        } catch {
          // ignore malformed frame
        }
      };
      ws.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      ws?.close();
      ws = null;
    };
  }, [projectPath]);

  return servers;
}
