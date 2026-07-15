import { AGENTS, type AgentId } from "./data";
import { AgentIcon } from "../icons/AgentIcon";
import { useAgentStatus } from "../../lib/use-agent-status";

interface Props {
  onPick: (id: AgentId) => void;
}

/**
 * Horizontal row of agent icons on the welcome screen.
 * Clicking one opens the project picker for that agent.
 *
 * Agents that aren't installed on PATH are dimmed and show their install
 * hint as a tooltip. They're still clickable — the workspace's
 * AGENT_NOT_FOUND error box still appears and points to the same hint —
 * but the visual cue surfaces the constraint upfront.
 */
export function AgentRow({ onPick }: Props) {
  const status = useAgentStatus();

  return (
    <div className="flex flex-wrap items-start justify-center gap-2 sm:gap-3">
      {AGENTS.map((agent) => {
        const installStatus = status?.get(agent.id);
        // `undefined` while loading → render as installed (neutral) so
        // we don't flash "missing" before the response lands.
        const isMissing = installStatus?.installed === false;
        const tooltip = isMissing
          ? `${agent.name} isn't on PATH. Install: ${installStatus?.installHint ?? ""}`
          : `Start with ${agent.name}`;
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => onPick(agent.id)}
            aria-label={tooltip}
            title={tooltip}
            className={`
              group relative flex w-[88px] flex-col items-center gap-2 rounded-xl
              px-2 py-3
              transition-[transform,background-color,border-color,box-shadow,opacity]
              duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]
              hover:-translate-y-0.5
              focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40
              ${isMissing ? "opacity-45 hover:opacity-80" : ""}
            `}
            style={
              {
                "--agent": agent.color,
              } as React.CSSProperties
            }
          >
            <span
              className="
                flex size-12 items-center justify-center rounded-2xl
                border border-white/[0.08]
                bg-white/[0.03]
                shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]
                transition-[background-color,border-color,box-shadow,transform]
                duration-200
                group-hover:border-[color:var(--agent)]/40
                group-hover:bg-[color:var(--agent)]/8
                group-hover:shadow-[0_4px_24px_-6px_var(--agent),inset_0_1px_0_rgba(255,255,255,0.08)]
                group-active:scale-[0.96]
              "
            >
              <AgentIcon id={agent.id} size={26} />
            </span>
            <span
              className="
                text-[11px] leading-tight text-center text-foreground/55
                transition-colors duration-200
                group-hover:text-foreground/85
              "
            >
              {agent.name}
            </span>
            {isMissing && (
              <span
                aria-hidden
                className="
                  absolute right-2 top-2 size-2 rounded-full
                  bg-amber-400/80
                  shadow-[0_0_6px_rgba(251,191,36,0.55)]
                "
                title="Not installed"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
