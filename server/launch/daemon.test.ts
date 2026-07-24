import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearLock,
  healthUrl,
  readLock,
  serverBootArgv,
  serverPort,
  stopServer,
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
  it("writes {pid,port,owner}, reads it back, and clears", () => {
    expect(readLock(lockFile)).toBeNull();
    writeLock(7878, lockFile);
    const lock = readLock(lockFile)!;
    expect(lock.port).toBe(7878);
    expect(lock.pid).toBe(process.pid);
    expect(lock.owner).toBe("cli"); // no CLIDABLE_OWNED_BY_APP in tests
    clearLock(lockFile);
    expect(existsSync(lockFile)).toBe(false);
    expect(readLock(lockFile)).toBeNull();
  });

  it("records owner app when spawned by the desktop shell", () => {
    process.env.CLIDABLE_OWNED_BY_APP = "1";
    try {
      writeLock(7878, lockFile);
      expect(readLock(lockFile)!.owner).toBe("app");
    } finally {
      delete process.env.CLIDABLE_OWNED_BY_APP;
    }
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

/**
 * The app-owned guard on stop. The one dangerous case is a LIVE app-owned
 * server: killing it strands the app's windows (the app only spawns its
 * sidecar at launch). Tests use a real child process as the "server" pid and
 * a real listener for the health check, because the guard's safety property
 * is "the process is still alive afterward" — an assertion a mock can't make
 * honestly.
 */
describe("stopServer app-owned guard", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

  /** A long-lived child standing in for the server process. */
  const fakeServerProcess = () => {
    const proc = Bun.spawn(["bun", "-e", "setInterval(() => {}, 1000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    cleanup.push(() => proc.kill());
    return proc;
  };

  /** A real /api/health responder so serverHealthy() sees a live server. */
  const healthResponder = () => {
    const srv = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    cleanup.push(() => void srv.stop(true));
    if (srv.port == null) throw new Error("could not bind a test port");
    return srv.port;
  };

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0); // signal 0 = existence probe
      return true;
    } catch {
      return false;
    }
  };

  it("refuses a live app-owned server and leaves it running", async () => {
    const proc = fakeServerProcess();
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: proc.pid, port: healthResponder(), owner: "app" }),
    );

    const res = await stopServer(lockFile);
    expect(res).toEqual({ stopped: false, pid: proc.pid, refusedAppOwned: true });
    expect(alive(proc.pid)).toBe(true); // the safety property itself
  });

  it("--force kills an app-owned server", async () => {
    const proc = fakeServerProcess();
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: proc.pid, port: healthResponder(), owner: "app" }),
    );

    const res = await stopServer(lockFile, { force: true });
    expect(res.stopped).toBe(true);
    await proc.exited;
    expect(alive(proc.pid)).toBe(false);
  });

  it("cli-owned and legacy owner-less locks stop normally", async () => {
    for (const owner of ["cli", undefined] as const) {
      const proc = fakeServerProcess();
      writeFileSync(
        lockFile,
        JSON.stringify({ pid: proc.pid, port: healthResponder(), ...(owner ? { owner } : {}) }),
      );

      expect((await stopServer(lockFile)).stopped).toBe(true);
      await proc.exited;
    }
  });

  it("a dead app-owned server is a stale lock, not a refusal", async () => {
    // Nothing serving on the lock's port → the stale-lock path must win over
    // the owner check: the pid may be recycled, so it must NOT be signaled —
    // and a dead server can't strand anything.
    const srv = Bun.serve({ port: 0, fetch: () => new Response("") });
    const deadPort = srv.port!;
    await srv.stop(true); // port now guaranteed unoccupied
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: 999999, port: deadPort, owner: "app" }),
    );

    const res = await stopServer(lockFile);
    expect(res.stopped).toBe(false);
    expect(res.refusedAppOwned).toBeUndefined();
  });
});
