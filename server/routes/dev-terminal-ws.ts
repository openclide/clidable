/**
 * WebSocket endpoint for `/api/dev-terminal`. Streams the own-spawn dev
 * server's PTY output for one project into a read-only xterm panel.
 *
 *   ws://host/api/dev-terminal?projectPath=<path>
 *
 * Framing:
 *   • server → client BINARY frames = raw PTY bytes (replay buffer first, then
 *     live output). Rendered directly by xterm.
 *   • server → client TEXT frames = JSON control:
 *       { type: "ready", port }   — attached to a shell we spawned
 *       { type: "external", port }— a dev server we adopted (no shell to attach)
 *       { type: "inactive" }      — no dev server running for this project
 *       { type: "exit" }          — the dev server stopped
 *   • client → server BINARY frames = stdin (keystrokes, Ctrl-C, …) → PTY.
 *   • client → server TEXT frames = JSON: { type: "resize", cols, rows }
 *     so the PTY wraps output to the panel width.
 */
import type { ServerWebSocket } from "bun";
import {
  adoptedDevServerPort,
  attachDevTerminal,
  killDevServerPort,
  resizeDevTerminal,
  writeDevTerminal,
} from "../projects/dev-server";

const ETX = 3; // Ctrl-C

export interface DevTerminalSocketData {
  projectPath: string;
  detach: (() => void) | null;
}

export const devTerminalWebSocketHandler = {
  open(ws: ServerWebSocket<DevTerminalSocketData>) {
    const { projectPath } = ws.data;
    const handle = attachDevTerminal(
      projectPath,
      (chunk) => sendBytes(ws, chunk),
      () => sendJson(ws, { type: "exit" }),
    );
    if (!handle) {
      // Distinguish "nothing is running" from "it's running, but we didn't
      // spawn it" — the latter has no PTY to attach, which isn't a failure.
      const external = adoptedDevServerPort(projectPath);
      sendJson(ws, external != null ? { type: "external", port: external } : { type: "inactive" });
      // Close so the client's reconnect timer fires — otherwise an open panel
      // would never pick up a dev server that starts later.
      ws.close();
      return;
    }
    ws.data.detach = handle.unsubscribe;
    sendJson(ws, { type: "ready", port: handle.port });
    // Replay synchronously (no await) before any live chunk can interleave.
    if (handle.replay.byteLength > 0) sendBytes(ws, handle.replay);
  },

  message(ws: ServerWebSocket<DevTerminalSocketData>, raw: string | Buffer) {
    if (typeof raw !== "string") {
      // binary frame = stdin (typing, Ctrl-C, …) → straight to the shell PTY.
      writeDevTerminal(ws.data.projectPath, raw);
      // The shell returns to a prompt on \x03, but `bun run dev`'s real server
      // orphans and keeps the port — kill it by port so Ctrl-C actually stops
      // it (and stops its output spamming the prompt).
      if (raw.includes(ETX)) void killDevServerPort(ws.data.projectPath);
      return;
    }
    let msg: { type?: string; cols?: number; rows?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      msg.type === "resize" &&
      Number.isInteger(msg.cols) &&
      Number.isInteger(msg.rows) &&
      msg.cols! > 0 &&
      msg.rows! > 0
    ) {
      resizeDevTerminal(ws.data.projectPath, msg.cols!, msg.rows!);
    }
  },

  close(ws: ServerWebSocket<DevTerminalSocketData>) {
    ws.data.detach?.();
    ws.data.detach = null;
  },
};

function sendBytes(ws: ServerWebSocket<DevTerminalSocketData>, bytes: Uint8Array): void {
  try {
    ws.send(bytes);
  } catch {
    // connection closed mid-flush
  }
}

function sendJson(
  ws: ServerWebSocket<DevTerminalSocketData>,
  msg: Record<string, unknown>,
): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // connection closed mid-flush
  }
}
