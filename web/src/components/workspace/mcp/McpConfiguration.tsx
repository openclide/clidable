import { useState, type ReactNode } from "react";
import type { AnyMcp } from "./data";

interface Props {
  server: AnyMcp;
}

/**
 * Read-only configuration table: transport / command / args / env vars (or
 * url / headers for HTTP). Sensitive values render masked with a `[reveal]`
 * affordance — mock-only for now (real secrets never round-trip).
 */
export function McpConfiguration({ server }: Props) {
  return (
    <div
      className="
        overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]
      "
    >
      <Row label="Transport">
        <span
          className="
            inline-flex items-center rounded-md
            border border-white/[0.08] bg-white/[0.03]
            px-1.5 py-0.5
            font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground/80
          "
        >
          {server.transport}
        </span>
      </Row>

      {server.transport === "stdio" ? (
        <>
          <Row label="Command">
            <code className="font-mono text-[11.5px] text-foreground/80">
              {server.command}
            </code>
          </Row>
          <Row label="Args">
            <code className="font-mono text-[11.5px] text-foreground/80">
              {(server.args ?? []).join(" ") || "—"}
            </code>
          </Row>
        </>
      ) : (
        <>
          <Row label="URL">
            <code className="font-mono text-[11.5px] text-foreground/80">
              {server.url}
            </code>
          </Row>
          {server.headers && server.headers.length > 0 && (
            <Row label="Headers">
              <div className="flex flex-col gap-1.5">
                {server.headers.map((h) => (
                  <SecretRow
                    key={h.name}
                    name={h.name}
                    preview={h.preview}
                  />
                ))}
              </div>
            </Row>
          )}
        </>
      )}

      {server.envVars.length > 0 && (
        <Row label="Env">
          <div className="flex flex-col gap-1.5">
            {server.envVars.map((v) => (
              <SecretRow key={v.name} name={v.name} preview={v.preview} />
            ))}
          </div>
        </Row>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="
        flex gap-3 px-4 py-2.5
        border-b border-white/[0.05] last:border-b-0
      "
    >
      <div className="w-[88px] shrink-0 self-center text-[10.5px] font-medium uppercase tracking-[0.12em] text-foreground/45">
        {label}
      </div>
      <div className="min-w-0 flex-1 self-center">{children}</div>
    </div>
  );
}

function SecretRow({ name, preview }: { name: string; preview?: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <code className="font-mono text-[11.5px] text-foreground/85">
        {name}
      </code>
      <span className="text-foreground/30">=</span>
      <code
        className={`
          font-mono text-[11.5px]
          ${revealed ? "text-emerald-300/85" : "text-foreground/55"}
        `}
      >
        {revealed ? preview ?? "(not set)" : "••••••••"}
      </code>
      {preview && (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="
            ml-auto text-[10px] uppercase tracking-wider
            text-foreground/40
            hover:text-foreground/80
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
          "
        >
          {revealed ? "hide" : "reveal"}
        </button>
      )}
    </div>
  );
}
