/**
 * Delegate recipes — how to invoke each agent NON-INTERACTIVELY and read back
 * its clean final answer (PLAN.md §5; AI Team).
 *
 * Recipes are pure DATA ({@link AgentRecipe}), not functions, so built-in and
 * user-added agents share one shape — adding a custom CLI agent is filling in a
 * descriptor (GUI / ai-team.json), never a code change. The generic
 * interpreter below (`buildArgv` + `extractAnswer`) turns any descriptor into a
 * spawn + an answer; `run.ts` does the actual spawning.
 *
 * Built-ins are seed descriptors verified against the installed binaries
 * (codex-cli 0.134, Claude Code 2.1.x). Slice 1 wires codex + claude; the other
 * seven are just more descriptors (Slice 3).
 */
import type { AgentRecipe, AnswerParse, DelegateAgentId } from "../../shared/types";

/** Placeholder in `AgentRecipe.args` replaced by the prompt in "arg" mode. */
export const PROMPT_PLACEHOLDER = "{prompt}";

const codex: AgentRecipe = {
  id: "codex",
  name: "Codex CLI",
  bin: "codex",
  promptInput: "arg",
  // `exec` = one-shot headless (inherently non-interactive — there is no
  // `--ask-for-approval` here, and read-only sandbox can't write, so it never
  // blocks). `--skip-git-repo-check` runs anywhere; `--color never` keeps the
  // captured stream plain. Codex prints ONLY the final agent message to stdout
  // (progress goes to stderr) — so raw stdout IS the answer.
  args: [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    PROMPT_PLACEHOLDER,
  ],
  // `--write` delegations (roles that produce files, e.g. Image Creator):
  // workspace-write lets codex save into the project + its own state dirs
  // while still headless (exec never prompts). Never danger-full-access.
  writeArgs: [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--color",
    "never",
    PROMPT_PLACEHOLDER,
  ],
  parse: { type: "raw" },
};

const claude: AgentRecipe = {
  id: "claude",
  name: "Claude Code",
  bin: "claude",
  promptInput: "arg",
  // `-p` = headless print mode (no TUI redraws). `--output-format json` yields a
  // single object whose `.result` is the final answer; stdout stays clean.
  args: ["-p", PROMPT_PLACEHOLDER, "--output-format", "json"],
  parse: { type: "json", path: "result" },
};

const antigravity: AgentRecipe = {
  id: "antigravity",
  name: "Antigravity CLI",
  bin: "agy",
  promptInput: "arg",
  // -p/--print = one-shot headless; prints the final response as plain text.
  // --mode plan = read-only planning (advise, don't write), so it never blocks
  // on tool approvals — mirrors codex read-only. Verified 2026-07: `agy -p …
  // --mode plan` captured through a pipe (non-TTY, as this runner does) returns
  // the answer cleanly.
  args: ["-p", PROMPT_PLACEHOLDER, "--mode", "plan"],
  parse: { type: "raw" },
};

const opencode: AgentRecipe = {
  id: "opencode",
  name: "OpenCode",
  bin: "opencode",
  promptInput: "arg",
  // `run` prints the assistant's response as plain text to stdout (events would
  // need --format json, which we don't want). Verified clean vs opencode 1.15.
  args: ["run", PROMPT_PLACEHOLDER],
  parse: { type: "raw" },
};

const copilot: AgentRecipe = {
  id: "copilot",
  name: "GitHub Copilot CLI",
  bin: "copilot",
  promptInput: "arg",
  // -p = headless. Copilot STALLS on tool approval unless granted and has no
  // read-only mode, so --allow-all-tools is required for non-interactive use
  // (note: this also lets it write — a per-role sandbox is a later concern).
  // text output = the clean final message. Verified vs Copilot CLI 1.0.56.
  args: ["-p", PROMPT_PLACEHOLDER, "--allow-all-tools", "--output-format", "text"],
  parse: { type: "raw" },
};

