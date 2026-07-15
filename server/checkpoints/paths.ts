/**
 * Filesystem layout for the checkpoint subsystem.
 *
 *   <data>/Clidable/projects/<uuid>/
 *     ├── checkpoints.git/      shadow bare-style git repo
 *     │     └── info/exclude    always-ignore list
 *     └── screenshots/          per-checkpoint PNGs (later)
 *
 *   <project>/.clidable/
 *     └── project-id            UUID file (kept inside the project so it
 *                                survives `mv`/`mv -i`/IDE rename)
 *
 * The UUID-keyed shadow path (rather than a hash of the project path)
 * is the key bug-fix over claudable-new: rename or move the project
 * folder, your checkpoints stay attached.
 */
import { join } from "node:path";
import { paths } from "../paths";

export const PROJECT_ID_DIR = ".clidable";
export const PROJECT_ID_FILE = "project-id";

export function projectIdFilePath(projectPath: string): string {
  return join(projectPath, PROJECT_ID_DIR, PROJECT_ID_FILE);
}

export function shadowGitDir(projectUuid: string): string {
  return join(paths.projects, projectUuid, "checkpoints.git");
}

export function screenshotsDir(projectUuid: string): string {
  return join(paths.projects, projectUuid, "screenshots");
}

export function shadowExcludeFile(projectUuid: string): string {
  return join(shadowGitDir(projectUuid), "info", "exclude");
}
