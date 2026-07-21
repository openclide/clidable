/**
 * Interactive terminal for the own-spawn dev server's PTY (M-F), shown as a
 * bottom sheet under the preview/code pane. Connects to /api/dev-terminal,
 * replays the buffered scrollback, then streams live output. Keystrokes are
 * forwarded to the PTY, so Ctrl-C interrupts the server, and any interactive
 * prompts can be answered inline.
 *
 * Reconnects on a short timer so a restart (or starting the server while the
 * panel is open) is picked up automatically.
 */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

interface Props {
  projectPath: string;
  /** Whether the dev server is actually serving (port-based, polled by the
   *  parent). The PTY connection below only says whether a *shell* is attached —
   *  the shell survives a crashed or interrupted dev command, so it can't be the
   *  source of truth for the "running" badge. */
  running: boolean;
  onClose: () => void;
}

/** State of the PTY connection, not of the dev server. */
type Status = "connecting" | "attached" | "external" | "inactive" | "exited";

export function DevTerminalPanel({ projectPath, running, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [port, setPort] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cols: 80,
      rows: 16,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.5,
      allowProposedApi: true,
      scrollback: 5000,
      theme: {
        background: "rgba(0,0,0,0)",
        foreground: "#d4d4d8",
        selectionBackground: "rgba(255,255,255,0.18)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // fall back to canvas/dom renderer
    }
    term.open(container);
    try {
      fit.fit();
    } catch {
      // container momentarily zero-sized
    }

    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    // Forward keystrokes to the PTY as binary frames. xterm hands us the input
    // string (incl. control chars like \x03 for Ctrl-C → SIGINT); the server
    // routes binary frames straight to the dev server's stdin.
    const enc = new TextEncoder();
    const inputDisp = term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(enc.encode(data));
    });

    // Skip redundant resizes — the full-width sheet's open animation changes
    // height (and fires the ResizeObserver) without changing cols/rows.
    let lastCols = 0;
    let lastRows = 0;
    const sendResize = () => {
      if (ws?.readyState !== WebSocket.OPEN) return;
      if (term.cols === lastCols && term.rows === lastRows) return;
      lastCols = term.cols;
      lastRows = term.rows;
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    const connect = () => {
      if (disposed) return;
      lastCols = lastRows = 0; // re-send size on the fresh connection
      // Tear down any prior socket + pending retry first, so a stale onclose
      // can't schedule a second reconnect chain (overlapping sockets/timers).
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch {
          // already closing
        }
      }
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(
        `${proto}//${location.host}/api/dev-terminal?projectPath=${encodeURIComponent(projectPath)}`,
      );
      ws.binaryType = "arraybuffer";

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          let msg: { type?: string; port?: number };
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (msg.type === "ready") {
            setStatus("attached");
            setPort(msg.port ?? null);
            term.clear(); // fresh start; the replay (binary) follows
            sendResize();
          } else if (msg.type === "external") {
            setStatus("external");
            setPort(msg.port ?? null);
          } else if (msg.type === "inactive") {
            setStatus("inactive");
          } else if (msg.type === "exit") {
            setStatus("exited");
          }
          return;
        }
        term.write(new Uint8Array(ev.data as ArrayBuffer));
      };

      ws.onclose = () => {
        if (disposed) return;
        // Reconnect so a (re)start of the dev server is picked up.
        setStatus((s) => (s === "attached" ? "exited" : s));
        retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };

    connect();

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        sendResize();
      } catch {
        // ignore transient zero-size
      }
    });
    ro.observe(container);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      ro.disconnect();
      inputDisp.dispose();
      ws?.close();
      term.dispose();
    };
  }, [projectPath]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px] text-foreground/65">
          <StatusDot running={running} status={status} />
          <span className="font-medium uppercase tracking-wide text-foreground/55">
            Dev server
          </span>
          {port != null && (
            <span className="font-mono text-foreground/40">:{port}</span>
          )}
          <span className="text-foreground/35">{statusLabel(running, status)}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Hide terminal"
          aria-label="Hide terminal"
          className="flex size-5 items-center justify-center rounded text-foreground/45 transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="relative min-h-0 flex-1 px-2 py-1.5">
        <div ref={containerRef} className="h-full w-full" />
        {status !== "attached" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-[11.5px] leading-relaxed text-foreground/40">
            {status === "external"
              ? "This dev server was started outside Clidable, so there's no terminal to attach. Stop it from the preview ■ to run it here instead."
              : status === "inactive"
                ? "Dev server isn't running — start it from the preview ▶"
                : status === "exited"
                  ? "Dev server stopped"
                  : "Connecting…"}
          </div>
        )}
      </div>
    </div>
  );
}

/** The badge reports the *server* (is the port serving?), not the shell — a
 *  shell whose dev command died is still alive and would otherwise read
 *  "running" over a blank preview. */
function statusLabel(running: boolean, status: Status): string {
  if (running) return status === "external" ? "running (external)" : "running";
  if (status === "connecting") return "connecting…";
  if (status === "attached") return "not running";
  return status === "exited" ? "stopped" : "not running";
}

function StatusDot({ running, status }: { running: boolean; status: Status }) {
  const color = running
    ? "bg-emerald-400/80"
    : status === "exited" || status === "attached"
      ? "bg-rose-400/70"
      : "bg-foreground/30";
  return <span aria-hidden className={`size-1.5 rounded-full ${color}`} />;
}
