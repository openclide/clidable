/**
 * The agent's icon, replaced by a colored status dot only while the session is
 * actively working (blue, pulsing) or blocked waiting on the user (amber). At
 * idle — or before any status is reported — it shows the plain AgentIcon, so the
 * dot is a real activity/attention signal rather than a permanent "on" light.
 */
import type { AgentId } from "../welcome/data";
import { AgentIcon } from "../icons/AgentIcon";
import { useAgentStatus } from "@/lib/agent-status";

// Only the non-idle states get a dot; idle falls back to the icon. A small
// glowing core (soft halo via box-shadow) matches Clidable's glass style —
// working breathes; blocked holds a steadier, brighter amber to pull the eye.
const DOT: Record<"working" | "blocked", string> = {
  working:
    "bg-sky-400 shadow-[0_0_9px_-1px_rgba(56,189,248,0.85)] animate-pulse",
  blocked: "bg-amber-400 shadow-[0_0_10px_0_rgba(251,191,36,0.9)]",
};

const LABEL: Record<"working" | "blocked", string> = {
  working: "Agent working",
  blocked: "Agent needs input",
};

export function AgentStatusIcon({
  instanceId,
  agentId,
  size = 12,
  className = "",
}: {
  instanceId: string;
  agentId: AgentId;
  size?: number;
  className?: string;
}) {
  const status = useAgentStatus(instanceId);
  // Idle (or no status yet) → the agent's icon, so the dot only appears when
  // there's something to signal.
  if (status !== "working" && status !== "blocked") {
    return <AgentIcon id={agentId} size={size} className={className} />;
  }
  // A dot noticeably smaller than the icon slot it occupies, centered so the
  // layout stays put when swapping between icon and dot.
  const dot = Math.max(6, Math.round(size * 0.55));
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="img"
      title={LABEL[status]}
      aria-label={LABEL[status]}
    >
      <span
        className={`block rounded-full ${DOT[status]}`}
        style={{ width: dot, height: dot }}
      />
    </span>
  );
}
