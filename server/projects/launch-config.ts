/**
 * Per-project dev-server launch config — `<project>/.clidable/launch.json`.
 *
 * Two jobs:
 *  1. Auto-detect the best way to run a project (package manager from the
 *     lockfile × the dev/start/serve script × the framework's port + how it
 *     takes a port) so a fresh project "just works" with no config.
 *  2. Let the user override any of {command, port, url}, persisted server-side
 *     so it travels with the repo and holds across browsers/machines (the
 *     address bar is only a per-browser transient). The `url` override is what
 *     makes a remote/Tailscale deployment previewable — the iframe loads it
 *     directly instead of `http://localhost:<port>`.
 *
 * Mirrors the `.clidable/ai-team.json` config pattern (server/team/config.ts):
 * a missing file falls back to detection, and every read is coerced so a
 * hand-edited file can't break start.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJson, pathExists } from "../util/fs";
import type { LaunchConfig, LaunchPlan, ProjectFramework } from "../../shared/types";

const CONFIG_REL = ".clidable/launch.json";
const configPath = (projectPath: string): string => join(projectPath, CONFIG_REL);

export type PackageManager = "bun" | "pnpm" | "npm" | "yarn";
/** How a framework's dev server takes its port: a CLI flag (vite family) or the
 *  PORT env var (next/node family). */
export type PortInjection = "flag" | "env";

interface FrameworkLaunch {
  defaultPort: number;
  inject: PortInjection;
  /**
   * Script names to prefer over the default dev → start → serve order.
   * Needed when a framework ships one dev server PER PLATFORM: Expo's `start`
   * is the native Metro TUI (QR code, device menu) with no web page to preview,
   * while `web` is the browser dev server.
   */
  scripts?: readonly string[];
  /**
   * Omit the `--host 127.0.0.1` flag. Some CLIs take a MODE there rather than
   * an address — Expo's `--host` is lan|tunnel|localhost and exits 1 on an IP
   * (measured). Expo binds all interfaces anyway, so loopback still reaches it.
   */
  noHostFlag?: boolean;
}

/** Port convention + injection style per framework. Absent = no known web dev
 *  server (python/rust/go/expo/unknown) — those are configured by hand. */
const FRAMEWORK_LAUNCH: Partial<Record<ProjectFramework, FrameworkLaunch>> = {
  vite: { defaultPort: 5173, inject: "flag" },
  sveltekit: { defaultPort: 5173, inject: "flag" },
  astro: { defaultPort: 4321, inject: "flag" },
  nextjs: { defaultPort: 3000, inject: "env" },
  nuxt: { defaultPort: 3000, inject: "env" },
  remix: { defaultPort: 3000, inject: "env" },
  hono: { defaultPort: 3000, inject: "env" },
  node: { defaultPort: 3000, inject: "env" },
  // Expo's own `--help` claims `--port` "does not apply to web". It does:
  // `expo start --web --port 8099` serves on 8099 (measured). That matters —
  // without an injectable port every Expo project would want 8081, and the
  // second one opened in a workspace would report the FIRST one's URL.
  expo: { defaultPort: 8081, inject: "flag", scripts: ["web"], noHostFlag: true },
};

/* --- config file I/O (coerced both ways so the file is always well-formed) --- */

/** Read + validate the saved overrides. Missing/malformed → `{}` (all detected). */
export async function readLaunchConfig(projectPath: string): Promise<LaunchConfig> {
  const raw = await readJson<Record<string, unknown>>(configPath(projectPath));
  return coerceConfig(raw);
}

/** Persist the overrides, dropping blank/invalid fields. Saving a form with no
 *  overrides left **removes** the file rather than leaving an inert `{}` behind,
 *  so "no config" looks the same on disk however the project got there. */
export async function writeLaunchConfig(
  projectPath: string,
  config: LaunchConfig,
): Promise<void> {
  const clean = coerceConfig(config);
  const file = configPath(projectPath);
  if (Object.keys(clean).length === 0) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
}

function coerceConfig(raw: unknown): LaunchConfig {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: LaunchConfig = {};
  if (typeof r.command === "string" && r.command.trim()) out.command = r.command.trim();
  const port = coercePort(r.port);
  if (port !== null) out.port = port;
  if (typeof r.url === "string" && r.url.trim()) out.url = r.url.trim();
  return out;
}

function coercePort(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/* --- auto-detection --- */

/** Pick the package manager from the lockfile. Defaults to bun (the runtime is
 *  bun and `bun run <script>` executes any package.json script regardless of
 *  which manager installed node_modules). */
export async function detectPackageManager(projectPath: string): Promise<PackageManager> {
  // One round of stats rather than five sequential ones; precedence is applied
  // after, so the result is identical to checking them in order.
  const [bunLock, bunLockb, pnpm, yarn, npm] = await Promise.all([
    pathExists(join(projectPath, "bun.lock")),
    pathExists(join(projectPath, "bun.lockb")),
    pathExists(join(projectPath, "pnpm-lock.yaml")),
    pathExists(join(projectPath, "yarn.lock")),
    pathExists(join(projectPath, "package-lock.json")),
  ]);
  if (bunLock || bunLockb) return "bun";
  if (pnpm) return "pnpm";
  if (yarn) return "yarn";
  if (npm) return "npm";
  return "bun";
}

/** The dev script to run. `prefer` (a framework's own ordering) wins, then the
 *  generic `dev` → `start` → `serve`. Null when the project has no package.json
 *  scripts, or none of the candidate names. */
export async function detectScript(
  projectPath: string,
  prefer: readonly string[] = [],
): Promise<string | null> {
  const pkg = await readJson<{ scripts?: Record<string, unknown> }>(
    join(projectPath, "package.json"),
  );
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== "object") return null;
  for (const name of [...prefer, "dev", "start", "serve"]) {
    if (typeof (scripts as Record<string, unknown>)[name] === "string") return name;
  }
  return null;
}

