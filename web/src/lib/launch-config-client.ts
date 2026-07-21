/**
 * Client for the per-project dev-server launch config
 * (`<project>/.clidable/launch.json`, served by /api/projects/launch-config).
 *
 * The saved `config` holds only the user's overrides; `detected` is what
 * auto-detection would run, used to fill the form's placeholders so a blank
 * field visibly means "use the detected default".
 */
import type {
  LaunchConfig,
  LaunchConfigResponse,
  SaveLaunchConfigRequest,
} from "@shared/types";

export type { LaunchConfig, LaunchConfigResponse };

export async function getLaunchConfig(
  projectPath: string,
): Promise<LaunchConfigResponse> {
  const res = await fetch(
    `/api/projects/launch-config?projectPath=${encodeURIComponent(projectPath)}`,
  );
  if (!res.ok) throw await errFrom(res);
  return (await res.json()) as LaunchConfigResponse;
}

export async function saveLaunchConfig(
  projectPath: string,
  config: LaunchConfig,
): Promise<void> {
  const body: SaveLaunchConfigRequest = { projectPath, config };
  const res = await fetch("/api/projects/launch-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errFrom(res);
}

async function errFrom(res: Response): Promise<Error> {
  const parsed = await res.json().catch(() => ({ error: res.statusText }));
  return new Error((parsed as { error?: string }).error ?? `launch-config: ${res.status}`);
}
