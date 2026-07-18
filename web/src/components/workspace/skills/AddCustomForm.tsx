import { useState } from "react";
import { AGENTS, type AgentId } from "../../welcome/data";
import { AgentIcon } from "../../icons/AgentIcon";
import type { SkillScope } from "@shared/types";

/**
 * "Add custom" skill form. Collects a source (owner/repo, URL, or local path),
 * which agents to install for, and the scope, then hands them to the modal's
 * install flow (→ /api/skills/add). The skill name is derived from the source's
 * last path segment.
 */
export function AddCustomForm({
  onInstall,
  busy,
  disabled = false,
}: {
  /** Install the source for the picked agents/scope; resolves true on success
   *  (the form clears its source field then). */
  onInstall: (args: {
    source: string;
    agents: AgentId[];
    scope: SkillScope;
  }) => Promise<boolean>;
  busy: boolean;
  /** No active project → nothing to install into. */
  disabled?: boolean;
}) {
  const [source, setSource] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<Set<AgentId>>(
    new Set<AgentId>(["claude"]),
  );
  const [scope, setScope] = useState<SkillScope>("project");

  const canSubmit =
    !disabled && !busy && source.trim().length > 0 && selectedAgents.size > 0;

  const toggleAgent = (id: AgentId) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        const ok = await onInstall({
          source: source.trim(),
          agents: [...selectedAgents],
          scope,
        });
        if (ok) setSource("");
      }}
      className="flex flex-col gap-5"
    >
      {/* Source input */}
      <Field
        label="Source"
        hint="A single skill: owner/repo, a repo subpath, or a local skill folder. The name is the last path segment."
      >
        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="owner/my-skill  ·  or  ·  ~/skills/my-skill"
          className="
            w-full rounded-xl
            border border-white/[0.08] bg-white/[0.03]
            px-3.5 py-2.5
            font-mono text-[12.5px] text-foreground
            placeholder:text-foreground/30
            outline-none
            transition-[border-color,background-color,box-shadow] duration-150
            focus:border-white/[0.2] focus:bg-white/[0.05]
            focus:shadow-[0_0_0_4px_rgba(255,255,255,0.03)]
          "
        />
      </Field>

      {/* Agent selection */}
      <Field
        label="Install for agents"
        hint="Pick which agents should have this skill. You can change this later."
      >
        <div className="flex flex-wrap gap-1.5">
          {AGENTS.map((agent) => {
            const on = selectedAgents.has(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggleAgent(agent.id)}
                aria-pressed={on}
                className={`
                  flex items-center gap-1.5 rounded-full
                  px-2.5 py-1 text-[11.5px]
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

      {/* Scope */}
      <Field
        label="Scope"
        hint="Global: available in every project. Project: only this one."
      >
        <div className="flex gap-1.5">
          {(["global", "project"] as const).map((s) => (
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

      {/* Submit */}
      <div className="mt-1 flex items-center justify-end gap-3">
        <span className="text-[11px] text-foreground/35">
          {disabled
            ? "Open a project to install skills."
            : "Installs via the skills CLI into the selected agents."}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="
            rounded-lg
            border border-white/[0.12] bg-white/[0.06]
            px-4 py-2 text-[12px] font-medium text-foreground
            transition-[background-color,border-color] duration-150
            hover:border-white/[0.22] hover:bg-white/[0.1]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
            disabled:cursor-not-allowed disabled:opacity-50
            disabled:hover:border-white/[0.12] disabled:hover:bg-white/[0.06]
          "
        >
          {busy ? "Installing…" : "Install skill"}
        </button>
      </div>
    </form>
  );
}

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
      <div className="flex items-baseline justify-between">
        <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground/55">
          {label}
        </label>
        {hint && <span className="text-[10.5px] text-foreground/35">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
