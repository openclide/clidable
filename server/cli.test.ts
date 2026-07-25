import { afterEach, describe, expect, test } from "bun:test";
import { parseConfig } from "./cli";
import packageJson from "../package.json" with { type: "json" };

/** parseConfig reads Bun.argv + process.env. Save/restore both around each
 *  test so cases don't leak into one another. */
const savedArgv = [...Bun.argv];
const savedAllowLan = process.env.CLIDABLE_ALLOW_LAN;
const savedBind = process.env.CLIDABLE_BIND;

function withArgs(args: string[]): void {
  // Bun.argv is [bun, script, ...flags]; replace the flags in place.
  Bun.argv.length = 2;
  Bun.argv.push(...args);
}

afterEach(() => {
  Bun.argv.length = 0;
  Bun.argv.push(...savedArgv);
  if (savedAllowLan === undefined) delete process.env.CLIDABLE_ALLOW_LAN;
  else process.env.CLIDABLE_ALLOW_LAN = savedAllowLan;
  if (savedBind === undefined) delete process.env.CLIDABLE_BIND;
  else process.env.CLIDABLE_BIND = savedBind;
});

describe("parseConfig — localhost-only default + --allow-lan escape hatch", () => {
  test("the default is a loopback bind", () => {
    delete process.env.CLIDABLE_BIND;
    withArgs([]);
    expect(parseConfig().bind).toBe("127.0.0.1");
  });

  test("a non-loopback bind is REFUSED without opt-in", () => {
    withArgs(["--bind", "0.0.0.0"]);
    expect(() => parseConfig()).toThrow(/localhost-only by default/);
  });

  test("--allow-lan permits the non-loopback bind", () => {
    withArgs(["--bind", "0.0.0.0", "--allow-lan"]);
    const config = parseConfig();
    expect(config.bind).toBe("0.0.0.0");
    expect(config.allowLan).toBe(true);
  });

  test("CLIDABLE_ALLOW_LAN=1 is equivalent to the flag", () => {
    process.env.CLIDABLE_ALLOW_LAN = "1";
    withArgs(["--bind", "::"]);
    expect(parseConfig().bind).toBe("::");
  });

  test("a loopback bind never needs the opt-in and leaves allowLan false", () => {
    withArgs(["--bind", "127.0.0.2"]);
    const config = parseConfig();
    expect(config.bind).toBe("127.0.0.2");
    expect(config.allowLan).toBe(false);
  });

  test("--allow-lan on a loopback bind is a harmless no-op (still allowed)", () => {
    withArgs(["--allow-lan"]);
    const config = parseConfig();
    expect(config.bind).toBe("127.0.0.1");
    expect(config.allowLan).toBe(true);
  });

  test("--auth / --tls are still refused regardless of --allow-lan (no auth by design)", () => {
    withArgs(["--bind", "0.0.0.0", "--allow-lan", "--auth", "token"]);
    expect(() => parseConfig()).toThrow(/no built-in auth\/TLS by design/);
  });
});

/**
 * The argv guard in server/index.ts, exercised through a real process because
 * that is the only way to observe it: it lives at module scope and calls
 * process.exit, so it can't be imported and called.
 *
 * What makes these worth the spawn cost: every one of these argv shapes used to
 * fall through and BOOT A SERVER — binding a port, taking the singleton lock,
 * running migrations — which is the worst possible response to `--version`.
 */
describe("CLI entry guard", () => {
  const run = (args: string[]): { out: string; code: number } => {
    const p = Bun.spawnSync(["bun", "server/index.ts", ...args], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      out: p.stdout.toString() + p.stderr.toString(),
      code: p.exitCode ?? -1,
    };
  };

  test.each([["--version"], ["-V"], ["version"]])(
    "%s prints the bare version and exits 0",
    (flag) => {
      const { out, code } = run([flag]);
      expect(code).toBe(0);
      // Bare, unprefixed: `brew test` and release scripts consume this.
      expect(out.trim()).toBe(packageJson.version);
    },
  );

  test.each([["--help"], ["-h"], ["help"]])("%s prints usage and exits 0", (flag) => {
    const { out, code } = run([flag]);
    expect(code).toBe(0);
    expect(out).toContain("usage: clidable");
  });

  test("a typo'd subcommand errors with usage and exits 2 (never starts a server)", () => {
    const { out, code } = run(["skils", "list"]);
    expect(code).toBe(2);
    expect(out).toContain('unknown command "skils"');
  });

  test("a value-taking flag's value is not mistaken for a command", () => {
    // `--port 9999` must not read "9999" as a subcommand. Uses --print on `open`
    // so nothing is actually started.
    const { code } = run(["open", "--print", "--port", "9999"]);
    expect(code).toBe(0);
  });
});
