import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathExists } from "../util/fs";
import {
  buildCommand,
  detectLaunchPlan,
  detectPackageManager,
  detectScript,
  portFromUrl,
  readLaunchConfig,
  resolveLaunch,
  writeLaunchConfig,
} from "./launch-config";

const dirs: string[] = [];

/** A throwaway project dir with the given files ({ relpath: contents }). */
async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clidable-launch-"));
  dirs.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, contents, "utf8");
  }
  return dir;
}

const pkg = (extra: Record<string, unknown>): string =>
  JSON.stringify({ name: "x", ...extra });

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("detectPackageManager", () => {
  test("reads the lockfile", async () => {
    expect(await detectPackageManager(await project({ "bun.lock": "" }))).toBe("bun");
    expect(await detectPackageManager(await project({ "pnpm-lock.yaml": "" }))).toBe("pnpm");
    expect(await detectPackageManager(await project({ "yarn.lock": "" }))).toBe("yarn");
    expect(await detectPackageManager(await project({ "package-lock.json": "" }))).toBe("npm");
  });
  test("defaults to bun with no lockfile", async () => {
    expect(await detectPackageManager(await project({}))).toBe("bun");
  });
});

describe("detectScript", () => {
  test("prefers dev > start > serve", async () => {
    expect(await detectScript(await project({ "package.json": pkg({ scripts: { dev: "x", start: "y" } }) }))).toBe("dev");
    expect(await detectScript(await project({ "package.json": pkg({ scripts: { start: "y", serve: "z" } }) }))).toBe("start");
    expect(await detectScript(await project({ "package.json": pkg({ scripts: { serve: "z" } }) }))).toBe("serve");
  });
  test("null when no matching script / no package.json", async () => {
    expect(await detectScript(await project({ "package.json": pkg({ scripts: { build: "x" } }) }))).toBeNull();
    expect(await detectScript(await project({}))).toBeNull();
  });
});

describe("buildCommand", () => {
  test("flag injection, per package manager", () => {
    expect(buildCommand("bun", "dev", "flag", 5173)).toBe("bun run dev --port 5173 --host 127.0.0.1");
    expect(buildCommand("npm", "dev", "flag", 5173)).toBe("npm run dev -- --port 5173 --host 127.0.0.1");
    expect(buildCommand("pnpm", "dev", "flag", 5173)).toBe("pnpm dev --port 5173 --host 127.0.0.1");
    expect(buildCommand("yarn", "dev", "flag", 5173)).toBe("yarn dev --port 5173 --host 127.0.0.1");
  });
  // `isWindows` is passed explicitly in both directions: these assertions are
  // about shell syntax, not about the host running the suite (CI runs it on
  // Windows too).
  test("env injection uses a POSIX prefix on posix shells", () => {
    expect(buildCommand("bun", "dev", "env", 3000, false, false)).toBe("PORT=3000 bun run dev");
    expect(buildCommand("npm", "start", "env", 3000, false, false)).toBe("PORT=3000 npm run start");
    expect(buildCommand("pnpm", "dev", "env", 3000, false, false)).toBe("PORT=3000 pnpm dev");
  });
  test("env injection omits the prefix on Windows (cmd.exe can't parse it)", () => {
    // cmd.exe reads `PORT=3000 npm run dev` as a program called "PORT=3000";
    // the port reaches the script through the shell's env instead.
    expect(buildCommand("bun", "dev", "env", 3000, false, true)).toBe("bun run dev");
    expect(buildCommand("npm", "start", "env", 3000, false, true)).toBe("npm run start");
    expect(buildCommand("pnpm", "dev", "env", 3000, false, true)).toBe("pnpm dev");
    // Flag injection is already shell-agnostic — unchanged on Windows.
    expect(buildCommand("npm", "dev", "flag", 5173, false, true)).toBe(
      "npm run dev -- --port 5173 --host 127.0.0.1",
    );
  });
});

describe("detectLaunchPlan", () => {
  test("vite → flag command on 5173", async () => {
    const dir = await project({ "package.json": pkg({ scripts: { dev: "vite" } }), "bun.lock": "" });
    const plan = await detectLaunchPlan(dir, "vite");
    expect(plan.runnable).toBe(true);
    expect(plan.port).toBe(5173);
    expect(plan.command).toBe("bun run dev --port 5173 --host 127.0.0.1");
    expect(plan.url).toBe("http://localhost:5173");
  });
  test("node → env command on 3000", async () => {
    const dir = await project({ "package.json": pkg({ scripts: { dev: "node ." } }), "package-lock.json": "" });
    const plan = await detectLaunchPlan(dir, "node");
    expect(plan.command).toBe("PORT=3000 npm run dev");
  });
  test("no dev script → not runnable", async () => {
    const plan = await detectLaunchPlan(await project({ "package.json": pkg({ scripts: {} }) }), "node");
    expect(plan.runnable).toBe(false);
    expect(plan.command).toBe("");
  });
  test("unknown framework → not runnable", async () => {
    const plan = await detectLaunchPlan(await project({ "go.mod": "module x" }), "go");
    expect(plan.runnable).toBe(false);
  });
});

