/**
 * OS-appropriate paths for Clidable's persistent state.
 *
 * macOS    → ~/Library/Application Support/Clidable/   (data)
 *            ~/Library/Caches/Clidable/                 (cache)
 *            ~/Library/Logs/Clidable/                   (logs)
 * Linux    → $XDG_DATA_HOME/clidable                    (data)
 *            $XDG_CACHE_HOME/clidable                   (cache)
 *            $XDG_STATE_HOME/clidable                   (logs)
 * Windows  → %APPDATA%\Clidable\Data\                   (data)
 *            %LOCALAPPDATA%\Clidable\Cache\             (cache)
 *            %LOCALAPPDATA%\Clidable\Logs\              (logs)
 *
 * See PLAN.md "Foundation" for the rationale.
 */
import envPaths from "env-paths";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const APP_NAME = "Clidable";

const base = envPaths(APP_NAME, { suffix: "" });

export const paths = {
  data: base.data,
  cache: base.cache,
  log: base.log,
  config: base.config,
  temp: base.temp,
  // Derived locations
  projects: join(base.data, "projects"),
  db: join(base.data, "clidable.db"),
  pluginCache: join(base.cache, "plugins"),
  skillCache: join(base.cache, "skills"),
  // Composer attachments (pasted images, dropped files). Saved server-side so
  // the absolute path we hand the agent exists on the machine the agent runs
  // on — identical in browser / Tauri / remote-server mode.
  attachments: join(base.data, "attachments"),
  // Holds the generated `clidable` shim; prepended to spawned-agent PATHs so AI
  // Team delegation (`clidable team delegate …`) resolves inside Clidable.
  bin: join(base.data, "bin"),
  // Singleton daemon PID lockfile — {pid, port} written by the server on boot,
  // read by `clidable open`/`stop` to attach to or stop the running server.
  serverLock: join(base.data, "server.lock"),
} as const;

/**
 * Create all base directories on startup. Idempotent.
 */
export function ensureDirs(): void {
  for (const dir of [
    paths.data,
    paths.cache,
    paths.log,
    paths.projects,
    paths.pluginCache,
    paths.skillCache,
    paths.attachments,
    paths.bin,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Per-project data directory under <data>/projects/<uuid>/.
 * The UUID is the project's stable ID (stored in <project>/.clidable/project-id).
 */
export function projectDataDir(uuid: string): string {
  return join(paths.projects, uuid);
}
