/**
 * A scaffolder exiting 0 doesn't mean it produced a project. create-hono
 * creates the target directory, throws on its "install dependencies?" prompt
 * (stdin is closed here by design), and exits 0 anyway — which used to register
 * a completely empty folder as a new project.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertProducedFiles } from "./scaffold";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clidable-scaffold-"));
  roots.push(dir);
  return dir;
}

const CMD = ["bunx", "create-hono@latest", "app"];

describe("assertProducedFiles", () => {
  test("passes when the scaffolder wrote something", async () => {
    const target = join(await root(), "app");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "package.json"), "{}");
    expect(assertProducedFiles(target, "app", CMD, "")).resolves.toBeUndefined();
  });

  test("rejects an empty folder and clears it so the name can be reused", async () => {
    const parent = await root();
    const target = join(parent, "app");
    await mkdir(target, { recursive: true });

    expect(assertProducedFiles(target, "app", CMD, "")).rejects.toThrow(
      /created no files in "app"/,
    );
    // Left behind, the empty folder would fail the "already exists" check on
    // the user's next attempt with the same name.
    await Bun.sleep(0);
    expect(await readdir(parent)).toEqual([]);
  });

  test("surfaces the scaffolder's stderr, which is the only clue it failed", async () => {
    const target = join(await root(), "app");
    await mkdir(target, { recursive: true });
    expect(
      assertProducedFiles(target, "app", CMD, "Error: User force closed the prompt"),
    ).rejects.toThrow(/User force closed the prompt/);
  });

  test("rejects when the scaffolder made no folder at all", async () => {
    const target = join(await root(), "never-created");
    expect(assertProducedFiles(target, "never-created", CMD, "")).rejects.toThrow(
      /created no files/,
    );
  });
});
