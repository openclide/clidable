import { describe, expect, test } from "bun:test";
import { parseDelegateArgs } from "./command";
import { BUILTIN_ROLES, renderRoleSkill } from "./roles";

/**
 * `--role` takes a VALUE, which is what makes this worth testing: the previous
 * parser was `args.filter(a => a !== "--background")`, and extending that shape
 * to a valued flag would leave the role id at the head of the prompt — or, if it
 * came first, read as the agent. Every case below is a way to get that wrong.
 */
describe("parseDelegateArgs", () => {
  test("pulls out agent, role and prompt, and the id never leaks into the prompt", () => {
    const r = parseDelegateArgs(["codex", "--role", "architect", "Design", "the", "schema"]);
    expect(r.agent).toBe("codex");
    expect(r.role).toBe("architect");
    expect(r.prompt).toBe("Design the schema");
    expect(r.prompt).not.toContain("architect");
  });

  test("--role=id is equivalent to --role id", () => {
    const a = parseDelegateArgs(["codex", "--role=reviewer", "look"]);
    const b = parseDelegateArgs(["codex", "--role", "reviewer", "look"]);
    expect(a).toEqual(b);
  });

  test("flags are positional-agnostic — the agent is still the first non-flag", () => {
    const r = parseDelegateArgs([
      "--background", "codex", "--write", "--role", "tester", "add", "tests",
    ]);
    expect(r.agent).toBe("codex");
    expect(r.role).toBe("tester");
    expect(r.background).toBe(true);
    expect(r.write).toBe(true);
    expect(r.prompt).toBe("add tests");
  });

  test("no --role is legal: delegation without a persona still works", () => {
    const r = parseDelegateArgs(["claude", "explain", "this"]);
    expect(r.role).toBeUndefined();
    expect(r.prompt).toBe("explain this");
    expect(r.background).toBe(false);
    expect(r.write).toBe(false);
  });

  test("a dangling --role is an ERROR, not a silent downgrade", () => {
    // Continuing without a role runs a personaless delegate that looks like a
    // success — the precise failure --role exists to prevent. An earlier version
    // of this test asserted the silent behaviour, which is how it got shipped.
    const r = parseDelegateArgs(["codex", "--role"]);
    expect(r.role).toBeUndefined();
    expect(r.roleError).toBeTruthy();
  });

  test("--role does not swallow a following flag as its value", () => {
    // `--role --write "task"` previously consumed `--write` as the role id,
    // silently dropping BOTH the persona and the write sandbox — so an Image
    // Creator delegation would run read-only and report success with no file.
    const r = parseDelegateArgs(["codex", "--role", "--write", "make", "a", "logo"]);
    expect(r.role).toBeUndefined();
    expect(r.roleError).toContain("--write");
    expect(r.write).toBe(true); // the flag still registered as a flag
    expect(r.prompt).toBe("make a logo");
  });

  test("an empty --role= is an error too", () => {
    const r = parseDelegateArgs(["codex", "--role=", "task"]);
    expect(r.role).toBeUndefined();
    expect(r.roleError).toBeTruthy();
  });

  test("a well-formed call reports no roleError", () => {
    expect(parseDelegateArgs(["codex", "--role", "tester", "x"]).roleError).toBeUndefined();
    expect(parseDelegateArgs(["codex", "x"]).roleError).toBeUndefined();
  });

  test("the prompt keeps its inner spacing and punctuation", () => {
    const r = parseDelegateArgs(["codex", "--role", "debugger", "why", "does", "x()", "fail?"]);
    expect(r.prompt).toBe("why does x() fail?");
  });
});

/**
 * The rendered skill is the ONLY caller of this parser in production — the lead
 * copies that command line verbatim. Parsing what we actually emit closes the
 * loop that unit-testing either half alone would leave open.
 */
describe("the emitted skill command round-trips through the parser", () => {
  test("every built-in role's command line parses back to that role", () => {
    for (const role of BUILTIN_ROLES) {
      const line = renderRoleSkill(role)
        .split("\n")
        .find((l) => l.startsWith("clidable team delegate"))!;
      expect(line).toBeDefined();

      // Drop the leading `clidable team delegate`, then stop at the quoted
      // placeholder standing in for the lead's real prompt — everything before
      // it is the flag surface this parser has to get right.
      const tokens = line.split(/\s+/).slice(3);
      const quoteAt = tokens.findIndex((t) => t.startsWith('"'));
      const argv = quoteAt === -1 ? tokens : tokens.slice(0, quoteAt);
      expect(argv).toContain("--role"); // the placeholder cut left the flags intact

      const parsed = parseDelegateArgs([...argv, "the", "task"]);
      expect(parsed.agent).toBe(role.handlerAgent);
      expect(parsed.role).toBe(role.id);
      expect(parsed.write).toBe(role.needsWrite === true);
      expect(parsed.prompt).toBe("the task");
    }
  });
});
