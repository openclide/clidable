import { afterEach, describe, expect, test } from "bun:test";
import { parseConfig } from "./cli";

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
