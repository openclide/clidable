import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WINDOWS_DRIVE_ROOTS, isDirectory, listDrives, pathExists } from "./fs";

/**
 * The bug this closes: on Windows every filesystem root is a separate drive and
 * nothing enumerates them, so the folder picker — which only walks up via
 * `dirname` and down into listed children — could never leave the drive it
 * started on. Reported as "doesn't let you open anything on any other drive
 * than C:\".
 */
describe("isDirectory vs pathExists", () => {
  /**
   * This pair is why the feature first shipped DEAD. `listDrives` probed with
   * `pathExists`, whose `Bun.file().exists()` is false for every directory, so
   * it returned [] on Windows while mocked tests stayed green. Pin the
   * distinction so nobody swaps them back.
   */
  test("pathExists answers 'is there a FILE here' — false for a directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "isdir-"));
    const file = join(dir, "f.txt");
    await writeFile(file, "x");

    expect(await pathExists(file)).toBe(true);
    expect(await pathExists(dir)).toBe(false); // ← the trap
    expect(await isDirectory(dir)).toBe(true);
    expect(await isDirectory(file)).toBe(false);
    expect(await isDirectory(join(dir, "nope"))).toBe(false);
  });
});

describe("listDrives", () => {
  /**
   * `roots` injects DATA, never the probe — so every case below runs the real
   * `isDirectory`. An earlier version injected the probe itself, which meant
   * swapping the production primitive back to the broken one left the suite
   * green. Keep the seam on the inputs.
   */
  test("keeps the roots that are real directories, drops the rest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drv-"));
    const file = join(dir, "f.txt");
    await writeFile(file, "x");
    const roots = [dir, tmpdir(), join(dir, "missing"), file];

    // A file and a missing path are both rejected; only directories survive.
    expect(await listDrives({ platform: "win32", roots })).toEqual([dir, tmpdir()]);
  });

  test("preserves the order the roots were given in", async () => {
    const a = await mkdtemp(join(tmpdir(), "drv-a-"));
    const b = await mkdtemp(join(tmpdir(), "drv-b-"));
    expect(await listDrives({ platform: "win32", roots: [b, a] })).toEqual([b, a]);
  });

  test("returns empty rather than throwing when nothing is mounted", async () => {
    expect(await listDrives({ platform: "win32", roots: ["/no/such/a", "/no/such/b"] })).toEqual([]);
  });

  test("is a no-op off Windows, whatever the roots", async () => {
    // 26 stat calls per picker open would be pure waste on a platform with a
    // single root, so the platform check must come BEFORE any probing.
    for (const platform of ["darwin", "linux"] as const) {
      expect(await listDrives({ platform, roots: [tmpdir()] })).toEqual([]);
    }
  });

  test("defaults to all 26 drive letters, each as `X:\\`", async () => {
    expect(WINDOWS_DRIVE_ROOTS).toHaveLength(26);
    expect(WINDOWS_DRIVE_ROOTS[0]).toBe("A:\\");
    expect(WINDOWS_DRIVE_ROOTS[25]).toBe("Z:\\");
    expect(WINDOWS_DRIVE_ROOTS.every((r) => /^[A-Z]:\\$/.test(r))).toBe(true);
  });

  test("on THIS host it matches the platform", async () => {
    // Real probe, real default roots. On CI's windows runner this asserts a
    // genuine drive list; everywhere else it asserts the no-op.
    const drives = await listDrives();
    if (process.platform === "win32") {
      expect(drives.length).toBeGreaterThan(0);
      expect(drives).toContain("C:\\");
      expect(drives.every((d) => /^[A-Z]:\\$/.test(d))).toBe(true);
    } else {
      expect(drives).toEqual([]);
    }
  });
});
