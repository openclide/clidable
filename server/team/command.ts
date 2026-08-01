/**
 * `clidable team …` — the lead agent's delegation surface (PLAN.md §5).
 *
 * Unlike the other `clidable` subcommands (instructions/skills/mcp/plugins),
 * which operate on config files directly, this is a thin CLIENT to the running
 * Clidable server: the server owns the delegate process. So the server must be
 * up — which it always is when the lead is running inside Clidable.
 *
 *   delegate <agent> [--role <id>] <prompt…>    run an agent on a prompt, with
 *                       [--background] [--write]   that role's instructions
 *   status [job]                                list jobs, or show one
 *   result [job]                                print a finished job's answer
 *   cancel [job]                                cancel a running job
 */
import { syncRoles } from "./roles";
import { loadRoles } from "./config";
import type {
  DelegateRequest,
  DelegateResponse,
  TeamJobInfo,
  TeamJobResponse,
  TeamJobsResponse,
} from "../../shared/types";

const HELP = `clidable team — delegate work to another coding agent

  delegate <agent> [--role <id>] <prompt…> [--background] [--write]
                                              run <agent> on <prompt>
  status [job]                                list jobs, or show one
  result [job]                                print a finished job's answer
  cancel [job]                                cancel a running job
  roles                                       list the team roles
  sync                                        install role skills into this project

  --role    give the delegate a role's instructions (see \`roles\`). Without it
            the agent gets the bare task and behaves generically
  --write   give the delegate write access to the workspace (roles that save
            files, e.g. the Image Creator)

agents: codex, claude, antigravity, opencode, copilot, kimi, cursor, qwen
delegate/status/result/cancel run inside Clidable (server must be up);
roles/sync operate on the current project's files directly.`;

export async function runTeamCommand(args: string[]): Promise<number> {
  const sub = args[0];
  switch (sub) {
    case "delegate":
      return delegate(args.slice(1));
    case "status":
      return status(args.slice(1));
    case "result":
      return result(args.slice(1));
    case "cancel":
      return cancel(args.slice(1));
    case "roles":
      return roles();
    case "sync":
      return sync();
    default:
      console.log(HELP);
      return sub ? 1 : 0;
  }
}

/* ------------------------------- transport ------------------------------- */

const port = () => process.env.CLIDABLE_PORT ?? "7878";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port()}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return {
      ok: false,
      error: `Cannot reach the Clidable server on port ${port()}. The delegate runs inside Clidable — start it (or set CLIDABLE_PORT) and retry.`,
    };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: `unexpected response (HTTP ${res.status})` };
  }
  const envelope = json as { ok?: boolean; error?: string };
  if (!res.ok || envelope?.ok !== true) {
    return { ok: false, error: envelope?.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, data: json as T };
}

/* ------------------------------- commands -------------------------------- */

/**
 * Split the delegate argv into flags + agent + prompt. Hand-rolled rather than
 * `filter`ed because `--role` takes a VALUE: dropping the flag alone would leave
 * the role id sitting at the head of the prompt (or, worse, read as the agent).
 * Both `--role x` and `--role=x` are accepted — a lead writing the command by
 * hand will use either.
 */
export function parseDelegateArgs(args: string[]): {
  background: boolean;
  write: boolean;
  role?: string;
  agent?: string;
  prompt: string;
  /** Set when `--role` was given but its value is missing or is another flag.
   *  Callers must FAIL on this rather than proceed: silently continuing without
   *  a role runs a personaless delegate, which is the failure `--role` exists to
   *  prevent — and it looks like success. */
  roleError?: string;
} {
  let background = false;
  let write = false;
  let role: string | undefined;
  let roleError: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--background") background = true;
    else if (a === "--write") write = true;
    else if (a === "--role") {
      const next = args[i + 1];
      // `--role --write x` must not swallow `--write` as the role id: that
      // silently drops BOTH the persona and the write sandbox.
      if (next === undefined || next.startsWith("-")) {
        roleError = next === undefined ? "--role needs a role id" : `--role needs a role id, got "${next}"`;
      } else {
        role = next;
        i += 1;
      }
    } else if (a.startsWith("--role=")) {
      const v = a.slice("--role=".length);
      if (v) role = v;
      else roleError = "--role needs a role id";
    } else rest.push(a);
  }
  return { background, write, role, roleError, agent: rest[0], prompt: rest.slice(1).join(" ").trim() };
}

