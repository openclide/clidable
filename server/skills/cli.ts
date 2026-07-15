/**
 * Re-exec harness for the bundled `skills` CLI (PLAN.md §4).
 *
 * `skills` is CLI-only (no library API), so mutations shell out to it. We pin
 * it as a dependency (no `bunx` download at runtime):
 *
 *   • dev (running under `bun`): spawn the locally-installed bin directly.
 *   • compiled binary (slice 5): re-exec ourselves as `__run-skills`, which
 *     imports the bundled CLI entry. `node_modules/.bin/skills` won't exist in
 *     a `bun build --compile` output, so we fall back to that path.
 *
 * Always run non-interactively (`-y` is added by the manager) with stdin
 * closed so the CLI never blocks on a prompt.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stripAnsi } from "../preview/url-finder";

/** OSC sequences (e.g. color queries) — CSI-stripping `stripAnsi` misses these. */
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

const LOCAL_BIN = join(import.meta.dir, "..", "..", "node_modules", ".bin", "skills");

/** Argv prefix that runs the `skills` CLI in the current shell. */
function baseArgv(): string[] {
  if (existsSync(LOCAL_BIN)) return [LOCAL_BIN];
  // Compiled binary: re-exec self; index.ts dispatches "__run-skills".
  return [process.execPath, "__run-skills"];
}

export interface SkillsCliResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Compiled-binary path: BE the bundled `skills` CLI for one invocation.
 * `runSkillsCli`'s fallback re-execs `[self, "__run-skills", …args]`;
 * index.ts routes that here. There's no `node_modules/.bin/skills` inside a
 * `bun build --compile` binary, but the package's code IS bundled — so we set
 * argv to look like `skills …` and import its entry (a literal specifier so the
 * bundler includes it). The CLI parses argv and exits on its own.
 */
export async function runBundledSkills(args: string[]): Promise<never> {
  process.argv = [process.argv[0]!, "skills", ...args];
  await import("skills/bin/cli.mjs");
  process.exit(0); // CLI normally exits itself; this is a safety net.
}

export async function runSkillsCli(
  args: string[],
  cwd: string,
): Promise<SkillsCliResult> {
  const proc = Bun.spawn([...baseArgv(), ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // CI nudges the CLI toward non-interactive output; `-y` still required.
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, code, stdout, stderr };
}

/**
 * Pull a human-readable failure message out of the `skills` CLI's clack/banner
 * output (which is mostly ASCII art + spinners). Prefers the error lines it
 * marks with `■`; falls back to other non-decorative lines.
 */
export function summarizeCliFailure(r: SkillsCliResult): string {
  const lines = stripAnsi(`${r.stdout}\n${r.stderr}`.replace(OSC_RE, ""))
    .split("\n")
    .map((l) => l.replace(/^[\s│┌└├●◇◆◒◐◓◑○]+/, "").trim())
    .filter(Boolean)
    .filter((l) => !/[█╗╔╚╝═║╠╣╦╩╬]/.test(l)) // banner art
    .filter((l) => l !== "skills" && !/^Tip: use the --yes/i.test(l));
  const errs = lines.filter(
    (l) => l.startsWith("■") || /^(Failed to|Error|No matching|Cannot|Unable)/i.test(l),
  );
  const msg = (errs.length ? errs : lines)
    .map((l) => l.replace(/^■\s*/, ""))
    .join(" — ")
    .trim();
  return (msg || `exit ${r.code}`).slice(0, 300);
}