/**
 * Build the shell command for a detected project, injecting `port` the way the
 * framework expects. Flag-based tools (vite family) get `--port`/`--host`;
 * env-based tools (next/node family) get a `PORT=` prefix. npm needs `--` to
 * forward flags to the script; pnpm/yarn/bun forward directly.
 */
export function buildCommand(
  pm: PackageManager,
  script: string,
  inject: PortInjection,
  port: number,
  noHostFlag = false,
): string {
  const runner = pm === "bun" ? "bun run" : pm === "npm" ? "npm run" : pm; // pnpm/yarn: `pnpm dev`
  if (inject === "flag") {
    const flags = noHostFlag ? `--port ${port}` : `--port ${port} --host 127.0.0.1`;
    const sep = pm === "npm" ? " -- " : " ";
    return `${runner} ${script}${sep}${flags}`;
  }
  return `PORT=${port} ${runner} ${script}`;
}

/** Auto-detected launch plan for a project — the "just works" defaults and the
 *  config form's placeholders. Uses the framework's default port for display;
 *  the real start may free-scan from there (see resolveLaunch). */
export async function detectLaunchPlan(
  projectPath: string,
  framework: ProjectFramework,
): Promise<LaunchPlan> {
  const fw = FRAMEWORK_LAUNCH[framework];
  // No framework plan → nothing to probe for; skip the filesystem entirely.
  if (!fw) return { command: "", port: 3000, url: "", runnable: false };
  const [script, pm] = await Promise.all([
    detectScript(projectPath, fw.scripts),
    detectPackageManager(projectPath),
  ]);
  if (!script) {
    return { command: "", port: fw.defaultPort, url: "", runnable: false };
  }
  const command = buildCommand(pm, script, fw.inject, fw.defaultPort, fw.noHostFlag);
  return {
    command,
    port: fw.defaultPort,
    url: `http://localhost:${fw.defaultPort}`,
    runnable: true,
  };
}

/* --- resolution used by the dev server --- */

export interface ResolvedLaunch {
  /** A user-configured command to run verbatim, or null to build the detected one. */
  customCommand: string | null;
  /** Detected runner pieces (to build the command with the final port), or null
   *  when the project isn't runnable via detection. */
  detected: {
    pm: PackageManager;
    script: string;
    inject: PortInjection;
    noHostFlag: boolean;
  } | null;
  /** A fixed port to bind (from config.port or the config.url's port), or null
   *  to free-scan from defaultPort. */
  fixedPort: number | null;
  /** Framework default port to scan from / fall back to. */
  defaultPort: number;
  /** Preview URL override (loaded directly by the iframe), or null. */
  urlOverride: string | null;
}

/**
 * Merge saved overrides with auto-detection into the inputs the dev server
 * needs. The command is intentionally NOT finalized here — the caller picks the
 * port first (free-scan vs fixed) and then builds the detected command with
 * that exact port, so an injected `--port` always matches what we probe.
 */
export async function resolveLaunch(
  projectPath: string,
  framework: ProjectFramework,
): Promise<ResolvedLaunch> {
  const fw = FRAMEWORK_LAUNCH[framework];
  const defaultPort = fw?.defaultPort ?? 3000;

  // Independent reads — issue them together. The script/pm probes are only
  // meaningful with a framework plan, so they're skipped without one.
  const [config, script, pm] = await Promise.all([
    readLaunchConfig(projectPath),
    fw ? detectScript(projectPath, fw.scripts) : Promise.resolve(null),
    fw ? detectPackageManager(projectPath) : Promise.resolve<PackageManager>("bun"),
  ]);

  return {
    customCommand: config.command ?? null,
    // Detected runner is only usable with both a framework plan and a script.
    detected:
      fw && script
        ? { pm, script, inject: fw.inject, noHostFlag: fw.noHostFlag ?? false }
        : null,
    fixedPort: config.port ?? portFromUrl(config.url) ?? null,
    defaultPort,
    urlOverride: config.url ?? null,
  };
}

/**
 * The **explicit** port in a configured URL (so `url: …:3000` implies binding
 * 3000). Deliberately null for a port-less URL: `https://box.ts.net` means
 * "reach the preview over 443, usually via a proxy" — NOT "bind 443 locally".
 * Deriving the protocol default here would make the dev server try to bind a
 * privileged port and fail, breaking the remote/Tailscale case outright.
 */
export function portFromUrl(url: string | undefined): number | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.port ? coercePort(u.port) : null;
  } catch {
    return null;
  }
}
