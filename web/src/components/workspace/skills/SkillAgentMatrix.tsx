import { useEffect, useState } from "react";
import { AgentIcon } from "../../icons/AgentIcon";
import type { AgentId } from "../../welcome/data";
import { SKILL_BUCKET_AGENTS, type SkillBucket, type SkillScope } from "@shared/types";

/**
 * Per-bucket install selector (PLAN.md §4). Buckets, not per-agent: at project
 * scope the universal agents share `.agents/skills` (and `~/.agents/skills` at
 * global scope), so they move together.
 *
 * UX: choose a scope (Project | Global) right next to the action, tick the
 * buckets, hit one button. The bucket checkboxes reflect that scope's current
 * install state; applying installs newly-checked buckets and removes
 * newly-unchecked ones.
 */
const ROWS: Array<{
  bucket: SkillBucket;
  label: string;
  agents: AgentId[];
  hint?: string;
}> = [
  { bucket: "claude", label: "Claude Code", agents: SKILL_BUCKET_AGENTS.claude },
  {
    bucket: "universal",
    label: "Universal",
    agents: SKILL_BUCKET_AGENTS.universal,
    hint: "One shared folder (.agents/skills) — these agents install together.",
  },
  {
    bucket: "qwen",
    label: "Qwen Code",
    agents: SKILL_BUCKET_AGENTS.qwen,
    hint: "Qwen reads its own .qwen/skills folder.",
  },
];
const ALL_BUCKETS = ROWS.map((r) => r.bucket);

interface Props {
  /** Buckets the skill occupies in each scope (live). */
  installedByScope: Record<SkillScope, SkillBucket[]>;
  /** False when there's no known source repo to install from. */
  installable: boolean;
  /** Busy key in flight, matched against `<skillKey>:apply`. */
  busyKey: string | null;
  skillKey: string;
  /** Scope to open on. */
  defaultScope: SkillScope;
  onApply: (
    scope: SkillScope,
    toInstall: SkillBucket[],
    toRemove: SkillBucket[],
  ) => void;
}

export function SkillAgentMatrix({
  installedByScope,
  installable,
  busyKey,
  skillKey,
  defaultScope,
  onApply,
}: Props) {
  const [scope, setScope] = useState<SkillScope>(defaultScope);
  const installedBuckets = installedByScope[scope];

  // Selection defaults to the current scope's install state (or everything for
  // a fresh skill), and re-seeds whenever the scope flips.
  const [selected, setSelected] = useState<Set<SkillBucket>>(
    () => new Set(installedBuckets.length ? installedBuckets : ALL_BUCKETS),
  );
  useEffect(() => {
    const live = installedByScope[scope];
    setSelected(new Set(live.length ? live : ALL_BUCKETS));
    // Re-seed on scope flip (and when this skill's install state changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, installedByScope]);

  const busy = busyKey === `${skillKey}:apply`;
  const toInstall = [...selected].filter((b) => !installedBuckets.includes(b));
  const toRemove = installedBuckets.filter((b) => !selected.has(b));
  const changed = toInstall.length > 0 || toRemove.length > 0;
  // We can add a bucket when we have a source repo (fresh fetch) OR the skill
  // is already in this scope (the server copies it from the existing bucket).
  const canInstall = installable || installedBuckets.length > 0;
  const blocked = toInstall.length > 0 && !canInstall;
  const fresh = installedBuckets.length === 0;

  const toggle = (b: SkillBucket) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(b) ? next.delete(b) : next.add(b);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      {/* "Agents" heading with the scope selector on the far right. */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-foreground/45">
          Agents
        </h3>
        <ScopeSegment value={scope} onChange={setScope} disabled={busy} />
      </div>

      <ul className="flex flex-col gap-1.5">
        {ROWS.map(({ bucket, label, agents, hint }) => {
          const checked = selected.has(bucket);
          const installed = installedBuckets.includes(bucket);
          return (
            <li key={bucket}>
              <button
                type="button"
                onClick={() => toggle(bucket)}
                disabled={busy}
                aria-pressed={checked}
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
                <span className="flex shrink-0 items-center -space-x-1.5">
                  {agents.map((id) => (
                    <span
                      key={id}
                      className="
                        flex size-7 items-center justify-center rounded-lg
                        border border-white/[0.08] bg-[#0d0d12]
                      "
                    >
                      <AgentIcon id={id} size={14} className="opacity-90" />
                    </span>
                  ))}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">{label}</div>
                  <div className="text-[10.5px] uppercase tracking-wider text-foreground/40">
                    {installed ? "installed" : "not installed"}
                  </div>
                  {hint && (
                    <div className="mt-0.5 text-[10.5px] text-foreground/35">
                      {hint}
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-[11px] text-foreground/40">
          {blocked
            ? "No source repo — can't install."
            : changed
              ? changeSummary(toInstall, toRemove, scope)
              : fresh
                ? "Tick the agents to install for."
                : "Already up to date here — nothing to apply."}
        </span>
        <button
          type="button"
          disabled={busy || !changed || blocked}
          onClick={() => onApply(scope, toInstall, toRemove)}
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

function changeSummary(
  toInstall: SkillBucket[],
  toRemove: SkillBucket[],
  scope: SkillScope,
): string {
  const where = scope === "global" ? "all your projects" : "this project";
  if (toInstall.length && toRemove.length) {
    return `Apply changes in ${where}`;
  }
  if (toInstall.length) {
    return scope === "global"
      ? `Install ${toInstall.length} globally — available across all your projects`
      : `Install ${toInstall.length} in this project — committed to the repo`;
  }
  return `Remove ${toRemove.length} from ${where}`;
}

const SCOPE_OPTS: Array<{ id: SkillScope; label: string; title: string }> = [
  { id: "project", label: "Project", title: "This repo — committed, shared with the team" },
  { id: "global", label: "Global", title: "Your home — available across all projects" },
];

function ScopeSegment({
  value,
  onChange,
  disabled,
}: {
  value: SkillScope;
  onChange: (s: SkillScope) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative flex h-8 shrink-0 items-center rounded-lg bg-white/[0.03] p-0.5">
      <span
        aria-hidden
        className="
          absolute inset-y-0.5 w-[calc(50%-2px)] rounded-md
          bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]
          transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        "
        style={{ transform: `translateX(${value === "global" ? 100 : 0}%)` }}
      />
      {SCOPE_OPTS.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title}
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

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`
        flex size-[18px] shrink-0 items-center justify-center rounded-md border
        transition-colors duration-150
        ${
          checked
            ? "border-accent/60 bg-accent/80 text-white"
            : "border-white/20 bg-white/[0.03] text-transparent"
        }
      `}
    >
      <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
      </svg>
    </span>
  );
}
