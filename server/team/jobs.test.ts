import { describe, expect, test } from "bun:test";
import { TeamJob } from "./jobs";
import type { AnswerParse, DelegateAgentId } from "../../shared/types";

/** A controllable fake delegate: any shell snippet, piped like a real spawn. */
function fakeJob(id: string, script: string, parse: AnswerParse, agent: DelegateAgentId = "codex"): TeamJob {
  return new TeamJob({
    id,
    agent,
    prompt: "do the thing",
    projectPath: "/tmp/proj",
    proc: Bun.spawn(["sh", "-c", script], { stdin: "ignore", stdout: "pipe", stderr: "pipe" }),
    parse,
  });
}

describe("TeamJob", () => {
  test("completes and captures the answer (raw parse)", async () => {
    const job = fakeJob("job-raw", 'echo "the answer"', { type: "raw" });
    await job.done;
    const info = job.toInfo();
    expect(info.status).toBe("completed");
    expect(info.answer).toBe("the answer");
    expect(info.exitCode).toBe(0);
    expect(info.durationMs).toBeGreaterThanOrEqual(0);
    expect(info.progress).toBeUndefined(); // not running → no progress
  });

  test("json parse extracts the dotted path", async () => {
    const job = fakeJob("job-json", `printf '%s' '{"result":"hi there"}'`, { type: "json", path: "result" });
    await job.done;
    expect(job.toInfo().answer).toBe("hi there");
  });

  test("empty output + nonzero exit → failed, surfacing stderr", async () => {
    const job = fakeJob("job-fail", 'echo "boom" 1>&2; exit 2', { type: "raw" });
    await job.done;
    const info = job.toInfo();
    expect(info.status).toBe("failed");
    expect(info.exitCode).toBe(2);
    expect(info.error).toMatch(/boom/);
    expect(info.answer).toBeUndefined();
  });

  test("cancel kills a running job and is idempotent", async () => {
    const job = fakeJob("job-cancel", "sleep 30; echo done", { type: "raw" });
    await Bun.sleep(60); // let it start
    expect(job.isRunning()).toBe(true);
    expect(job.cancel()).toBe(true);
    await job.done;
    const info = job.toInfo();
    expect(info.status).toBe("cancelled");
    expect(info.error).toMatch(/Cancelled/);
    expect(job.cancel()).toBe(false); // already finished
  });
});
