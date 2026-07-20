import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { AGENTS, getAgent, type AgentId } from "../welcome/data";
import { terminalClient } from "../../lib/terminal-client";
import type { TerminalAgentId } from "@shared/types";

interface Props {
  sessionId: string;
  agentId: AgentId;
  projectPath: string;
}

// Agents that must use xterm's DOM renderer instead of WebGL. Their TUIs paint
// background-styled "chip" cells that WebGL renders as solid gray blocks over
// the transparent terminal background; the DOM renderer composites them
// cleanly. Everyone else gets WebGL (seamless block art, e.g. Claude's banner).
const DOM_RENDERER_AGENTS = new Set<AgentId>(["codex"]);

/**
 * One xterm.js terminal mounted to a div, wired to the multiplexed
 * terminal WebSocket client. On mount it opens (or attaches to) the
 * session; on unmount it unsubscribes but lets the PTY keep running so
 * a remount restores the buffer.
 */
export function TerminalView({ sessionId, agentId, projectPath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [exited, setExited] = useState<{ code: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: true,
      // Treat a bare \n as \r\n. A full-screen TUI (Codex) puts the PTY in raw
      // mode (onlcr off), so any bare line-feed it emits would otherwise leave
      // the cursor mid-row and text drifts right across the line. Harmless for
      // agents that already emit \r\n (the extra CR is a no-op). Matches
      // claudable-new, which renders Codex correctly.
      convertEol: true,
      // Match Tailwind's default `font-mono` stack so the real terminal
      // looks like the workspace mock did. SFMono-Regular renders well
      // on macOS; the rest covers Linux + Windows fallback.
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      // Integer font size (not 12.5) so glyph cells stay crisp under WebGL —
      // terax-ai rounds its size for the same reason.
      fontSize: 13,
      lineHeight: 1.2,
      // No letterSpacing: a non-zero value accumulates sub-pixel drift across a
      // line, so glyphs and their background cells misalign. Keep the default 0.
      allowProposedApi: true,
      // Let the transparent theme background composite so the container's glass
      // shows through (vs being drawn opaque).
      allowTransparency: true,
      scrollback: 5000,
      theme: {
        // Fully transparent — the pane's glass shows through.
        background: "rgba(0,0,0,0)",
        foreground: "#e5e5e5",
        cursor: getAgent(agentId).color,
        cursorAccent: "#0c0c10",
        selectionBackground: "rgba(255,255,255,0.18)",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    // Renderer per agent (see DOM_RENDERER_AGENTS above): WebGL for everyone
    // except the styled-TUI agents that break under it, which stay on the DOM
    // renderer.
    if (!DOM_RENDERER_AGENTS.has(agentId)) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // fall back to the DOM renderer
      }
    }

    term.open(container);
    try {
      fit.fit();
    } catch {
      // ignore — happens if the container has zero size momentarily.
    }

    // Resize observer so the PTY tracks the container size live —
    // matches VS Code / iTerm behavior where the agent redraws during
    // the drag rather than waiting for the user to settle.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore — happens if the container has zero size momentarily.
      }
    });
    ro.observe(container);

    // User input → PTY stdin.
    const enc = new TextEncoder();
    const dataDisp = term.onData((d) => {
      terminalClient.write(sessionId, enc.encode(d));
    });

    // xterm size → PTY size. The server delivers SIGWINCH so the agent
    // redraws its current frame at the new dimensions. We don't touch
    // the existing scrollback — TUI agents draw boxes with absolute
    // cursor positions, so historical content can't reflow at a new
    // width. Matches the standard tmux / iTerm behavior.
    const resizeDisp = term.onResize(({ cols, rows }) => {
      terminalClient.resize(sessionId, cols, rows);
    });

    // Subscribe to session output.
    const dispose = terminalClient.open(
      sessionId,
      agentId as TerminalAgentId,
      projectPath,
      term.cols,
      term.rows,
      {
        onOutput: (data) => term.write(data),
        onReady: () => setError(null),
        onExit: (code) => setExited({ code }),
        onError: (code, message) => setError({ code, message }),
      },
    );

    return () => {
      dispose();
      dataDisp.dispose();
      resizeDisp.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [sessionId, agentId, projectPath]);

  return (
    <div className="relative flex h-full min-h-0 flex-col px-4 pt-3">
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />
      {(error || exited) && (
        <Overlay>
          {error ? (
            <ErrorBox
              code={error.code}
              message={error.message}
              agent={getAgent(agentId)}
            />
          ) : (
            <ExitedBox code={exited!.code} />
          )}
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto max-w-[420px]">{children}</div>
    </div>
  );
}

function ErrorBox({
  code,
  message,
  agent,
}: {
  code: string;
  message: string;
  agent: ReturnType<typeof getAgent>;
}) {
  const spec = AGENTS.find((a) => a.id === agent.id);
  const installHint =
    code === "AGENT_NOT_FOUND"
      ? installHintFor(agent.id as TerminalAgentId)
      : null;
  return (
    <div
      className="
        glass rounded-2xl p-4
        text-[12px] leading-relaxed text-foreground/85
      "
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: spec?.color }}
          aria-hidden
        />
        <span className="font-medium tracking-tight text-foreground">
          {spec?.name ?? agent.id} — couldn't start
        </span>
      </div>
      <p className="text-foreground/65">{message}</p>
      {installHint && (
        <pre className="
          mt-3 rounded-lg
          border border-white/[0.08] bg-white/[0.02]
          px-3 py-2 font-mono text-[11.5px]
          text-foreground/85 select-all
        ">
          {installHint}
        </pre>
      )}
    </div>
  );
}

function ExitedBox({ code }: { code: number }) {
  return (
    <div
      className="
        glass rounded-2xl px-4 py-3
        text-[12px] text-foreground/65
      "
    >
      Session exited with code {code}. Close this tab to free it.
    </div>
  );
}

/**
 * Mirror of the server-side `AGENTS` registry. Kept tiny + duplicated
 * (rather than importing the server module) so frontend bundles don't
 * pull in Bun-only code.
 */
function installHintFor(id: TerminalAgentId): string {
  switch (id) {
    case "claude":
      return "npm i -g @anthropic-ai/claude-code";
    case "codex":
      return "npm i -g @openai/codex";
    case "antigravity":
      return "curl -fsSL https://antigravity.google/cli/install.sh | bash";
    case "cursor":
      return "Install Cursor and enable the `cursor-agent` CLI.";
    case "qwen":
      return "npm i -g @qwen-code/qwen-code";
    case "kimi":
      return "Install the Kimi CLI from Moonshot AI's docs.";
    case "opencode":
      return "npm i -g opencode";
    case "copilot":
      return "npm i -g @github/copilot";
    case "terminal":
      // Always installed (your login shell) — this hint is never shown.
      return "Uses your login shell ($SHELL).";
  }
}
