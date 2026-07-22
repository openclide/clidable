/**
 * New-project scaffolding (§7). Creates a project folder under a chosen
 * parent dir, runs the framework's official scaffolder non-interactively,
 * `git init`s, and registers it in the project registry.
 *
 * Safety / robustness:
 *  - The name is sanitized; the target must not already exist.
 *  - Scaffolders are spawned with **stdin closed** (`stdin: "ignore"`) + CI=1
 *    so an interactive prompt can never hang the server — it gets EOF and
 *    either uses defaults or fails fast. A hard timeout kills runaways.
 *  - The "blank" template needs no network/toolchain — the always-works path.
 *  - We never `rm -rf` on failure (don't risk destroying data); we report the
 *    error + the partial path and let the user clean up.
 *
 * NOTE: per CLAUDE.md we never scaffold *our own* repo with these tools —
 * but spawning them to create the *user's* project is exactly the feature.
 */
import { mkdir, readdir, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectTemplateId } from "../../shared/types";
import { openProject } from "./index";
import { runGit } from "../git-exec";
import type { Project } from "../../shared/types";

const SCAFFOLD_TIMEOUT_MS = 4 * 60_000; // 4 min — npm installs can be slow

/** Build the scaffolder argv for a template. Run with cwd = parentDir; the
 *  scaffolder creates the `<name>` subdir itself. `null` = handled specially
 *  (blank). */
function scaffoldCommand(
  template: ProjectTemplateId,
  name: string,
): string[] | null {
  switch (template) {
    case "blank":
      return null;
    case "vite-react":
      return ["bun", "create", "vite", name, "--template", "react-ts"];
    case "vite-svelte":
      return ["bun", "create", "vite", name, "--template", "svelte-ts"];
    case "vite-vue":
      return ["bun", "create", "vite", name, "--template", "vue-ts"];
    case "nextjs":
      // --skip-install: we run a single uniform `bun install` afterwards so
      // every template lands ready-to-start the same way (no double install).
      return [
        "bunx",
        "create-next-app@latest",
        name,
        "--ts",
        "--tailwind",
        "--eslint",
        "--app",
        "--src-dir",
        "--use-bun",
        "--no-import-alias",
        "--no-turbopack",
        "--skip-install",
      ];
    case "astro":
      return [
        "bunx",
        "create-astro@latest",
        name,
        "--template",
        "minimal",
        "--no-install",
        "--no-git",
        "--skip-houston",
        "--yes",
      ];
    case "hono":
      // Unlike the others, create-hono has no --skip-install: it *always* asks
      // "install dependencies?" unless --install is passed, and with stdin
      // closed that prompt throws (while still exiting 0 — see the empty-output
      // guard below). --pm picks the manager its second prompt would ask for.
      // The uniform `bun install` afterwards is then a cheap no-op.
      return [
        "bunx",
        "create-hono@latest",
        name,
        "--template",
        "bun",
        "--pm",
        "bun",
        "--install",
      ];
    case "expo":
      // `default` is Expo's own recommended starting point: expo-router (file
      // based routing, the React Native analogue of Next's App Router) plus
      // TypeScript — so this matches how we treat Next.js rather than the
      // stripped-down `blank`.
      //
      // Deliberately NOT passing --no-agents-md: create-expo-app writes
      // AGENTS.md, CLAUDE.md and .claude/settings.json by default, which for a
      // tool whose whole purpose is running coding agents is the feature, not
      // noise. It also runs `git init` itself; ensureGitRepo already no-ops
      // when the scaffolder got there first.
      return [
        "bunx",
        "create-expo-app@latest",
        name,
        "--template",
        "default",
        "--no-install",
        "--yes",
      ];
  }
}

export interface ScaffoldInput {
  parentDir: string;
  name: string;
  template: ProjectTemplateId;
}

export async function scaffoldProject(input: ScaffoldInput): Promise<Project> {
  const name = sanitizeName(input.name);
  if (!name) throw new Error("invalid project name");

  // Parent must exist and be a directory.
  const parentStat = await stat(input.parentDir).catch(() => null);
  if (!parentStat || !parentStat.isDirectory()) {
    throw new Error(`parent directory not found: ${input.parentDir}`);
  }

  const target = join(input.parentDir, name);
  // Target must not already exist — refuse to scaffold over anything.
  if (await pathExists(target)) {
    throw new Error(`a file or folder named "${name}" already exists here`);
  }

  const cmd = scaffoldCommand(input.template, name);
  if (cmd === null) {
    // Blank: no toolchain, nothing to install — it's an empty folder.
    await scaffoldBlank(target, name);
  } else {
    const stderr = await runScaffolder(cmd, input.parentDir);
    await assertProducedFiles(target, name, cmd, stderr);
    // Install deps so the project is immediately startable (▶). Uniform
    // across templates — the scaffolders themselves are inconsistent about it.
    await installDeps(target);
  }

  await ensureGitRepo(target);
  return openProject(target);
}