async function delegate(args: string[]): Promise<number> {
  const { background, write, role, roleError, agent, prompt } = parseDelegateArgs(args);
  if (roleError) {
    console.error(`team delegate: ${roleError}. Run \`clidable team roles\` to list them.`);
    return 1;
  }
  if (!agent || !prompt) {
    console.error(
      "usage: clidable team delegate <agent> [--role <id>] <prompt…> [--background] [--write]",
    );
    return 1;
  }

  const reqBody: DelegateRequest = {
    agent: agent as DelegateRequest["agent"],
    prompt,
    projectPath: process.cwd(),
    depth: Number(process.env.CLIDABLE_DELEGATE_DEPTH ?? "0") || 0,
    background,
    write,
    role,
  };

  if (background) {
    const r = await api<TeamJobResponse>("POST", "/api/team/delegate", reqBody);
    if (!r.ok) {
      console.error(`team delegate failed: ${r.error}`);
      return 1;
    }
    const j = r.data.job;
    console.log(
      `Started ${j.agent} as ${j.id}. Check \`clidable team status ${j.id}\` / \`result ${j.id}\`.`,
    );
    return 0;
  }

  const r = await api<DelegateResponse>("POST", "/api/team/delegate", reqBody);
  if (!r.ok) {
    console.error(`team delegate failed: ${r.error}`);
    return 1;
  }
  writeAnswer(r.data.answer);
  // Map any non-zero/odd delegate exit to 1: a raw code can be >255 (truncates
  // mod 256 → a failure could read as 0) or undefined (signal kill).
  return r.data.exitCode === 0 ? 0 : 1;
}

async function status(args: string[]): Promise<number> {
  const ref = args[0];
  const qs = new URLSearchParams({ projectPath: process.cwd() });
  if (ref) {
    qs.set("ref", ref);
    const r = await api<TeamJobResponse>("GET", `/api/team/job?${qs}`);
    if (!r.ok) {
      console.error(r.error);
      return 1;
    }
    printJobDetail(r.data.job);
    return 0;
  }
  const r = await api<TeamJobsResponse>("GET", `/api/team/jobs?${qs}`);
  if (!r.ok) {
    console.error(r.error);
    return 1;
  }
  if (r.data.jobs.length === 0) {
    console.log("No team jobs for this project yet.");
    return 0;
  }
  for (const j of r.data.jobs) console.log(jobLine(j));
  return 0;
}

async function result(args: string[]): Promise<number> {
  const ref = args[0];
  const qs = new URLSearchParams({ projectPath: process.cwd() });
  if (ref) qs.set("ref", ref);
  const r = await api<TeamJobResponse>("GET", `/api/team/job?${qs}`);
  if (!r.ok) {
    console.error(r.error);
    return 1;
  }
  const j = r.data.job;
  if (j.status === "running") {
    console.error(`${j.id} is still running. Check \`clidable team status ${j.id}\`.`);
    return 1;
  }
  if (j.status === "completed" && j.answer !== undefined) {
    writeAnswer(j.answer);
    return j.exitCode === 0 ? 0 : 1;
  }
  console.error(`${j.id} ${j.status}${j.error ? `: ${j.error}` : ""}`);
  return 1;
}

async function cancel(args: string[]): Promise<number> {
  const ref = args[0];
  const r = await api<TeamJobResponse>("POST", "/api/team/cancel", {
    projectPath: process.cwd(),
    ref,
  });
  if (!r.ok) {
    console.error(r.error);
    return 1;
  }
  const j = r.data.job;
  console.log(j.status === "cancelled" ? `Cancelled ${j.id}.` : `${j.id} already ${j.status}.`);
  return 0;
}

/* --------------------------------- roles --------------------------------- */

async function roles(): Promise<number> {
  for (const r of await loadRoles(process.cwd())) {
    console.log(`  ${r.enabled ? "●" : "○"} ${r.id.padEnd(12)} → ${r.handlerAgent.padEnd(8)}  ${r.name}`);
  }
  return 0;
}

async function sync(): Promise<number> {
  const cwd = process.cwd();
  const results = await syncRoles(cwd, await loadRoles(cwd));
  const installed = results.filter((r) => r.written > 0);
  const wrote = results.reduce((n, r) => n + r.written, 0);
  const skipped = results.flatMap((r) => r.skipped);
  console.log(`Synced ${installed.length} enabled role(s) — ${wrote} skill file(s) in this project.`);
  for (const r of installed) console.log(`  ${r.role} → ${r.written} bucket(s)`);
  if (skipped.length) {
    console.log(`Skipped (a non-Clidable skill owns the path): ${skipped.join(", ")}`);
  }
  console.log("Leads pick these up on their next run.");
  return 0;
}

/* ------------------------------- rendering ------------------------------- */

function writeAnswer(answer: string): void {
  process.stdout.write(answer.endsWith("\n") ? answer : `${answer}\n`);
}

function elapsed(j: TeamJobInfo): string {
  const ms = j.durationMs ?? Date.now() - j.startedAt;
  return `${Math.round(ms / 1000)}s`;
}

function jobLine(j: TeamJobInfo): string {
  return `${j.id}  ${j.agent.padEnd(8)}  ${j.status.padEnd(9)}  ${elapsed(j).padStart(5)}  ${j.promptPreview}`;
}

function printJobDetail(j: TeamJobInfo): void {
  console.log(jobLine(j));
  if (j.status === "running" && j.progress?.length) {
    for (const line of j.progress) console.log(`  · ${line}`);
  } else if (j.status === "completed" && j.answer) {
    console.log("");
    console.log(j.answer);
  } else if (j.error) {
    console.log(`  ${j.error}`);
  }
}
