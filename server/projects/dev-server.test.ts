/**
 * Adoption: when a project's port is already served from inside that project,
 * Run must attach to it instead of starting a rival dev server. Next.js makes
 * this load-bearing — it refuses to start a second dev server for the same
 * directory whatever port we pass, so "just scan to the next free port" leaves
 * the user with nothing running at all.
 *
 * Both tests spawn a REAL listener in a child process, because the ownership
 * signal is the listening process's working directory.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDevServer, stopDevServer } from "./dev-server";

const cleanup: Array<() => void> = [];
afterAll(() => cleanup.forEach((fn) => fn()));

/** A project dir pinned to `port` via .clidable/launch.json, and no dev script —
 *  so a non-adopting run fails loudly instead of spawning anything. */
async function project(port: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clidable-adopt-"));
  await mkdir(join(dir, ".clidable"), { recursive: true });
  await writeFile(join(dir, ".clidable/launch.json"), JSON.stringify({ port }));
  cleanup.push(() => void rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Serve on `port` from `cwd`, in a separate process (cwd is the whole point). */
async function serveFrom(cwd: string, port: number): Promise<void> {
  const proc = Bun.spawn(
    ["bun", "-e", `Bun.serve({port:${port},fetch:()=>new Response("ok")})`],
    { cwd, stdout: "ignore", stderr: "ignore" },
  );
  cleanup.push(() => proc.kill());
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
  cleanup.push(() => void rm(other, { recursive: true, force: true }));
  await serveFrom(other, port);

  // No adoption → falls through to a normal start, which has nothing to run.
  expect(startDevServer(dir, "node")).rejects.toThrow(/No dev command detected/);
});
