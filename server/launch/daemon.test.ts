import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachOutcome,
  busyAgentCount,
  clearLock,
  compareVersions,
  healthUrl,
  isHealthResponse,
  lockOwnerFor,
  planAttach,
  probeHealth,
  probeHost,
  probePort,
  readLock,
  serverBootArgv,
  serverPort,
  stopAdvice,
  stopIfAppOwned,
  stopServer,
  writeLock,
  type PortState,
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
  // Answers exactly like a real server. It used to answer a bare "ok", which
  // only passed because the health check then accepted ANY 200 — the same
  // looseness that let an SPA dev server pass for Clidable.
  const healthResponder = (body: unknown = { ok: true, version: "0.1.3", uptimeMs: 1, shell: "server" }) => {
    const srv = Bun.serve({ port: 0, fetch: () => Response.json(body) });
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

  it("never signals a pid whose lock port is held by something that isn't Clidable", async () => {
    // The pid-reuse guard: a crash leaves a stale lock whose pid the OS may
    // have recycled for an unrelated process. The guard only signals when
    // Clidable is answering on the lock's port — and "answering" used to mean
    // ANY 200, so an unrelated web server on that port would have let a
    // recycled pid be killed. Now only a real Clidable health response counts.
    const proc = fakeServerProcess();
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: proc.pid, port: healthResponder({ status: "fine" }), owner: "cli" }),
    );

    expect((await stopServer(lockFile)).stopped).toBe(false);
    expect(alive(proc.pid!)).toBe(true); // untouched
    proc.kill();
    await proc.exited;
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

  // Quitting the desktop app never stopped its server: the sidecar is spawned
  // from Rust, and the shell plugin only kills children spawned from JS. Every
  // quit — tray, ⌘Q, the one `brew upgrade` sends — left it running, which is
  // how upgrades kept serving the old version. The app now runs `__app-quit`.
  describe("stopIfAppOwned — what quitting the desktop app stops", () => {
    it("stops the server the app owns", async () => {
      const proc = fakeServerProcess();
      const port = healthResponder();
      writeFileSync(lockFile, JSON.stringify({ pid: proc.pid, port, owner: "app" }));

      expect((await stopIfAppOwned(port, lockFile)).stopped).toBe(true);
      await proc.exited;
      expect(alive(proc.pid)).toBe(false);
    });

    it("leaves a server started from a terminal running", async () => {
      // The app only attached to it. A lock from before the owner field is a
      // terminal's too.
      for (const owner of ["cli", undefined] as const) {
        const proc = fakeServerProcess();
        const port = healthResponder();
        writeFileSync(
          lockFile,
          JSON.stringify({ pid: proc.pid, port, ...(owner ? { owner } : {}) }),
        );

        expect((await stopIfAppOwned(port, lockFile)).stopped).toBe(false);
        expect(alive(proc.pid)).toBe(true);
      }
    });

    it("acts only on the lock for its own port", async () => {
      const proc = fakeServerProcess();
      const port = healthResponder();
      writeFileSync(lockFile, JSON.stringify({ pid: proc.pid, port, owner: "app" }));

      expect((await stopIfAppOwned(port + 1, lockFile)).stopped).toBe(false);
      expect(alive(proc.pid)).toBe(true);
    });

    it("never signals a pid when the port isn't answering as Clidable", async () => {
      // Forced stop, same pid-reuse guard: the app also quits after "another
      // program is using the port", when the lock may be a dead server's and
      // its pid may since belong to anything.
      const proc = fakeServerProcess();
      const port = healthResponder({ status: "fine" });
      writeFileSync(lockFile, JSON.stringify({ pid: proc.pid, port, owner: "app" }));

      expect((await stopIfAppOwned(port, lockFile)).stopped).toBe(false);
      expect(alive(proc.pid)).toBe(true);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * What holds the port — and what a newly started Clidable does about it.
 *
 * The regression behind all of this: a 0.1.1 server that had been running since
 * Sep 2 survived a dmg install, a `brew upgrade` AND a cask reinstall, because
 * every attach path checked "is something on the port?" rather than "is a
 * Clidable I'm compatible with on the port?". The same defect let an SPA dev
 * server on 7878 be opened as if it were Clidable.
 * -------------------------------------------------------------------------- */

const HEALTH = { ok: true, version: "0.1.3", uptimeMs: 1000, shell: "server" } as const;

/** A fetch stub that RECORDS what it was asked for — so a probe aimed at the
 *  wrong port or host fails a test instead of passing silently. */
function stubFetch(respond: (url: string) => { status?: number; body?: unknown; raw?: string } | "throw") {
  const calls: { url: string; hasSignal: boolean }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, hasSignal: init?.signal != null });
    const r = respond(url);
    if (r === "throw") throw new Error("ECONNREFUSED");
    const status = r.status ?? 200;
    const text = r.raw ?? JSON.stringify(r.body);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("isHealthResponse — what counts as a Clidable", () => {
  it("accepts the exact shape every release since 0.1.1 returns", () => {
    expect(isHealthResponse(HEALTH)).toBe(true);
    expect(isHealthResponse({ ...HEALTH, shell: "tauri-sidecar" })).toBe(true);
  });

  it("rejects a generic { ok, version } health endpoint from an unrelated app", () => {
    // `shell` is the field that makes this Clidable's and nobody else's.
    expect(isHealthResponse({ ok: true, version: "2.3.1" })).toBe(false);
    expect(isHealthResponse({ ...HEALTH, shell: "nginx" })).toBe(false);
  });

  it("rejects null and non-objects WITHOUT throwing", () => {
    // Rejected by the check itself — the earlier version only "handled" a null
    // body because `null.version` threw into an outer catch.
    for (const v of [null, undefined, "ok", 42, true, []]) {
      expect(() => isHealthResponse(v)).not.toThrow();
      expect(isHealthResponse(v)).toBe(false);
    }
  });

  it("rejects an empty version and a non-true ok", () => {
    expect(isHealthResponse({ ...HEALTH, version: "" })).toBe(false);
    expect(isHealthResponse({ ...HEALTH, ok: "true" })).toBe(false);
  });
});

describe("probeHealth", () => {
  it("asks the RIGHT port and host, with a timeout", async () => {
    const { impl, calls } = stubFetch(() => ({ body: HEALTH }));
    expect(await probeHealth(9123, { fetchImpl: impl })).toEqual(HEALTH);
    expect(calls).toEqual([{ url: "http://127.0.0.1:9123/api/health", hasSignal: true }]);
  });

  it("probes the bind address it's given, bracketing IPv6", async () => {
    const { impl, calls } = stubFetch(() => ({ body: HEALTH }));
    await probeHealth(7878, { host: "::1", fetchImpl: impl });
    expect(calls[0]!.url).toBe("http://[::1]:7878/api/health");
  });

  it("null for an SPA that answers 200 + index.html on every route", async () => {
    // The impostor that used to pass `res.ok` and get opened as Clidable.
    const { impl } = stubFetch(() => ({ raw: "<!doctype html><title>Vite App</title>" }));
    expect(await probeHealth(7878, { fetchImpl: impl })).toBeNull();
  });

  it("null for a 404, a refused connection, and a wrong shape", async () => {
    expect(await probeHealth(7878, { fetchImpl: stubFetch(() => ({ status: 404, raw: "nope" })).impl })).toBeNull();
    expect(await probeHealth(7878, { fetchImpl: stubFetch(() => "throw").impl })).toBeNull();
    expect(await probeHealth(7878, { fetchImpl: stubFetch(() => ({ body: { ok: true } })).impl })).toBeNull();
    expect(await probeHealth(7878, { fetchImpl: stubFetch(() => ({ raw: "null" })).impl })).toBeNull();
  });
});

describe("probePort — free vs Clidable vs something else", () => {
  const up = async () => true;
  const down = async () => false;

  it("a Clidable answering health is 'clidable', without a TCP probe", async () => {
    let tcp = 0;
    const state = await probePort(7878, {
      fetchImpl: stubFetch(() => ({ body: HEALTH })).impl,
      listening: async () => (tcp++, true),
    });
    expect(state).toEqual({ kind: "clidable", health: HEALTH });
    expect(tcp).toBe(0); // the common case costs one request, not two
  });

  it("no health and nothing listening is 'free'", async () => {
    expect(await probePort(7878, { fetchImpl: stubFetch(() => "throw").impl, listening: down })).toEqual({
      kind: "free",
    });
  });

  it("no health but SOMETHING listening is 'foreign' — the case that used to lie", async () => {
    for (const respond of [() => ({ status: 404, raw: "Not Found" }), () => ({ raw: "<html>" }), () => "throw" as const]) {
      expect(await probePort(7878, { fetchImpl: stubFetch(respond).impl, listening: up })).toEqual({
        kind: "foreign",
      });
    }
  });
});

describe("probeHost / healthUrl", () => {
  it("a wildcard bind is probed via loopback; anything else as itself", () => {
    expect(probeHost("0.0.0.0")).toBe("127.0.0.1");
    expect(probeHost("::")).toBe("127.0.0.1");
    expect(probeHost("::1")).toBe("::1");
    expect(probeHost("100.64.0.7")).toBe("100.64.0.7");
  });

  it("brackets an IPv6 host and leaves IPv4 alone", () => {
    expect(healthUrl(7878, "::1")).toBe("http://[::1]:7878/api/health");
    expect(healthUrl(7878, "127.0.0.1")).toBe("http://127.0.0.1:7878/api/health");
  });
});

describe("compareVersions", () => {
  it("orders by major, minor, patch numerically — not as strings", () => {
    expect(compareVersions("0.1.1", "0.1.3")).toBeLessThan(0);
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0); // "10" < "9" as strings
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.3", "0.1.3")).toBe(0);
  });

  it("is antisymmetric — the bug was treating 'different' as 'older'", () => {
    expect(Math.sign(compareVersions("0.1.1", "0.1.3"))).toBe(-Math.sign(compareVersions("0.1.3", "0.1.1")));
  });

  it("puts a prerelease before its release, and tolerates a leading v", () => {
    expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBeLessThan(0);
    expect(compareVersions("v0.1.3", "0.1.3")).toBe(0);
  });
});

describe("busyAgentCount", () => {
  it("counts only agents a restart would cut off mid-task", async () => {
    const { impl, calls } = stubFetch(() => ({
      body: {
        agents: [
          { state: "working" },
          { state: "blocked" }, // waiting on an approval — mid-task
          { state: "idle" }, // resumes its conversation after a restart
          { state: "done" },
        ],
      },
    }));
    expect(await busyAgentCount(9123, { fetchImpl: impl })).toBe(2);
    expect(calls[0]!.url).toBe("http://127.0.0.1:9123/api/agents/live");
  });

  it("null — not zero — when it can't tell, so a restart isn't assumed safe", async () => {
    expect(await busyAgentCount(7878, { fetchImpl: stubFetch(() => "throw").impl })).toBeNull();
    expect(await busyAgentCount(7878, { fetchImpl: stubFetch(() => ({ status: 500, raw: "" })).impl })).toBeNull();
    expect(await busyAgentCount(7878, { fetchImpl: stubFetch(() => ({ body: { nope: 1 } })).impl })).toBeNull();
  });
});

describe("planAttach — the decision for each thing a launch can find", () => {
  const clidable = (version: string): PortState => ({ kind: "clidable", health: { ...HEALTH, version } });
  const base = { ours: "0.1.3", owner: "app" as const, busyAgents: 0 };

  it("nothing on the port → start", () => {
    expect(planAttach({ ...base, state: { kind: "free" } })).toEqual({ action: "start" });
  });

  it("same version → attach, silently (the everyday reopen)", () => {
    expect(planAttach({ ...base, state: clidable("0.1.3") })).toEqual({
      action: "attach",
      running: "0.1.3",
      relation: "same",
    });
  });

  it("a NEWER server → attach, never 'replace' it with an older build", () => {
    expect(planAttach({ ...base, state: clidable("0.2.0") })).toEqual({
      action: "attach",
      running: "0.2.0",
      relation: "newer",
    });
  });

  it("older, idle and app-owned → replace without asking (tonight's 0.1.1)", () => {
    expect(planAttach({ ...base, state: clidable("0.1.1") })).toEqual({ action: "replace", running: "0.1.1" });
  });

  it("older with agents mid-task → ask, and say how many", () => {
    expect(planAttach({ ...base, busyAgents: 2, state: clidable("0.1.1") })).toEqual({
      action: "ask",
      running: "0.1.1",
      reason: "busy-agents",
      busy: 2,
    });
  });

  it("older but agents unknowable → ask; never assume a restart is safe", () => {
    expect(planAttach({ ...base, busyAgents: null, state: clidable("0.1.1") }).action).toBe("ask");
  });

  it("older, started from a terminal → ask; it may carry flags like --allow-lan", () => {
    expect(planAttach({ ...base, owner: "cli", state: clidable("0.1.1") })).toMatchObject({
      action: "ask",
      reason: "not-app-owned",
    });
    // No lock for this port at all reads the same way: unknown is not "ours".
    expect(planAttach({ ...base, owner: null, state: clidable("0.1.1") }).action).toBe("ask");
  });

  it("busy agents outrank ownership — they're what a restart destroys", () => {
    expect(planAttach({ ...base, owner: "cli", busyAgents: 1, state: clidable("0.1.1") })).toMatchObject({
      reason: "busy-agents",
    });
  });

  it("something that isn't Clidable → refuse", () => {
    expect(planAttach({ ...base, state: { kind: "foreign" } })).toEqual({ action: "refuse", reason: "foreign" });
  });
});

describe("attachOutcome / stopAdvice — what the CLI tells you, and its exit code", () => {
  it("same or newer is success (0); the newer case says so without alarm", () => {
    const same = attachOutcome({ action: "attach", running: "0.1.3", relation: "same" }, 7878, "0.1.3", "app");
    expect(same.code).toBe(0);
    const newer = attachOutcome({ action: "attach", running: "0.2.0", relation: "newer" }, 7878, "0.1.3", "app");
    expect(newer.code).toBe(0);
    expect(newer.text).toContain("newer");
    expect(newer.text).not.toMatch(/older/i);
  });

  it("an OLDER server warns and exits 1 so scripts can tell nothing changed", () => {
    const out = attachOutcome({ action: "replace", running: "0.1.1" }, 7878, "0.1.3", "app");
    expect(out.level).toBe("warn");
    expect(out.code).toBe(1);
    expect(out.text).toContain("0.1.1");
    expect(out.text).toContain("0.1.3");
  });

  it("a foreign process is an error naming the way out", () => {
    const out = attachOutcome({ action: "refuse", reason: "foreign" }, 7878, "0.1.3", null);
    expect(out.level).toBe("error");
    expect(out.code).toBe(1);
    expect(out.text).toMatch(/isn't Clidable/);
    expect(out.text).toContain("--port");
  });

  it("never tells an app's user to run a stop that refuses app-owned servers", () => {
    // A plain `clidable stop` is refused for an app-owned server, so advising
    // it sends the user into a wall. So does "quit from the tray": this advice
    // is for an OLDER server, whose app may predate quit stopping the server.
    expect(stopAdvice("app")).toContain("clidable stop --force");
    expect(stopAdvice("app")).not.toMatch(/Run `clidable stop`,/);
    expect(stopAdvice("app")).not.toMatch(/tray/i);
    expect(stopAdvice("cli")).toContain("clidable stop");
  });
});

describe("lockOwnerFor", () => {
  it("reads the owner recorded for THIS port only", () => {
    writeFileSync(lockFile, JSON.stringify({ pid: 1, port: 7878, owner: "app" }));
    expect(lockOwnerFor(7878, lockFile)).toBe("app");
    // A lock for another port says nothing about this one.
    expect(lockOwnerFor(9000, lockFile)).toBeNull();
  });

  it("a lock from before the owner field reads as 'cli', like stopServer", () => {
    writeFileSync(lockFile, JSON.stringify({ pid: 1, port: 7878 }));
    expect(lockOwnerFor(7878, lockFile)).toBe("cli");
  });

  it("no lock → null", () => {
    expect(lockOwnerFor(7878, join(tmp, "missing.lock"))).toBeNull();
  });
});