/**
 * `bun install` in the scaffolded project so it's ready to `dev` right away.
 * Best-effort: a failed install (offline, registry hiccup) must not undo a
 * scaffolded project — the files + git already exist and the user can retry.
 */
async function installDeps(target: string): Promise<void> {
  if (!(await pathExists(join(target, "package.json")))) return;
  try {
    const { exitCode, stderr, timedOut } = await spawnWithTimeout(
      ["bun", "install"],
      target,
      { ...process.env, CI: "1" },
    );
    if (timedOut || exitCode !== 0) {
      console.error(
        `[scaffold] bun install failed (${timedOut ? "timeout" : exitCode}): ${stderr.slice(0, 500)}`,
      );
    }
  } catch (e) {
    console.error("[scaffold] bun install error:", (e as Error).message);
  }
}

/* --- blank template: pure-local, no network --- */

async function scaffoldBlank(target: string, name: string): Promise<void> {
  await mkdir(target, { recursive: true });
  await Bun.write(
    join(target, "package.json"),
    JSON.stringify({ name, private: true, version: "0.0.0" }, null, 2) + "\n",
  );
  await Bun.write(join(target, "README.md"), `# ${name}\n`);
}

/* --- spawn a child with a hard timeout, draining stderr as it streams --- */

interface SpawnResult {
  exitCode: number;
  stderr: string;
  timedOut: boolean;
}

/**
 * stdin closed, stdout discarded, stderr drained concurrently — so a chatty
 * child can't fill an un-drained pipe buffer, block on write, and hang until
 * the timeout. Shared by the scaffolder and `bun install`.
 */
async function spawnWithTimeout(
  cmd: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<SpawnResult> {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const stderrPromise = new Response(proc.stderr).text().catch(() => "");
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, SCAFFOLD_TIMEOUT_MS);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  return { exitCode, stderr: await stderrPromise, timedOut };
}

/**
 * A zero exit code is not proof a scaffolder worked. create-hono creates the
 * target directory, hits its "install dependencies?" prompt, throws on our
 * closed stdin — and *still* exits 0, leaving an empty folder we'd happily
 * register as a project. So the contract is "did it actually write files?",
 * checked for every template rather than patched per scaffolder.
 *
 * An empty leftover is removed so the user can retry the same name. `rmdir`
 * (not `rm -rf`) does that safely: it refuses any directory that isn't empty,
 * so it can never take real files with it.
 */
export async function assertProducedFiles(
  target: string,
  name: string,
  cmd: string[],
  stderr: string,
): Promise<void> {
  const entries = await readdir(target).catch(() => null);
  if (entries && entries.length > 0) return;
  if (entries) await rmdir(target).catch(() => {});
  const detail = stderr.trim().slice(-500);
  throw new Error(
    // The whole command, not cmd[1] — for the vite templates that word is
    // "create" (`bun create vite …`), which names nothing the user can act on.
    `\`${cmd.join(" ")}\` exited successfully but created no files in "${name}" — ` +
      `it likely asked a question (scaffolders run non-interactively here).` +
      (detail ? `\n${detail}` : ""),
  );
}

/* --- run a scaffolder non-interactively --- */

/** Runs the scaffolder and returns its stderr, which is the only clue when a
 *  scaffolder fails while reporting success. */
async function runScaffolder(cmd: string[], cwd: string): Promise<string> {
  const { exitCode, stderr, timedOut } = await spawnWithTimeout(cmd, cwd, {
    ...process.env,
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    ASTRO_TELEMETRY_DISABLED: "1",
    ADBLOCK: "1",
    DISABLE_OPENCOLLECTIVE: "1",
  });
  if (timedOut) {
    throw new Error(`scaffold timed out after ${SCAFFOLD_TIMEOUT_MS}ms`);
  }
  if (exitCode !== 0) {
    throw new Error(
      `scaffold command failed (exit ${exitCode}): ${cmd.join(" ")}\n${stderr.slice(0, 1500)}`,
    );
  }
  return stderr;
}

/* --- git init + initial commit (best-effort) --- */

async function ensureGitRepo(target: string): Promise<void> {
  if (await pathExists(join(target, ".git"))) return; // scaffolder already did it

  // Best-effort via the shared runGit (argv-style, `-C` to scope). git missing
  // or a commit failure (e.g. nothing to commit) must not sink creation. The
  // `-c user.*` avoids "tell me who you are" on machines with no git identity.
  if ((await runGit(["-C", target, "init"])).exitCode !== 0) return;
  await runGit(["-C", target, "add", "-A"]);
  await runGit([
    "-C",
    target,
    "-c",
    "user.email=clidable@localhost",
    "-c",
    "user.name=Clidable",
    "commit",
    "-m",
    "Initial commit",
  ]);
}

/* --- helpers --- */

/** Allow letters, digits, dot, dash, underscore. Strip the rest; no path
 *  separators or `..` can survive. */
function sanitizeName(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-") // collapse dash runs
    .replace(/^[.\-]+/, "") // strip leading dots/dashes
    .replace(/[.\-]+$/, ""); // strip trailing dots/dashes
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
