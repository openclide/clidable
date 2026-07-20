import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearLock,
  healthUrl,
  readLock,
  serverBootArgv,
  serverPort,
  writeLock,
} from "./daemon";

const tmp = mkdtempSync(join(tmpdir(), "clidable-daemon-"));
const lockFile = join(tmp, "server.lock");

afterEach(() => {
  try {
    rmSync(lockFile);
  } catch {
    // already gone
  }
});

describe("serverPort", () => {
  const orig = process.env.CLIDABLE_PORT;
  afterEach(() => {
    if (orig === undefined) delete process.env.CLIDABLE_PORT;
    else process.env.CLIDABLE_PORT = orig;
  });

  it("defaults to 7878 and honors a valid CLIDABLE_PORT", () => {
    delete process.env.CLIDABLE_PORT;
    expect(serverPort()).toBe(7878);
    process.env.CLIDABLE_PORT = "9001";
    expect(serverPort()).toBe(9001);
  });

  it("falls back to 7878 on a garbage / out-of-range port", () => {
    process.env.CLIDABLE_PORT = "not-a-port";
    expect(serverPort()).toBe(7878);
    process.env.CLIDABLE_PORT = "70000";
    expect(serverPort()).toBe(7878);
  });
});

describe("healthUrl", () => {
  it("targets loopback /api/health on the given port", () => {
    expect(healthUrl(9001)).toBe("http://127.0.0.1:9001/api/health");
  });
});

describe("lockfile round-trip", () => {
  it("writes {pid,port}, reads it back, and clears", () => {
    expect(readLock(lockFile)).toBeNull();
    writeLock(7878, lockFile);
    const lock = readLock(lockFile)!;
    expect(lock.port).toBe(7878);
    expect(lock.pid).toBe(process.pid);
    clearLock(lockFile);
    expect(existsSync(lockFile)).toBe(false);
    expect(readLock(lockFile)).toBeNull();
  });

  it("tolerates a malformed lockfile → null", () => {
    Bun.write(lockFile, "{not json");
    expect(readLock(lockFile)).toBeNull();
  });
});

describe("serverBootArgv", () => {
  it("boots the same runtime+entry with an explicit --port", () => {
    const argv = serverBootArgv(7878);
    expect(argv).toContain("--port");
    expect(argv[argv.indexOf("--port") + 1]).toBe("7878");
    // Under `bun test` the runtime is bun, so the entry script is included.
    expect(argv[0]).toBe(process.execPath);
    expect(argv.length).toBeGreaterThanOrEqual(3);
  });
});
