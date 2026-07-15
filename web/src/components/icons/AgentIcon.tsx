import type { CSSProperties } from "react";
import { AGENTS, type AgentId } from "../welcome/data";

interface Props {
  id: AgentId;
  size?: number;
  /** Override fill — defaults to the agent's brand color. Pass "currentColor"
   *  to inherit text color (useful when the icon sits in a colored chip). */
  fill?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Brand mark for a coding agent. SVG path data lives in data.ts.
 */
export function AgentIcon({ id, size = 24, fill, className, style }: Props) {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      fill={fill ?? agent.color}
      aria-label={agent.name}
      role="img"
    >
      <path d={agent.icon} />
    </svg>
  );
}
