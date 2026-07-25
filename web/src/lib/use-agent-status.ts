import { useEffect, useState } from "react";
import type {
  AgentInstallStatus,
  AgentsStatusResponse,
} from "@shared/types";
import type { AgentId } from "../components/welcome/data";

/**
 * Module-level cache + in-flight promise so the welcome-screen mount and
 * any other consumer share one fetch per page load.
 *
 * The cache is dropped when the window regains focus, because that is exactly
 * the moment a user comes back from installing an agent elsewhere — the server
 * re-probes misses (see server/agents.ts resolveBin), so a refetch is what
 * turns a dimmed tile live without restarting anything.
 */
let cache: Map<AgentId, AgentInstallStatus> | null = null;
let inflight: Promise<Map<AgentId, AgentInstallStatus>> | null = null;

async function loadAgents(): Promise<Map<AgentId, AgentInstallStatus>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch("/api/agents")
    .then((r): Promise<AgentsStatusResponse> => r.json())
    .then((data) => {
      const map = new Map<AgentId, AgentInstallStatus>();
      for (const a of data.agents) map.set(a.id, a);
      cache = map;
      inflight = null;
      return map;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

/**
 * Returns a Map<agentId, status> once the fetch resolves. While loading
 * the map is null — callers should treat that as "unknown" and render a
 * neutral state.
 */
export function useAgentStatus(): Map<AgentId, AgentInstallStatus> | null {
  const [map, setMap] = useState<Map<AgentId, AgentInstallStatus> | null>(
    cache,
  );
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      loadAgents()
        .then((next) => {
          if (!cancelled) setMap(next);
        })
        .catch(() => {
          // Network error — leave the map as-is so the UI stays neutral
          // rather than wrongly marking agents as missing.
        });
    };

    load();

    // Coming back to the window is the "I just installed it" signal.
    const onFocus = (): void => {
      cache = null;
      load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return map;
}
