/**
 * Shadow git operations: init, add+commit, status, head-sha.
 *
 * Every git invocation goes through `git()` which runs via Bun.spawn
 * with argv-style args (not shell strings — claudable-new escaped
 * message text with `.replace(/"/g, '\\"')` which fell over on
 * backticks and dollar signs).
 *
 * The shadow lives at `<data>/Clidable/projects/<uuid>/checkpoints.git`
 * with `--work-tree` pointing at the project. From git's perspective
 * the working tree is the project; from the project's perspective the
 * shadow .git doesn't exist (it's not at `<project>/.git`).
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runGit } from "../git-exec";
import { shadowExcludeFile, shadowGitDir } from "./paths";

/**
 * Patterns that should never enter a checkpoint regardless of the
 * project's own `.gitignore`. Build artifacts and dependency caches
 * dwarf real source by 10–100x and have zero value in a snapshot.
 *
 * `.clidable/` is here too — we don't want our own metadata file
 * (project-id) tracked by the snapshots that file enables.
 *
 * Patterns follow gitignore syntax. Lines are written verbatim into
 * the shadow's `info/exclude`.
 */
const ALWAYS_IGNORE: string[] = [
  "# clidable shadow-repo always-ignore (do not edit)",
  ".clidable/",
  "node_modules/",
  "**/node_modules/",
  ".next/",
  ".nuxt/",
  "dist/",
  "build/",
  "out/",
  "target/",
  "vendor/",
  ".turbo/",
  ".cache/",
  ".parcel-cache/",
  ".svelte-kit/",
  ".vite/",
  ".pnpm-store/",
  ".DS_Store",
  "Thumbs.db",
  "",
];

/**
 * Run git against the shadow repo with the project as working tree.
 * `args` is an argv array — no shell interpolation, no quoting issues.
 */
export function git(shadowDir: string, workTree: string, args: string[]) {
  return runGit([
    `--git-dir=${shadowDir}`,
    `--work-tree=${workTree}`,
    ...args,
  ]);
}

/**
 * Idempotent. On first call, runs `git init` + sets user identity. On
 * subsequent calls, skips the init/config dance. The always-ignore
 * file (`info/exclude`) is rewritten on every call so updates to
 * ALWAYS_IGNORE propagate to existing repos without a migration.
 */
export async function ensureShadowRepo(
  projectUuid: string,
  projectPath: string,
): Promise<void> {
  const shadow = shadowGitDir(projectUuid);

  const alreadyInit = await stat(shadow)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!alreadyInit) {
    await mkdir(dirname(shadow), { recursive: true });
    // `git init --bare` would refuse a work-tree; we want a normal
    // repo whose .git location happens to be the shadow path. The
    // shadow directory itself ends up holding HEAD, objects/, refs/.
    // No positional directory — `--git-dir` is enough on its own.
    const init = await git(shadow, projectPath, [
      "init",
      "--initial-branch=main",
      "--quiet",
    ]);
    if (init.exitCode !== 0) {
      throw new Error(`shadow init failed: ${init.stderr.trim()}`);
    }
    // These MUST run sequentially. Running them concurrently (Promise.all)
    // makes four `git config` processes contend on the same .git/config.lock;
    // whichever loses the lock exits non-zero, and since the exit code was
    // ignored the write was silently dropped — leaving the repo with no commit
    // identity, so every later checkpoint failed with "Author identity
    // unknown". Await each and surface a failure instead of swallowing it.
    const repoConfig: Array<[string, string]> = [
      ["user.name", "Clidable Checkpoints"],
      ["user.email", "checkpoints@clidable.dev"],
      // Don't fight the project's CRLF / autocrlf settings.
      ["core.autocrlf", "false"],
      // Tell git to track file modes consistently across platforms.
      ["core.fileMode", "false"],
    ];
    for (const [key, value] of repoConfig) {
      const res = await git(shadow, projectPath, ["config", key, value]);
      if (res.exitCode !== 0) {
        throw new Error(`shadow config ${key} failed: ${res.stderr.trim()}`);
      }
    }
  }

  // Always (re)write the exclude file so updates to ALWAYS_IGNORE
  // propagate on next checkpoint without manual migration.
  const excludePath = shadowExcludeFile(projectUuid);
  await mkdir(dirname(excludePath), { recursive: true });
  await writeFile(excludePath, ALWAYS_IGNORE.join("\n"), "utf8");
}

/**
 * `git add -A` — stages everything (respecting .gitignore +
 * info/exclude). Returns the porcelain status so callers can decide
 * noop vs commit without a second invocation.
 */
export async function stageAll(
  projectUuid: string,
  projectPath: string,
): Promise<{ porcelain: string }> {
  const shadow = shadowGitDir(projectUuid);
  const add = await git(shadow, projectPath, ["add", "-A"]);
  if (add.exitCode !== 0) {
    throw new Error(`shadow add failed: ${add.stderr.trim()}`);
  }
  const status = await git(shadow, projectPath, [
    "status",
    "--porcelain=v1",
  ]);
  if (status.exitCode !== 0) {
    throw new Error(`shadow status failed: ${status.stderr.trim()}`);
  }
  return { porcelain: status.stdout };
}

/**
 * Whether HEAD exists yet. Used to know if we're about to write the
 * first commit (which must use `--allow-empty` if the tree is empty,
 * else git refuses).
 */
export async function hasHead(
  projectUuid: string,
  projectPath: string,
): Promise<boolean> {
  const shadow = shadowGitDir(projectUuid);
  const res = await git(shadow, projectPath, ["rev-parse", "--verify", "HEAD"]);
  return res.exitCode === 0;
}

/**
 * Commit whatever is staged. Caller is responsible for not calling
 * this when the working tree is unchanged unless they explicitly want
 * a no-changes commit (we don't — noop checkpoints skip git and only
 * write a SQLite row).
 *
 * `--allow-empty` is set so the initial commit succeeds even on an
 * empty repo. Message goes through argv, never a shell.
 */
export async function commit(
  projectUuid: string,
  projectPath: string,
  message: string,
): Promise<string> {
  const shadow = shadowGitDir(projectUuid);
  // Supply the identity inline (`-c`) as well as via repo config. This makes
  // the commit independent of persisted config, so a repo that somehow lacks
  // user.name/user.email (e.g. one created before the config write was made
  // reliable) still commits instead of failing with "Author identity unknown".
  const res = await git(shadow, projectPath, [
    "-c",
    "user.name=Clidable Checkpoints",
    "-c",
    "user.email=checkpoints@clidable.dev",
    "commit",
    "--allow-empty",
    "--quiet",
    "-m",
    message,
  ]);
  if (res.exitCode !== 0) {
    throw new Error(`shadow commit failed: ${res.stderr.trim()}`);
  }
  const sha = await git(shadow, projectPath, ["rev-parse", "HEAD"]);
  if (sha.exitCode !== 0) {
    throw new Error(`shadow rev-parse failed: ${sha.stderr.trim()}`);
  }
  return sha.stdout.trim();
}
