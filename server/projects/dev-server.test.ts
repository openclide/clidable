/**
 * Adoption: when a project's port is already served from inside that project,
 * Run must attach to it instead of starting a rival dev server. Next.js makes
 * this load-bearing — it refuses to start a second dev server for the same
 * directory whatever port we pass, so "just scan to the next free port" leaves
 * the user with nothing running at all.
 *
 * The adoption tests spawn a REAL listener in a child process, because the
 * ownership signal is the listening process's working directory.
 *
 * Also covered here: `launchable` (the signal the UI auto-runs on) and the
 * rule that two projects of one framework must not land on the same port.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devServerStatus, startDevServer, stopDevServer } from "./dev-server";
import { writeLaunchConfig } from "./launch-config";
import { detectProject } from "./detect";

const cleanup: Array<() => unknown> = [];

/**
 * Teardown is LIFO, awaited, and never fatal — all three matter, and all three
 * were once wrong here in a way only Windows noticed:
 *
 *  - **LIFO.** A helper registers "remove this dir" when it creates the dir,
 *    and the test registers "stop the dev server" later. In insertion order the
 *    directory removal ran while the server still had it as its cwd — which
 *    POSIX permits and Windows refuses (`EBUSY`).
 *  - **Awaited + caught.** These used to be `() => void rm(...)`, so a rejected
 *    removal became an unhandled rejection: bun printed "Unhandled error
 *    between tests" and exited 1 with `0 fail`, i.e. a red suite with no
 *    failing assertion to point at.
 *  - **Never fatal.** A scratch dir we couldn't unlink is for the OS temp
 *    sweeper to deal with, not a reason to fail the run.
 */
afterAll(async () => {
  for (const fn of [...cleanup].reverse()) {
    try {
      await fn();
    } catch {
      // best-effort teardown
    }
  }
});

/** Remove a scratch dir, retrying while Windows releases handles a dying
 *  child still holds. Gives up quietly rather than failing the suite. */
async function rmTemp(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(50);
    }
  }
}

/** A project dir pinned to `port` via .clidable/launch.json, and no dev script —
 *  so a non-adopting run fails loudly instead of spawning anything. */
async function project(port: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clidable-adopt-"));
  await mkdir(join(dir, ".clidable"), { recursive: true });
  await writeFile(join(dir, ".clidable/launch.json"), JSON.stringify({ port }));
  cleanup.push(() => rmTemp(dir));
  return dir;
}

/** Serve on `port` from `cwd`, in a separate process (cwd is the whole point). */
async function serveFrom(cwd: string, port: number): Promise<void> {
  const proc = Bun.spawn(
    ["bun", "-e", `Bun.serve({port:${port},fetch:()=>new Response("ok")})`],
    { cwd, stdout: "ignore", stderr: "ignore" },
  );
  cleanup.push(async () => {
    proc.kill();
    await proc.exited; // release the cwd handle before any rm below
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(200) });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error(`test listener never came up on ${port}`);
}

/** A port nothing is on right now. */
async function freePort(): Promise<number> {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port;
  await s.stop(true);
  if (port == null) throw new Error("could not reserve a test port");
  return port;
}

// Adoption is POSIX-only by construction: `projectOwnedPids` returns [] on
// Windows because identifying a listener's working directory needs lsof. Both
// tests are skipped there rather than one — the negative case would otherwise
// pass for the WRONG reason (no adoption ever happens), which is worse than
// no coverage because it reads as a green Windows assertion.
const posixOnly = test.skipIf(process.platform === "win32");

posixOnly("adopts a dev server already serving from inside the project", async () => {
  const port = await freePort();
  const dir = await project(port);
  await serveFrom(dir, port);

  expect(await startDevServer(dir, "node")).toEqual({
    port,
    url: `http://localhost:${port}`,
  });
  // Adopted, not spawned — so Stop has to work off the port alone.
  expect(stopDevServer(dir)).toBe(true);
});

posixOnly("does not adopt a port held from outside the project", async () => {
  const port = await freePort();
  const dir = await project(port);
  const other = await mkdtemp(join(tmpdir(), "clidable-other-"));
  cleanup.push(() => rmTemp(other));
  await serveFrom(other, port);

  // No adoption → falls through to a normal start, which has nothing to run.
  expect(startDevServer(dir, "node")).rejects.toThrow(/No dev command detected/);
});

/**
 * `launchable` is the signal the UI uses to decide whether to auto-run on open.
 * It has to account for BOTH halves — a configured command and a detected
 * framework — because the client previously answered it from a hardcoded
 * framework list and so ignored an explicit `command` in launch.json. That is
 * why a scaffolded Expo project sat at "not running" with a seeded config
 * sitting right there on disk.
 */
describe("devServerStatus.launchable", () => {
  test("true from a configured command even when the framework has no plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clidable-launchable-"));
    cleanup.push(() => rmTemp(dir));
    await writeLaunchConfig(dir, { command: "bun run web", port: 8081 });

    // A bare directory detects as "unknown", so detection alone would say no —
    // the configured command is the only thing making this launchable.
    expect((await devServerStatus(dir)).launchable).toBe(true);
  });

  test("false when there is neither a config nor a detectable dev script", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clidable-launchable-"));
    cleanup.push(() => rmTemp(dir));
    expect((await devServerStatus(dir)).launchable).toBe(false);
  });
});

/**
 * Two projects of the SAME framework must not collide on a port.
 *
 * Expo made this concrete: its dev server defaults to 8081, and a first
 * attempt at supporting it pinned that port per project via launch.json. Open a
 * second Expo project in the same workspace and the port was already serving
 * the FIRST project, so the second reported its neighbour's URL and the preview
 * showed the wrong app. The fix is that Expo takes an injected `--port` like
 * any other flag-style framework (its `--help` claims otherwise; measured, it
 * does), so each project free-scans its own.
 */
describe("two projects of one framework", () => {
  /** A project whose `web` script serves a body identifying itself. */
  async function expoish(body: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "clidable-multi-"));
    cleanup.push(() => rmTemp(dir));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: body,
        // `--port <n>` is appended by buildCommand; this stand-in honours it the
        // way `expo start --web` does, without booting Metro.
        scripts: { web: `bun -e 'const p=+Bun.argv.at(-1);Bun.serve({port:p,fetch:()=>new Response("${body}")})' --` },
        dependencies: { expo: "*" },
      }),
    );
    return dir;
  }

  test("each gets its own port, and each preview serves its own app", async () => {
    const a = await expoish("APP_A");
    const b = await expoish("APP_B");

    // Go through detection rather than passing "expo" in: the dependency in
    // package.json is what a real project has, and hand-feeding the framework
    // would let this pass even if Expo stopped being detected at all.
    const [fa, fb] = await Promise.all([detectProject(a), detectProject(b)]);
    expect(fa.framework).toBe("expo");
    expect(fb.framework).toBe("expo");

    const ra = await startDevServer(a, fa.framework);
    const rb = await startDevServer(b, fb.framework);
    cleanup.push(() => stopDevServer(a));
    cleanup.push(() => stopDevServer(b));

    expect(ra.port).not.toBe(rb.port); // the actual regression

    const [ta, tb] = await Promise.all([
      fetch(ra.url).then((r) => r.text()),
      fetch(rb.url).then((r) => r.text()),
    ]);
    expect(ta).toBe("APP_A");
    expect(tb).toBe("APP_B"); // not APP_A — the reported symptom
  }, 60_000);
});
