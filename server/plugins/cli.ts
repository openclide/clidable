/**
 * Re-exec harness for the bundled `plugins` CLI (vercel-labs; PLAN.md §4).
 *
 * `plugins` is CLI-only (no library API), so the INSTALL action shells out to
 * it. It's pinned as a dependency (no `bunx` download at runtime):
 *
 *   • dev (under `bun`): spawn the locally-installed bin directly.
 *   • compiled binary (slice 5): re-exec ourselves as `__run-plugins`, which
 *     imports the bundled CLI entry (`node_modules/.bin/plugins` won't exist in
 *     a `bun build --compile` output).
 *
 * Always run non-interactively (`-y`, added by the manager) with stdin closed,
 * and telemetry disabled (`DO_NOT_TRACK`) so nothing phones home.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stripAnsi } from "../preview/url-finder";

/** OSC sequences (e.g. color queries) — CSI-stripping `stripAnsi` misses these. */
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

const LOCAL_BIN = join(import.meta.dir, "..", "..", "node_modules", ".bin", "plugins");

/** Argv prefix that runs the `plugins` CLI in the current shell. */
function baseArgv(): string[] {
  if (existsSync(LOCAL_BIN)) return [LOCAL_BIN];
  // Compiled binary: re-exec self; index.ts dispatches "__run-plugins".
  return [process.execPath, "__run-plugins"];
}

export interface PluginsCliResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Compiled-binary path: BE the bundled `plugins` CLI for one invocation.
 * `baseArgv`'s fallback re-execs `[self, "__run-plugins", …args]`; index.ts
 * routes that here. The package ships a single bundled `dist/index.js` (its
 * `bin`), which we import via a literal specifier so the bundler includes it.
 */
export async function runBundledPlugins(args: string[]): Promise<never> {
  process.argv = [process.argv[0]!, "plugins", ...args];
  await import("plugins/dist/index.js");
  process.exit(0); // CLI normally exits itself; this is a safety net.
}

export async function runPluginsCli(
  args: string[],
  cwd: string,
): Promise<PluginsCliResult> {
  const proc = Bun.spawn([...baseArgv(), ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CI: "1", NO_COLOR: "1", DO_NOT_TRACK: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, code, stdout, stderr };
}

/**
 * Pull a human-readable failure out of the `plugins` CLI's clack/banner output
 * (mostly ASCII art + spinners). Prefers error-marked lines; falls back to
 * other non-decorative lines.
 */
export function summarizePluginsFailure(r: PluginsCliResult): string {
  const lines = stripAnsi(`${r.stdout}\n${r.stderr}`.replace(OSC_RE, ""))
    .split("\n")
    .map((l) => l.replace(/^[\s│┌└├●◇◆◒◐◓◑○■]+/, "").trim())
    .filter(Boolean)
    .filter((l) => !/[█╗╔╚╝═║╠╣╦╩╬]/.test(l)) // banner art
    .filter((l) => l !== "plugins");
  const errs = lines.filter((l) =>
    /^(Failed|Error|No plugins|Cannot|Unable|Could not|Aborted|Cancelled)/i.test(l),
  );
  const msg = (errs.length ? errs : lines).join(" — ").trim();
  return (msg || `exit ${r.code}`).slice(0, 300);
}
