import { RoleGlyph } from "./RoleGlyph";
import { RoleToggle } from "./RoleToggle";
import { HandlerPicker } from "./HandlerPicker";
import { AGENTS, type AgentId } from "../../welcome/data";
import { AgentIcon } from "../../icons/AgentIcon";
import type { Role } from "./data";

interface Props {
  role: Role;
  onToggle: (enabled: boolean) => void;
  onHandlerChange: (next: AgentId) => void;
  onSelect: () => void;
}

export function RoleCard({ role, onToggle, onHandlerChange, onSelect }: Props) {
  const handlerColor =
    AGENTS.find((a) => a.id === role.handlerAgent)?.color ?? "currentColor";

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`
        group relative flex cursor-pointer items-start gap-3 overflow-hidden
        rounded-xl border px-4 py-3.5
        transition-[border-color,background-color,transform] duration-150
        hover:-translate-y-px hover:border-white/[0.14]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        ${
          role.enabled
            ? "border-white/[0.08] bg-white/[0.03]"
            : "border-white/[0.05] bg-white/[0.015]"
        }
      `}
    >
      <span
        className={`
          flex size-9 shrink-0 items-center justify-center rounded-xl
          border transition-[background-color,border-color,color] duration-150
          ${
            role.enabled
              ? "border-white/[0.08] bg-white/[0.04] text-foreground/85"
              : "border-white/[0.06] bg-white/[0.02] text-foreground/45"
          }
        `}
      >
        <RoleGlyph id={role.glyph} size={17} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`
              truncate text-[13px] font-medium tracking-tight
              transition-colors duration-150
              ${role.enabled ? "text-foreground" : "text-foreground/55"}
            `}
          >
            {role.name}
          </span>
          {role.isCustom && (
            <span className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.02] px-1.5 py-px text-[9.5px] font-medium uppercase tracking-[0.1em] text-foreground/45">
              custom
            </span>
          )}
          <span className="ml-auto shrink-0">
            <RoleToggle on={role.enabled} onChange={onToggle} size="sm" />
          </span>
        </div>

        <p className="mt-1 line-clamp-1 text-[12px] text-foreground/55">
          {role.description}
        </p>

        {/* Bottom row — handler + leads */}
        <div
          className={`
            mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5
            transition-opacity duration-150
            ${role.enabled ? "opacity-100" : "opacity-60"}
          `}
        >
          <span className="text-[10.5px] uppercase tracking-wider text-foreground/40">
            Handled by
          </span>
          <span onClick={(e) => e.stopPropagation()}>
            <HandlerPicker
              value={role.handlerAgent}
              onChange={onHandlerChange}
              size="sm"
            />
          </span>

          <span aria-hidden className="text-foreground/20">·</span>

          <span className="text-[10.5px] uppercase tracking-wider text-foreground/40">
            For
          </span>
          <LeadAgentStack leads={role.enabledForLeads} />
        </div>
      </div>
    </article>
  );
}

function LeadAgentStack({ leads }: { leads: AgentId[] }) {
  if (leads.length === 0) {
    return (
      <span className="text-[10.5px] text-foreground/35">No lead agents</span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {leads.map((id) => (
        <span
          key={id}
          className="
            flex size-5 items-center justify-center rounded-full
            border border-white/[0.08] bg-white/[0.025]
          "
          title={id}
        >
          <AgentIcon id={id} size={10} className="opacity-90" />
        </span>
      ))}
    </span>
  );
}
