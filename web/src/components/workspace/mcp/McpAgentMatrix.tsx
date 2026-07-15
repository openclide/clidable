import { useEffect, useState } from "react";
import { AGENTS, type AgentId } from "../../welcome/data";
import { AgentIcon } from "../../icons/AgentIcon";
import { MCP_AGENT_TYPE, MCP_GLOBAL_ONLY_AGENTS, type McpScope } from "@shared/types";

/**
 * The detail view's install/agents control (PLAN.md §4). Per-agent (MCP is
 * genuinely per-agent), with a Project | Global scope toggle. Two modes:
 *   • "install" — a not-yet-installed server (from Discover): agents
 *     pre-selected, collect secret values the catalog config declares, install
 *     into the chosen scope.
 *   • "manage"  — an installed server: per-scope add/remove (the checked agents
 *     are the ones configured in that scope; copy/remove on Apply).
 */
const SUPPORTED = Object.keys(MCP_AGENT_TYPE) as AgentId[];
const ROWS = AGENTS.filter((a) => SUPPORTED.includes(a.id));

interface Props {
  /** Agents that have this server, per scope (live). */
  installedByScope: Record<McpScope, AgentId[]>;
  defaultScope: McpScope;
  /** Not configured in any scope → install mode (collect catalog secrets). */
  fresh: boolean;
  secretKeys: string[];
  secretLabel: string;
  busyKey: string | null;
  serverKey: string;
  onApply: (
    scope: McpScope,
    toInstall: AgentId[],
    toRemove: AgentId[],
    secrets: Record<string, string>,
  ) => void;
}

export function McpAgentMatrix({
  installedByScope,
  defaultScope,
  fresh,
  secretKeys,
  secretLabel,
  busyKey,
  serverKey,
  onApply,
}: Props) {
  const [scope, setScope] = useState<McpScope>(defaultScope);
  const installedAgents = installedByScope[scope];

  // Global-only agents (e.g. Antigravity) have no per-project MCP config — add-mcp
  // writes their single global file — so a project-scope pick would silently land
  // globally (the server rejects it too). Disable them at project scope.
  const unavailable = (id: AgentId) =>
    scope === "project" && MCP_GLOBAL_ONLY_AGENTS.has(id);

  const [selected, setSelected] = useState<Set<AgentId>>(
    () => new Set(fresh ? SUPPORTED : installedByScope[defaultScope]),
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  // Re-seed when the scope flips: install mode keeps all checked; manage mode
  // reflects that scope's configured agents.
  useEffect(() => {
    setSelected(new Set(fresh ? SUPPORTED : installedByScope[scope]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, installedByScope]);

  const busy = busyKey === `${serverKey}:apply`;
  const toInstall = [...selected].filter(
    (a) => !installedAgents.includes(a) && !unavailable(a),
  );
  const toRemove = installedAgents.filter((a) => !selected.has(a));
  const changed = toInstall.length > 0 || toRemove.length > 0;
  // Count only selectable picks so the fresh-install summary/guard ignore a
  // still-checked but now-disabled global-only agent after a scope flip.
  const selectableCount = [...selected].filter((a) => !unavailable(a)).length;

  const toggle = (id: AgentId) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-foreground/40">
          {scope === "global"
            ? "Configured under your home — all projects."
            : "Configured in this project."}
        </span>
        <ScopeSegment value={scope} onChange={setScope} disabled={busy} />
      </div>

      <ul className="grid grid-cols-2 gap-1.5">
        {ROWS.map((agent) => {
          const checked = selected.has(agent.id);
          const installed = installedAgents.includes(agent.id);
          const blocked = unavailable(agent.id);
          return (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => toggle(agent.id)}
                disabled={busy || blocked}
                aria-pressed={checked && !blocked}
                title={blocked ? "Antigravity MCP is global only — switch scope to Global." : undefined}
                className="
                  flex w-full items-center gap-3 rounded-xl text-left
                  border border-white/[0.06] bg-white/[0.02]
                  px-3 py-2.5
                  transition-[border-color,background-color] duration-150
                  hover:border-white/[0.12] hover:bg-white/[0.035]
                  disabled:cursor-not-allowed disabled:opacity-60
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                "
              >
                <Checkbox checked={checked} />
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#0d0d12]">
                  <AgentIcon id={agent.id} size={14} className="opacity-90" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium">{agent.name}</div>
                  <div className="text-[10.5px] uppercase tracking-wider text-foreground/40">
                    {blocked ? "global only" : installed ? "configured" : "not configured"}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {fresh && secretKeys.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-foreground/45">
            {secretLabel}
          </div>
          {secretKeys.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-[200px] shrink-0 truncate font-mono text-[11.5px] text-foreground/70">
                {key}
              </span>
              <span className="text-foreground/30">=</span>
              <input
                type="password"
                value={secrets[key] ?? ""}
                onChange={(e) =>
                  setSecrets((prev) => ({ ...prev, [key]: e.target.value }))
                }
                placeholder="value"
                className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11.5px] text-foreground placeholder:text-foreground/30 outline-none focus:border-white/[0.16] focus:bg-white/[0.04] transition-[border-color,background-color]"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-[11px] text-foreground/40">
          {fresh
            ? selectableCount === 0
              ? "Pick at least one agent."
              : `Install for ${selectableCount} agent${selectableCount === 1 ? "" : "s"} · ${scope}`
            : changed
              ? `${changeSummary(toInstall.length, toRemove.length)} · ${scope}`
              : "Tick the agents to configure this server for."}
        </span>
        <button
          type="button"
          disabled={busy || (fresh ? selectableCount === 0 : !changed)}
          onClick={() => onApply(scope, toInstall, toRemove, secrets)}
          className="
            shrink-0 rounded-lg px-4 py-1.5 text-[12px] font-medium
            border border-accent/40 bg-accent/15 text-foreground
            transition-[background-color,border-color] duration-150
            hover:border-accent/60 hover:bg-accent/25
            disabled:cursor-not-allowed disabled:border-white/[0.08]
            disabled:bg-white/[0.03] disabled:text-foreground/40
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
          "
        >
          {busy ? "Applying…" : fresh ? "Install" : "Apply changes"}
        </button>
      </div>
    </div>
  );
}

const SCOPE_OPTS: Array<{ id: McpScope; label: string }> = [
  { id: "project", label: "Project" },
  { id: "global", label: "Global" },
];

function ScopeSegment({
  value,
  onChange,
  disabled,
}: {
  value: McpScope;
  onChange: (s: McpScope) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative flex h-8 shrink-0 items-center rounded-lg bg-white/[0.03] p-0.5">
      <span
        aria-hidden
        className="absolute inset-y-0.5 w-[calc(50%-2px)] rounded-md bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        style={{ transform: `translateX(${value === "global" ? 100 : 0}%)` }}
      />
      {SCOPE_OPTS.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`
            relative z-[1] flex h-full items-center rounded-md px-3
            text-[11.5px] tracking-tight transition-colors duration-150
            disabled:cursor-not-allowed
            ${value === o.id ? "text-foreground" : "text-foreground/55 hover:text-foreground/85"}
          `}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function changeSummary(install: number, remove: number): string {
  const parts: string[] = [];
  if (install) parts.push(`add to ${install}`);
  if (remove) parts.push(`remove from ${remove}`);
  return parts.join(" · ");
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`
        flex size-[18px] shrink-0 items-center justify-center rounded-md border
        transition-colors duration-150
        ${checked ? "border-accent/60 bg-accent/80 text-white" : "border-white/20 bg-white/[0.03] text-transparent"}
      `}
    >
      <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
      </svg>
    </span>
  );
}
