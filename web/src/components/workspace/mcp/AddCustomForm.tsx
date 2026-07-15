import { useState } from "react";
import { AGENTS, type AgentId } from "../../welcome/data";
import { AgentIcon } from "../../icons/AgentIcon";
import {
  MCP_AGENT_TYPE,
  type McpScope,
  type McpServerSpec,
  type McpTransportType,
} from "@shared/types";

const TRANSPORTS: Array<{ id: McpTransportType; label: string; hint: string }> = [
  { id: "stdio", label: "stdio", hint: "npm package or command" },
  { id: "http", label: "http", hint: "remote HTTPS server" },
  { id: "sse", label: "sse", hint: "server-sent events stream" },
];

const SUPPORTED = Object.keys(MCP_AGENT_TYPE) as AgentId[];
const AGENT_ROWS = AGENTS.filter((a) => SUPPORTED.includes(a.id));

interface Row {
  id: string;
  name: string;
  value: string;
}

const newRow = (name = ""): Row => ({ id: crypto.randomUUID(), name, value: "" });

/** Prefill the form from a Discover catalog entry. */
export interface McpPrefill {
  name: string;
  transport: McpTransportType;
  /** stdio: package/command; http/sse: url. */
  source: string;
  /** Env (stdio) or header (http/sse) names to collect values for. */
  keys: string[];
}

export interface McpInstallRequest {
  name: string;
  agents: AgentId[];
  scope: McpScope;
  config: McpServerSpec;
}

interface Props {
  prefill?: McpPrefill | null;
  onInstall: (req: McpInstallRequest) => Promise<void>;
}

