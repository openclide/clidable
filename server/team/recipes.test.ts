import { describe, expect, test } from "bun:test";
import {
  BUILTIN_RECIPES,
  PROMPT_PLACEHOLDER,
  buildArgv,
  extractAnswer,
} from "./recipes";
import type { AgentRecipe } from "../../shared/types";

describe("built-in recipes", () => {
  test("registry wires all eight built-in delegate agents", () => {
    expect(Object.keys(BUILTIN_RECIPES).sort()).toEqual([
      "antigravity",
      "claude",
      "codex",
      "copilot",
      "cursor",
      "kimi",
      "opencode",
      "qwen",
    ]);
  });

  test("every built-in recipe is well-formed", () => {
    for (const [id, r] of Object.entries(BUILTIN_RECIPES)) {
      expect(r!.id).toBe(id); // key matches descriptor id
      expect(r!.bin.length).toBeGreaterThan(0);
      expect(["arg", "stdin"]).toContain(r!.promptInput);
      expect(r!.args.length).toBeGreaterThan(0);
      // "arg" mode must carry the placeholder, or the prompt never reaches it.
      if (r!.promptInput === "arg") expect(r!.args).toContain(PROMPT_PLACEHOLDER);
    }
  });

  test("antigravity: agy print mode + read-only plan + raw parse", () => {
    const r = BUILTIN_RECIPES.antigravity!;
    expect(r.bin).toBe("agy");
    expect(r.promptInput).toBe("arg");
    expect(r.args).toContain("-p");
    expect(r.args).toContain("--mode");
    expect(r.args).toContain("plan");
    expect(r.args).toContain(PROMPT_PLACEHOLDER);
    expect(r.parse).toEqual({ type: "raw" });
  });

  test("codex: exec descriptor — skip-git-check, read-only, color off, no approvals", () => {
    const r = BUILTIN_RECIPES.codex!;
    expect(r.bin).toBe("codex");
    expect(r.promptInput).toBe("arg");
    expect(r.args[0]).toBe("exec");
    expect(r.args).toContain("--skip-git-repo-check");
    expect(r.args).toContain("--sandbox");
    expect(r.args).toContain("read-only");
    expect(r.args).toContain("--color");
    expect(r.args).toContain("never");
    // `exec` has no --ask-for-approval (it errors on codex 0.134).
    expect(r.args).not.toContain("--ask-for-approval");
    expect(r.args.at(-1)).toBe(PROMPT_PLACEHOLDER);
    expect(r.parse).toEqual({ type: "raw" });
  });

  test("claude: print-mode descriptor with json .result parse", () => {
    const r = BUILTIN_RECIPES.claude!;
    expect(r.bin).toBe("claude");
    expect(r.promptInput).toBe("arg");
    expect(r.args).toEqual(["-p", PROMPT_PLACEHOLDER, "--output-format", "json"]);
    expect(r.parse).toEqual({ type: "json", path: "result" });
  });
});

describe("buildArgv", () => {
  test('"arg" mode substitutes the prompt verbatim at the placeholder', () => {
    expect(buildArgv(BUILTIN_RECIPES.codex!, "fix the test")).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "fix the test",
    ]);
  });

  test('"stdin" mode leaves args untouched (prompt is piped instead)', () => {
    const r: AgentRecipe = {
      id: "custom",
      name: "Custom",
      bin: "myagent",
      promptInput: "stdin",
      args: ["run", "--yes"],
      parse: { type: "raw" },
    };
    expect(buildArgv(r, "do the thing")).toEqual(["run", "--yes"]);
  });
});

describe("extractAnswer", () => {
  test("raw: whole stdout, trimmed", () => {
    expect(
      extractAnswer({ type: "raw" }, { stdout: "  the fix is X\n", stderr: "", exitCode: 0 }),
    ).toBe("the fix is X");
  });

  test("json: reads the dotted path", () => {
    expect(
      extractAnswer(
        { type: "json", path: "result" },
        { stdout: JSON.stringify({ result: "done: 3 files", session_id: "x" }), stderr: "", exitCode: 0 },
      ),
    ).toBe("done: 3 files");
  });

  test("json: falls back to raw stdout when not JSON or path missing", () => {
    expect(
      extractAnswer({ type: "json", path: "result" }, { stdout: "plain text", stderr: "", exitCode: 0 }),
    ).toBe("plain text");
    expect(
      extractAnswer(
        { type: "json", path: "result" },
        { stdout: JSON.stringify({ other: "x" }), stderr: "", exitCode: 0 },
      ),
    ).toBe(JSON.stringify({ other: "x" }));
  });

  test("json: a present-but-empty string answer returns '' (not the leaked envelope)", () => {
    expect(
      extractAnswer(
        { type: "json", path: "result" },
        { stdout: JSON.stringify({ result: "", session_id: "secret" }), stderr: "", exitCode: 0 },
      ),
    ).toBe("");
  });

  test("json: a path hitting a prototype key does not escape into the prototype", () => {
    // `"constructor" in obj` is true; hasOwnProperty is not → falls back to raw.
    expect(
      extractAnswer({ type: "json", path: "constructor" }, { stdout: "{}", stderr: "", exitCode: 0 }),
    ).toBe("{}");
  });

  test("empty stdout throws with exit code + stderr tail", () => {
    expect(() =>
      extractAnswer({ type: "raw" }, { stdout: "  \n", stderr: "boom", exitCode: 1 }),
    ).toThrow(/delegate produced no output \(exit 1\): boom/);
  });
});
