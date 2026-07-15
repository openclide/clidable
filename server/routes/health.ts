import type { HealthResponse } from "../../shared/types";
import packageJson from "../../package.json" with { type: "json" };

const startedAt = performance.now();

export function healthHandler(): Response {
  const body: HealthResponse = {
    ok: true,
    version: packageJson.version,
    uptimeMs: Math.round(performance.now() - startedAt),
    shell: "server",
  };
  return Response.json(body);
}