describe("readLaunchConfig / writeLaunchConfig", () => {
  test("round-trips and drops blank/invalid fields", async () => {
    const dir = await project({});
    await writeLaunchConfig(dir, { command: "  npm run dev  ", port: 3000, url: "http://x:3000" });
    expect(await readLaunchConfig(dir)).toEqual({ command: "npm run dev", port: 3000, url: "http://x:3000" });

    // Blank command + out-of-range port + blank url → all dropped (config cleared).
    await writeLaunchConfig(dir, { command: "   ", port: 0, url: "" });
    expect(await readLaunchConfig(dir)).toEqual({});
  });
  test("missing file → empty config", async () => {
    expect(await readLaunchConfig(await project({}))).toEqual({});
  });
  test("malformed file → empty config (never throws)", async () => {
    const dir = await project({ ".clidable/launch.json": "{ not json" });
    expect(await readLaunchConfig(dir)).toEqual({});
  });
});

describe("portFromUrl", () => {
  test("returns only an explicit port", () => {
    expect(portFromUrl("http://localhost:3000")).toBe(3000);
    expect(portFromUrl("https://box.ts.net:8443")).toBe(8443);
    expect(portFromUrl("not a url")).toBeNull();
    expect(portFromUrl(undefined)).toBeNull();
  });
  // A port-less URL means "reach it over the protocol default, usually through
  // a proxy" — binding 443/80 locally needs root and would break the remote case.
  test("never infers the protocol default as a bind port", () => {
    expect(portFromUrl("https://box.ts.net")).toBeNull();
    expect(portFromUrl("http://box.ts.net")).toBeNull();
  });
});

describe("resolveLaunch", () => {
  test("no config → detected drives it, free-scan (fixedPort null)", async () => {
    const dir = await project({ "package.json": pkg({ scripts: { dev: "vite" } }), "bun.lock": "" });
    const r = await resolveLaunch(dir, "vite");
    expect(r.customCommand).toBeNull();
    expect(r.detected).toEqual({ pm: "bun", script: "dev", inject: "flag", noHostFlag: false });
    expect(r.fixedPort).toBeNull();
    expect(r.defaultPort).toBe(5173);
    expect(r.urlOverride).toBeNull();
  });
  test("custom command + fixed port + url override win", async () => {
    const dir = await project({ "package.json": pkg({ scripts: { dev: "vite" } }), "bun.lock": "" });
    await writeLaunchConfig(dir, { command: "make serve", port: 8080, url: "https://box.ts.net:8080" });
    const r = await resolveLaunch(dir, "vite");
    expect(r.customCommand).toBe("make serve");
    expect(r.fixedPort).toBe(8080);
    expect(r.urlOverride).toBe("https://box.ts.net:8080");
  });
  test("url with an explicit port implies the port to bind", async () => {
    const dir = await project({ "package.json": pkg({ scripts: { dev: "next dev" } }), "bun.lock": "" });
    await writeLaunchConfig(dir, { url: "http://localhost:4000" });
    const r = await resolveLaunch(dir, "nextjs");
    expect(r.fixedPort).toBe(4000);
    expect(r.urlOverride).toBe("http://localhost:4000");
  });

  // The remote/Tailscale case: the server keeps its own local port and is merely
  // *reached* over 443. Pinning 443 as the bind port would need root and fail.
  test("port-less remote url does NOT pin the bind port", async () => {
    const dir = await project({ "package.json": pkg({ scripts: { dev: "next dev" } }), "bun.lock": "" });
    await writeLaunchConfig(dir, { url: "https://box.tail1234.ts.net" });
    const r = await resolveLaunch(dir, "nextjs");
    expect(r.fixedPort).toBeNull();
    expect(r.defaultPort).toBe(3000);
    expect(r.urlOverride).toBe("https://box.tail1234.ts.net");
  });

  test("an explicit port still wins over the url's port", async () => {
    const dir = await project({ "package.json": pkg({ scripts: { dev: "next dev" } }), "bun.lock": "" });
    await writeLaunchConfig(dir, { port: 3000, url: "https://box.ts.net:8443" });
    const r = await resolveLaunch(dir, "nextjs");
    expect(r.fixedPort).toBe(3000);
  });
});

describe("writeLaunchConfig removal", () => {
  test("saving an empty form removes the file rather than leaving {}", async () => {
    const dir = await project({});
    await writeLaunchConfig(dir, { port: 3000 });
    expect(await pathExists(join(dir, ".clidable/launch.json"))).toBe(true);

    await writeLaunchConfig(dir, {});
    expect(await pathExists(join(dir, ".clidable/launch.json"))).toBe(false);
    expect(await readLaunchConfig(dir)).toEqual({});
  });
});
