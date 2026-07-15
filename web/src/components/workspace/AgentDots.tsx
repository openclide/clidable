import { AGENTS, type AgentId } from "../welcome/data";
import { AgentIcon } from "../icons/AgentIcon";

interface Props {
  agents: AgentId[];
}

/**
 * Compact row of per-agent dots — icon only, no names. Shared footer
 * primitive for Skills / Plugins / MCP cards so they all read at a glance:
 * agents on the left, info on the right.
 */
export function AgentDots({ agents }: Props) {
  if (agents.length === 0) {
    return (
      <span className="text-[10.5px] text-foreground/35">No agents</span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {agents.map((id) => {
        const agent = AGENTS.find((a) => a.id === id);
        return (
          <span
            key={id}
            className="
              flex size-5 items-center justify-center rounded-full
              border border-white/[0.08] bg-white/[0.03]
            "
            title={agent?.name ?? id}
          >
            <AgentIcon id={id} size={10} className="opacity-90" />
          </span>
        );
      })}
    </span>
  );
}
