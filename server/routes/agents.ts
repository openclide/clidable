/**
 * GET /api/agents — install-status probe for every known agent.
 *
 * Successful detections are cached per process (see `agents.resolveBin`);
 * misses are re-probed, so an agent installed after startup shows up on the
 * next call. The welcome screen calls this on mount to dim agents that aren't
 * installed before the user tries to launch one.
 */
import { AGENTS, detectAgent } from "../agents";
import { AGENT_INSTALL_DOCS } from "../../shared/types";
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
        installUrl: AGENT_INSTALL_DOCS[id],
      };
    }),
  );
  const body: AgentsStatusResponse = { agents: results };
  return Response.json(body);
}
