/**
 * GET /api/agents — install-status probe for every known agent.
 *
 * Detection is cached per process (see `agents.detectAgent`), so this
 * handler is cheap to call repeatedly. The welcome screen calls it once
 * on mount to dim agents that aren't installed and surface an install
 * hint before the user tries to launch one.
 */
import { AGENTS, detectAgent } from "../agents";
import type {
  AgentInstallStatus,
  AgentsStatusResponse,
  TerminalAgentId,
} from "../../shared/types";

export async function agentsHandler(): Promise<Response> {
  const ids = Object.keys(AGENTS) as TerminalAgentId[];
  const results = await Promise.all(
    ids.map(async (id): Promise<AgentInstallStatus> => {
      const spec = AGENTS[id];
      const binPath = await detectAgent(id);
      return {
        id,
        name: spec.name,
        installed: binPath !== null,
        binPath,
        installHint: spec.installHint,
      };
    }),
  );
  const body: AgentsStatusResponse = { agents: results };
  return Response.json(body);
}