const kimi: AgentRecipe = {
  id: "kimi",
  name: "Kimi CLI",
  bin: "kimi",
  promptInput: "arg",
  // -p = one-shot non-interactive (print mode auto-enables --afk, so it won't
  // block); default text output. Args verified vs kimi 0.6.0; answer
  // cleanliness unverified (no model configured on the test machine).
  args: ["-p", PROMPT_PLACEHOLDER],
  parse: { type: "raw" },
};

const cursor: AgentRecipe = {
  id: "cursor",
  name: "Cursor Agent",
  bin: "cursor-agent",
  promptInput: "arg",
  // -p = headless print; JSON envelope → `.result`. Read-only by default (only
  // proposes edits without --force). NOT verified on this machine (cursor-agent
  // not installed) — flags per the Cursor CLI docs.
  args: ["-p", PROMPT_PLACEHOLDER, "--output-format", "json"],
  parse: { type: "json", path: "result" },
};

const qwen: AgentRecipe = {
  id: "qwen",
  name: "Qwen Code",
  bin: "qwen",
  promptInput: "arg",
  // -p = headless; default TEXT output (its JSON is an array our dotted parse
  // can't address — text is cleaner anyway). NOT verified on this machine (qwen
  // not installed) — flags per the Qwen Code docs.
  args: ["-p", PROMPT_PLACEHOLDER],
  parse: { type: "raw" },
};

/** Built-in (curated) recipes, by agent id. User-added agents live in config
 *  and are merged on top of this at resolve time (a later slice). codex,
 *  claude, antigravity, opencode, copilot are verified against installed
 *  binaries; cursor, qwen, kimi-output are doc-based (see each descriptor's
 *  note). */
export const BUILTIN_RECIPES: Partial<Record<DelegateAgentId, AgentRecipe>> = {
  codex,
  claude,
  antigravity,
  opencode,
  copilot,
  kimi,
  cursor,
  qwen,
};

/* ----------------------------- interpreter ------------------------------- */

/** Substitute the prompt into a recipe's argv template — pure, no shell. In
 *  "stdin" mode the prompt is fed via stdin instead, so the template is
 *  unchanged. `write` picks the escalated template when the recipe defines one,
 *  and otherwise falls back to the default argv: `writeArgs` exists only for
 *  agents whose default is deliberately sandboxed, so its absence means the
 *  normal invocation already writes, not that writing is impossible. */
export function buildArgv(recipe: AgentRecipe, prompt: string, write = false): string[] {
  const template = write && recipe.writeArgs ? recipe.writeArgs : recipe.args;
  if (recipe.promptInput === "stdin") return [...template];
  return template.map((a) => (a === PROMPT_PLACEHOLDER ? prompt : a));
}

/** Captured output of a finished delegate process. */
export interface DelegateCaptured {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Pull the clean final answer from captured stdout per the parse spec. Throws
 *  when there's no usable answer (the caller turns that into an error). */
export function extractAnswer(parse: AnswerParse, c: DelegateCaptured): string {
  const raw = c.stdout.trim();
  if (raw && parse.type === "json") {
    try {
      const val = readPath(JSON.parse(raw), parse.path);
      // The path resolved to a string → that IS the answer, even if empty.
      // Returning raw here would leak the whole envelope (result, session_id…).
      // Only a non-JSON / wrong-shape stdout (val not a string) falls through.
      if (typeof val === "string") return val.trim();
    } catch {
      // Not JSON (e.g. an error line, or a plain-text fallback) — fall through
      // and return the raw stdout rather than losing it.
    }
  }
  if (raw) return raw;
  throw new Error(
    `delegate produced no output (exit ${c.exitCode})` +
      (c.stderr.trim() ? `: ${tail(c.stderr)}` : "."),
  );
}

/** Read a dotted path (`"a.b"`) out of a parsed value; undefined if absent. Uses
 *  own-property checks so a path like `__proto__`/`constructor` can't descend
 *  into the prototype chain. */
function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && Object.prototype.hasOwnProperty.call(acc, key)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Last ~200 chars of a stream, for compact error messages. */
function tail(s: string, n = 200): string {
  const t = s.trim();
  return t.length <= n ? t : `…${t.slice(-n)}`;
}
