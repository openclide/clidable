import { SKILL_BUCKET_AGENTS, type SkillBucket } from "@shared/types";
import type { AgentId } from "../../welcome/data";
import { AgentIcon } from "../../icons/AgentIcon";

const BUCKETS: Array<{ id: SkillBucket; label: string; hint?: string }> = [
  { id: "claude", label: "Claude Code" },
  {
    id: "universal",
    label: "Universal",
    hint: "Codex, Cursor, Antigravity, OpenCode, Copilot, Kimi — one shared folder, so they install together.",
  },
  { id: "qwen", label: "Qwen Code" },
];

interface Props {
  /** Lead agents (always whole buckets). */
  selected: AgentId[];
  onChange: (next: AgentId[]) => void;
}

/**
 * Bucket-based lead selector — mirrors the Skills manager. Role skills install
 * into bucket dirs (`.claude/skills`, the shared `.agents/skills`, `.qwen/skills`),
 * so the universal agents can't be toggled apart: you pick buckets, not agents.
 */
export function LeadAgentCheckboxes({ selected, onChange }: Props) {
  const sel = new Set(selected);
  const toggleBucket = (bucket: SkillBucket) => {
    const agents = SKILL_BUCKET_AGENTS[bucket];
    const on = agents.every((a) => sel.has(a));
    const next = new Set(sel);
    for (const a of agents) on ? next.delete(a) : next.add(a);
    onChange([...next]);
  };

  return (
    <ul className="flex flex-col gap-1.5">
      {BUCKETS.map(({ id, label, hint }) => {
        const agents = SKILL_BUCKET_AGENTS[id];
        const on = agents.every((a) => sel.has(a));
        return (
          <li key={id}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleBucket(id);
              }}
              aria-pressed={on}
              className={`
                flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left
                transition-[background-color,border-color] duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                ${
                  on
                    ? "border-white/[0.18] bg-white/[0.05]"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.035]"
                }
              `}
            >
              <Check on={on} />
              <span className="flex shrink-0 items-center -space-x-1.5">
                {agents.map((a) => (
                  <span
                    key={a}
                    className="flex size-7 items-center justify-center rounded-lg border border-white/[0.08] bg-[#0d0d12]"
                  >
                    <AgentIcon id={a} size={13} className="opacity-90" />
                  </span>
                ))}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium">{label}</div>
                {hint && <div className="mt-0.5 text-[10.5px] text-foreground/40">{hint}</div>}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`
        flex size-[18px] shrink-0 items-center justify-center rounded-md border
        transition-colors duration-150
        ${on ? "border-accent/60 bg-accent/80 text-white" : "border-white/20 bg-white/[0.03] text-transparent"}
      `}
    >
      <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
      </svg>
    </span>
  );
}