export function AddCustomForm({ prefill, onInstall }: Props) {
  const [name, setName] = useState(prefill?.name ?? "");
  const [source, setSource] = useState(prefill?.source ?? "");
  const [transport, setTransport] = useState<McpTransportType>(
    prefill?.transport ?? "stdio",
  );
  const [rows, setRows] = useState<Row[]>(
    prefill?.keys.length ? prefill.keys.map((name) => newRow(name)) : [newRow()],
  );
  const [agents, setAgents] = useState<Set<AgentId>>(new Set<AgentId>(["claude"]));
  const [scope, setScope] = useState<McpScope>("project");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStdio = transport === "stdio";
  const kvLabel = isStdio ? "Env vars" : "Headers";

  const toggleAgent = (id: AgentId) =>
    setAgents((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  function buildConfig(): McpServerSpec {
    const kv: Record<string, string> = {};
    for (const r of rows) if (r.name.trim()) kv[r.name.trim()] = r.value;
    if (isStdio) {
      const src = source.trim();
      const parts = src.split(/\s+/);
      const bare = parts.length === 1; // a bare package → run via npx
      return {
        transport,
        command: bare ? "npx" : parts[0],
        args: bare ? ["-y", src] : parts.slice(1),
        env: kv,
      };
    }
    return { transport, url: source.trim(), headers: kv };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onInstall({ name: name.trim(), agents: [...agents], scope, config: buildConfig() });
      // The modal navigates to Installed on success.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    name.trim().length > 0 && source.trim().length > 0 && agents.size > 0;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field label="Name" hint="A short id for the server (e.g. github, postgres).">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="github"
          className={INPUT}
        />
      </Field>

      <Field
        label="Source"
        hint={isStdio ? "npm package name or full command." : "HTTP(S) endpoint URL."}
      >
        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={
            isStdio
              ? "@modelcontextprotocol/server-github"
              : "https://mcp.host.com"
          }
          className={INPUT}
        />
      </Field>

      <Field
        label="Transport"
        hint="stdio launches a process; http/sse connects to a remote server."
      >
        <div className="flex flex-wrap gap-1.5">
          {TRANSPORTS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTransport(t.id)}
              aria-pressed={transport === t.id}
              title={t.hint}
              className={`
                rounded-lg px-3 py-1.5
                font-mono text-[11.5px] uppercase tracking-[0.1em]
                transition-[background-color,border-color,color] duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                ${
                  transport === t.id
                    ? "border border-white/[0.18] bg-white/[0.08] text-foreground"
                    : "border border-white/[0.06] bg-white/[0.02] text-foreground/55 hover:border-white/[0.12] hover:text-foreground/85"
                }
              `}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label={kvLabel}
        hint={
          isStdio
            ? "Environment variables passed to the process."
            : "Headers sent with each request (e.g. Authorization)."
        }
      >
        <div className="flex flex-col gap-1.5">
          {rows.map((row, i) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                type="text"
                value={row.name}
                onChange={(e) => updateRow(i, { name: e.target.value })}
                placeholder={isStdio ? "VARIABLE_NAME" : "Header-Name"}
                className="w-[200px] shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11.5px] text-foreground placeholder:text-foreground/30 outline-none focus:border-white/[0.16] focus:bg-white/[0.04] transition-[border-color,background-color]"
              />
              <span className="text-foreground/30">=</span>
              <input
                type="password"
                value={row.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                placeholder="value"
                className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11.5px] text-foreground placeholder:text-foreground/30 outline-none focus:border-white/[0.16] focus:bg-white/[0.04] transition-[border-color,background-color]"
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label="Remove row"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground/40 hover:bg-white/[0.06] hover:text-foreground/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M6 6l12 12M6 18L18 6" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="mt-1 flex items-center gap-1.5 self-start rounded-lg border border-dashed border-white/[0.14] px-2.5 py-1 text-[11px] text-foreground/55 hover:border-white/[0.28] hover:bg-white/[0.03] hover:text-foreground/85 transition-[background-color,border-color,color] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add {isStdio ? "env var" : "header"}
          </button>
        </div>
      </Field>

      <Field label="Install for agents" hint="Each agent gets its own config entry.">
        <div className="flex flex-wrap gap-1.5">
          {AGENT_ROWS.map((agent) => {
            const on = agents.has(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggleAgent(agent.id)}
                aria-pressed={on}
                className={`
                  flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px]
                  transition-[background-color,border-color,color] duration-150
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                  ${
                    on
                      ? "border border-[color:var(--agent)]/40 bg-[color:var(--agent)]/12 text-foreground"
                      : "border border-white/[0.08] bg-white/[0.02] text-foreground/55 hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-foreground/85"
                  }
                `}
                style={{ "--agent": agent.color } as React.CSSProperties}
              >
                <AgentIcon id={agent.id} size={11} className="shrink-0 opacity-90" />
                <span>{agent.name}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Scope" hint="Project: this repo only. Global: every project.">
        <div className="flex gap-1.5">
          {(["project", "global"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              className={`
                rounded-lg px-3 py-1.5 text-[11.5px] capitalize
                transition-[background-color,border-color,color] duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                ${
                  scope === s
                    ? "border border-white/[0.18] bg-white/[0.08] text-foreground"
                    : "border border-white/[0.06] bg-white/[0.02] text-foreground/55 hover:border-white/[0.12] hover:text-foreground/85"
                }
              `}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>

      {error && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-200">
          {error}
        </p>
      )}

      <div className="mt-1 flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="
            rounded-lg border border-white/[0.12] bg-white/[0.06]
            px-4 py-2 text-[12px] font-medium text-foreground
            transition-[background-color,border-color] duration-150
            hover:border-white/[0.22] hover:bg-white/[0.1]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
            disabled:cursor-not-allowed disabled:opacity-50
            disabled:hover:border-white/[0.12] disabled:hover:bg-white/[0.06]
          "
        >
          {submitting ? "Installing…" : "Install server"}
        </button>
      </div>
    </form>
  );
}

const INPUT =
  "w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 font-mono text-[12.5px] text-foreground placeholder:text-foreground/30 outline-none transition-[border-color,background-color,box-shadow] duration-150 focus:border-white/[0.2] focus:bg-white/[0.05] focus:shadow-[0_0_0_4px_rgba(255,255,255,0.03)]";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground/55">
          {label}
        </label>
        {hint && <span className="text-[10.5px] text-foreground/35">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
