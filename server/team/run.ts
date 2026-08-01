/**
 * Delegate runner — turn a recipe descriptor into a spawned, captured agent
 * (PLAN.md §5; AI Team).
 *
 * Server-mediated by design: the lead shells out to `clidable team delegate`,
 * which POSTs to /api/team/delegate, and the SERVER owns the delegate process.
 * That ownership is the whole point — it's what lets the job system (jobs.ts)
 * add background runs, status, and cancel, none of which a raw lead-side
 * `codex exec` could offer.
 *
 * `prepareDelegate` + `spawnPrepared` + `collectProcess` are the shared seam:
 * `runDelegate` (foreground) and jobs.ts both use them. The recipe is pure
 * data; this file is the only place that actually spawns.
 */
import type { Subprocess } from "bun";
import { AGENTS, resolveBin } from "../agents";
import { pathWithClidableBin } from "../cli-shim";
import { resolveCwd } from "../pty/session";
import { BUILTIN_RECIPES, buildArgv, extractAnswer } from "./recipes";
import { loadRoles } from "./config";
import { composeDelegatePrompt } from "./roles";
import { AGENT_INSTALL_DOCS } from "../../shared/types";
import type { AgentRecipe, DelegateAgentId, TeamRole, TerminalAgentId } from "../../shared/types";

/** Refuse delegation nested deeper than this — a fork-bomb backstop for a
 *  delegate that keeps calling `clidable team delegate`. Depth crosses the
 *  CLI→server boundary in the request body (env can't, over HTTP). */
export const MAX_DELEGATE_DEPTH = 3;

/** Error codes a prepare-time failure can carry, paired with the HTTP status
 *  the route should map them to. Sharing the map keeps the emit site (here) and
 *  the route's classification from drifting — a renamed code would otherwise
 *  silently fall through to 500. */
export type DelegateErrorCode =
  | "DELEGATE_TOO_DEEP"
  | "DELEGATE_UNSUPPORTED"
  | "DELEGATE_NO_PROMPT"
  | "AGENT_NOT_FOUND"
  | "ROLE_NOT_FOUND";

export const DELEGATE_ERROR_STATUS: Record<DelegateErrorCode, number> = {
  DELEGATE_TOO_DEEP: 429,
  DELEGATE_UNSUPPORTED: 400,
  DELEGATE_NO_PROMPT: 400,
  AGENT_NOT_FOUND: 404,
  ROLE_NOT_FOUND: 404,
};

export interface RunDelegateInput {
  agent: DelegateAgentId;
  prompt: string;
  projectPath: string;
  /** Nesting depth of THIS call (0 at the top level). */
  depth: number;
  /** Run the agent's write-capable recipe (roles that produce files). Refused
   *  when the recipe has no `writeArgs` — never silently downgraded. */
  write?: boolean;
  /** Role id the delegate is playing. Resolved against the project's config and
   *  prepended to `prompt` as the specialist's persona. Unknown ids are refused
   *  rather than ignored: silently dropping it is the failure mode this whole
   *  parameter exists to fix. */
  role?: string;
}

export interface RunDelegateResult {
  agent: DelegateAgentId;
  answer: string;
  exitCode: number;
  durationMs: number;
}

/** Everything needed to spawn a delegate — resolved and validated. */
export interface PreparedDelegate {
  recipe: AgentRecipe;
  binPath: string;
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  stdin: "ignore" | Uint8Array;
}

