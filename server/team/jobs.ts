/**
 * Background delegation jobs (PLAN.md §5; AI Team Slice 2).
 *
 * A long delegation can't run foreground — the lead's own bash call would time
 * out (Claude Code caps it at 600s). So `clidable team delegate --background`
 * starts a job here: the SERVER owns the detached process, accumulates its
 * output (with a rolling tail for live progress), and on exit extracts the
 * answer. The lead then polls `status` / `result` / `cancel`.
 *
 * State is in-memory and keyed to the running server — exactly right, since a
 * job IS a child of this server and dies with it; the CLI is always a client to
 * this one process. (Disk persistence across restarts is a later concern.)
 *
 * `TeamJob` takes an already-spawned process so it can be unit-tested against a
 * fake; `jobManager.start` wires in the real `prepareDelegate`/`spawnPrepared`.
 */
import { randomUUID } from "node:crypto";
import type { Subprocess } from "bun";
import { stripAnsi } from "../preview/url-finder";
import { extractAnswer } from "./recipes";
import { collectProcess, prepareDelegate, spawnPrepared, type RunDelegateInput } from "./run";
import type { AnswerParse, DelegateAgentId, TeamJobInfo, TeamJobStatus } from "../../shared/types";

const MAX_JOBS = 50;
const TAIL_CAP = 16 * 1024; // rolling progress buffer
const PROGRESS_LINES = 4;

export interface TeamJobOptions {
  id: string;
  agent: DelegateAgentId;
  prompt: string;
  projectPath: string;
  proc: Subprocess<"ignore", "pipe", "pipe">;
  parse: AnswerParse;
}

export class TeamJob {
  readonly id: string;
  readonly agent: DelegateAgentId;
  readonly prompt: string;
  readonly projectPath: string;
  readonly startedAt = Date.now();
  /** Resolves once the job reaches a terminal state. */
  readonly done: Promise<void>;

  private readonly proc: Subprocess<"ignore", "pipe", "pipe">;
  private readonly parse: AnswerParse;
  private status: TeamJobStatus = "running";
  private completedAt?: number;
  private exitCode?: number;
  private answer?: string;
  private error?: string;
  private tail = "";
  private resolveDone!: () => void;

  constructor(opts: TeamJobOptions) {
    this.id = opts.id;
    this.agent = opts.agent;
    this.prompt = opts.prompt;
    this.projectPath = opts.projectPath;
    this.proc = opts.proc;
    this.parse = opts.parse;
    this.done = new Promise((res) => (this.resolveDone = res));
    void this.pump();
  }

  private appendTail(s: string): void {
    this.tail += s;
    if (this.tail.length > TAIL_CAP) this.tail = this.tail.slice(-TAIL_CAP);
  }

  private async pump(): Promise<void> {
    try {
      // collectProcess gates on the direct child's exit (a killed agent can
      // orphan a grandchild that holds the pipe open) and streams chunks to the
      // rolling tail for live progress.
      const { stdout, stderr, exitCode } = await collectProcess(this.proc, {
        onChunk: (s) => this.appendTail(s),
      });
      this.finalize(stdout, stderr, exitCode);
    } catch (e) {
      if (this.status === "running") {
        this.status = "failed";
        this.error = (e as Error)?.message ?? String(e);
      }
      this.completedAt = Date.now();
      this.resolveDone();
    }
  }

  private finalize(stdout: string, stderr: string, exitCode: number): void {
    this.completedAt = Date.now();
    this.exitCode = exitCode;
    if (this.status === "cancelled") {
      this.resolveDone();
      return;
    }
    try {
      this.answer = extractAnswer(this.parse, { stdout, stderr, exitCode });
      this.status = "completed";
    } catch (e) {
      this.status = "failed";
      this.error = (e as Error)?.message ?? String(e);
    }
    this.resolveDone();
  }

  /** Kill a running job. No-op (returns false) if it already finished. */
  cancel(): boolean {
    if (this.status !== "running") return false;
    this.status = "cancelled";
    this.error = "Cancelled by user.";
    this.proc.kill(); // → stream EOF / exit → pump → finalize (sees "cancelled")
    return true;
  }

  isRunning(): boolean {
    return this.status === "running";
  }

  /** Last few non-blank output lines (ANSI stripped) — a live progress preview. */
  private progressTail(): string[] {
    return this.tail
      .split(/\r?\n/)
      .map((l) => stripAnsi(l).trimEnd())
      .filter(Boolean)
      .slice(-PROGRESS_LINES);
  }

  toInfo(): TeamJobInfo {
    return {
      id: this.id,
      agent: this.agent,
      status: this.status,
      promptPreview: shorten(this.prompt, 80),
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      durationMs: this.completedAt ? this.completedAt - this.startedAt : undefined,
      exitCode: this.exitCode,
      answer: this.answer,
      error: this.error,
      progress: this.status === "running" ? this.progressTail() : undefined,
    };
  }
}

class JobManager {
  private jobs = new Map<string, TeamJob>();

  /** Start a background delegation. Throws (synchronously, before any process
   *  exists) for the same prepare-time errors as a foreground run. */
  async start(input: RunDelegateInput): Promise<TeamJob> {
    const prepared = await prepareDelegate(input);
    const proc = spawnPrepared(prepared);
    const job = new TeamJob({
      id: genJobId(),
      agent: input.agent,
      prompt: input.prompt,
      projectPath: input.projectPath,
      proc,
      parse: prepared.recipe.parse,
    });
    this.jobs.set(job.id, job);
    this.prune();
    return job;
  }

  /** Jobs for a project (or all), newest first. */
  list(projectPath?: string): TeamJob[] {
    const all = [...this.jobs.values()];
    return (projectPath ? all.filter((j) => j.projectPath === projectPath) : all).sort(
      (a, b) => b.startedAt - a.startedAt,
    );
  }

  /** Resolve a job reference WITHIN a project: none → newest; else exact id, or
   *  a unique id prefix. Scoping to the project avoids one project's ref
   *  resolving to another's job. */
  find(projectPath: string, ref?: string): TeamJob | undefined {
    const scoped = this.list(projectPath);
    if (!ref) return scoped[0];
    return scoped.find((j) => j.id === ref) ?? scoped.find((j) => j.id.startsWith(ref));
  }

  /** Cap retained jobs by evicting the oldest FINISHED ones. */
  private prune(): void {
    if (this.jobs.size <= MAX_JOBS) return;
    const finished = [...this.jobs.values()]
      .filter((j) => !j.isRunning())
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const j of finished) {
      if (this.jobs.size <= MAX_JOBS) break;
      this.jobs.delete(j.id);
    }
  }
}

export const jobManager = new JobManager();

function genJobId(): string {
  // randomUUID matches the house id convention (checkpoints/projects) and avoids
  // the collision risk of a Date.now()+Math.random() suffix.
  return `team-${randomUUID().slice(0, 8)}`;
}

function shorten(text: string, limit: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= limit ? t : `${t.slice(0, limit - 1)}…`;
}