/** Raw output of a finished delegate process. */
export interface Captured {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function delegateError(code: DelegateErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Resolve the recipe for an agent id. Built-ins for now; user-added recipes
 *  from config get merged here in a later slice. */
function resolveRecipe(agent: DelegateAgentId): AgentRecipe | undefined {
  return BUILTIN_RECIPES[agent];
}

/** Look up one role in the project's config. Enabled-ness is deliberately NOT
 *  checked: `enabled` governs whether the skill is installed for a lead, not
 *  whether the role's instructions are valid — refusing here would break a
 *  delegation the lead was legitimately told to make. */
async function resolveRole(projectPath: string, roleId: string): Promise<TeamRole> {
  const roles = await loadRoles(projectPath);
  const role = roles.find((r) => r.id === roleId);
  if (!role) {
    throw delegateError(
      "ROLE_NOT_FOUND",
      `unknown role "${roleId}" in this project — run \`clidable team sync\` to reinstall the role skills, ` +
        `or drop --role to delegate without one. Known roles: ${roles.map((r) => r.id).join(", ")}`,
    );
  }
  return role;
}

/**
 * Validate + resolve a delegation into a concrete spawn plan. Throws (with a
 * `code`) for the depth guard, an unknown agent, an empty prompt, or a missing
 * binary — i.e. everything that should fail BEFORE a process exists, so both
 * foreground and background starts surface these synchronously.
 */
export async function prepareDelegate(
  input: RunDelegateInput,
): Promise<PreparedDelegate> {
  const { agent, prompt, projectPath, depth, write = false } = input;

  if (depth >= MAX_DELEGATE_DEPTH) {
    throw delegateError(
      "DELEGATE_TOO_DEEP",
      `delegation nested too deep (depth ${depth} ≥ ${MAX_DELEGATE_DEPTH}) — refusing to spawn another agent`,
    );
  }

  const recipe = resolveRecipe(agent);
  if (!recipe) {
    throw delegateError("DELEGATE_UNSUPPORTED", `AI Team can't delegate to "${agent}" yet`);
  }

  // Resolve the role BEFORE spawning, so a stale `--role` in a skill file fails
  // loudly here instead of quietly running a personaless agent. Roles come from
  // the project's own config, which is also what rendered the skill that named
  // this id — a mismatch means the two drifted and `clidable team sync` fixes it.
  const role = input.role ? await resolveRole(projectPath, input.role) : null;

  // A role that SAVES FILES must not run in the read-only sandbox. The delegate
  // would generate its output, fail to write it, and still exit 0 — a success
  // the lead relays while nothing landed on disk. The rendered skill always
  // passes --write for these, so reaching here means it was dropped by hand.
  if (role?.needsWrite && !write) {
    throw delegateError(
      "DELEGATE_UNSUPPORTED",
      `the "${role.name}" role saves files and must be delegated with --write — ` +
        `re-run: clidable team delegate ${agent} --role ${role.id} --write "…"`,
    );
  }
  if ((write || role?.needsWrite) && !recipe.writeArgs) {
    // Refuse rather than silently run read-only: a role that saves files
    // (Image Creator) would otherwise "succeed" with nothing written.
    throw delegateError(
      "DELEGATE_UNSUPPORTED",
      `"${recipe.name}" has no write-capable invocation — assign ` +
        `${role ? `the "${role.name}" role` : "this role"} to an agent that does (e.g. codex)`,
    );
  }

  const trimmed = prompt.trim();
  if (!trimmed) {
    throw delegateError("DELEGATE_NO_PROMPT", "a prompt is required");
  }

  const finalPrompt = role ? composeDelegatePrompt(role, trimmed) : trimmed;

  const binPath = await resolveBin(recipe.bin);
  if (!binPath) {
    // Built-ins link their install docs; custom agents just report the missing bin.
    const url = AGENT_INSTALL_DOCS[recipe.id as TerminalAgentId];
    throw delegateError(
      "AGENT_NOT_FOUND",
      `"${recipe.name}" not found on PATH (looked for "${recipe.bin}").` +
        (url ? ` Install it: ${url}` : ""),
    );
  }

  return {
    recipe,
    binPath,
    argv: buildArgv(recipe, finalPrompt, write),
    cwd: resolveCwd(projectPath),
    env: {
      ...process.env,
      // Agent-specific env (e.g. a workspace-trust flag), before our control
      // vars so a recipe can't override depth/NO_COLOR.
      ...(recipe.env ?? {}),
      // Capturing via a pipe, so discourage ANSI in the streams we parse for the
      // answer. (A live-tab view gets color back via stderr.)
      NO_COLOR: "1",
      // Propagate the INCREMENTED depth so a nested `clidable team delegate`
      // from inside this delegate carries it to the guard above.
      CLIDABLE_DELEGATE_DEPTH: String(depth + 1),
      // Let a (depth-guarded) nested `clidable team delegate` resolve too.
      PATH: pathWithClidableBin(),
    },
    // "arg" mode closes stdin (/dev/null — the </dev/null Codex needs); "stdin"
    // mode feeds the prompt and closes.
    stdin: recipe.promptInput === "stdin" ? new TextEncoder().encode(finalPrompt) : "ignore",
  };
}

/** Spawn a prepared delegate with both streams piped for capture. */
export function spawnPrepared(p: PreparedDelegate): Subprocess<"ignore", "pipe", "pipe"> {
  return Bun.spawn([p.binPath, ...p.argv], {
    cwd: p.cwd,
    env: p.env,
    stdin: p.stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
}

/**
 * Read both pipes to EOF — but never hang past the child's exit. A killed (or
 * even cleanly-exited) agent can orphan a grandchild that keeps the pipe open,
 * so `Response(stream).text()` could block forever; instead we gate on
 * `proc.exited` and give the drain a grace window, then finalize on whatever we
 * captured. The trailing `decode()` flush avoids dropping a multibyte char
 * split across the final chunk. `onChunk` streams output for a live preview.
 */
export async function collectProcess(
  proc: Subprocess<"ignore", "pipe", "pipe">,
  opts: { graceMs?: number; onChunk?: (s: string, isOut: boolean) => void } = {},
): Promise<Captured> {
  let stdout = "";
  let stderr = "";

  const drain = async (stream: ReadableStream<Uint8Array>, isOut: boolean): Promise<void> => {
    const dec = new TextDecoder();
    const reader = stream.getReader();
    const push = (s: string): void => {
      if (!s) return;
      if (isOut) stdout += s;
      else stderr += s;
      opts.onChunk?.(s, isOut);
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        push(dec.decode(value, { stream: true }));
      }
      push(dec.decode()); // flush any buffered trailing bytes
    } catch {
      // Stream torn down (e.g. by a kill) — finalize on what we captured.
    } finally {
      reader.releaseLock();
    }
  };

  const reads = Promise.all([drain(proc.stdout, true), drain(proc.stderr, false)]);
  // `proc.exited` resolves to null when the child was killed by a signal →
  // treat that as a failure exit, not success.
  const exitCode = (await proc.exited) ?? 1;
  await Promise.race([reads, Bun.sleep(opts.graceMs ?? 1500)]);
  return { stdout, stderr, exitCode };
}

/** Foreground delegation: spawn, capture, return the answer. */
export async function runDelegate(
  input: RunDelegateInput,
): Promise<RunDelegateResult> {
  const prepared = await prepareDelegate(input);
  const started = Date.now();
  const proc = spawnPrepared(prepared);
  const { stdout, stderr, exitCode } = await collectProcess(proc);
  const answer = extractAnswer(prepared.recipe.parse, { stdout, stderr, exitCode });
  return { agent: input.agent, answer, exitCode, durationMs: Date.now() - started };
}
