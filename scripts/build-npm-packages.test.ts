import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { platformManifest, wrapperManifest, TARGETS } from "./build-npm-packages";

/**
 * The npm channel is six binaries behind one name, and the join between them is
 * a string built at run time: the shim resolves
 * `@clidable/${process.platform}-${process.arch}`. Nothing type-checks that
 * against the packages we actually publish, so it's pinned here.
 */
describe("npm platform packages", () => {
  test("package names are exactly what the shim computes at run time", () => {
    // `${process.platform}-${process.arch}` — Node's spelling, which is `win32`,
    // not the `windows` used in the release artifact filenames.
    const names = TARGETS.map((t) => `@clidable/${t.platform}`).sort();
    expect(names).toEqual([
      "@clidable/darwin-arm64",
      "@clidable/darwin-x64",
      "@clidable/linux-arm64",
      "@clidable/linux-x64",
      "@clidable/win32-arm64",
      "@clidable/win32-x64",
    ]);
  });

  test("each platform key is its own os/cpu pair, so npm installs exactly one", () => {
    for (const t of TARGETS) {
      expect(t.platform).toBe(`${t.os}-${t.cpu}`);
      const m = platformManifest(t);
      expect(m.os).toEqual([t.os]);
      expect(m.cpu).toEqual([t.cpu]);
    }
  });

  test("this host resolves to a package we publish", () => {
    // If this fails on a supported dev machine, `npm i -g clidable` is broken
    // there in exactly the way the shim's error message describes.
    const key = `${process.platform}-${process.arch}`;
    expect(TARGETS.map((t) => t.platform)).toContain(key);
  });

  test("platform packages carry no exports map", () => {
    // The shim resolves the subpath `<pkg>/bin/clidable`; an exports map would
    // turn that into ERR_PACKAGE_PATH_NOT_EXPORTED.
    for (const t of TARGETS) expect(platformManifest(t).exports).toBeUndefined();
  });

  test("windows artifacts keep the .exe suffix, others don't", () => {
    for (const t of TARGETS) {
      expect(t.artifact.endsWith(".exe")).toBe(t.os === "win32");
    }
  });
});

describe("npm wrapper", () => {
  test("declares an optionalDependency per platform, at its own version", () => {
    const w = wrapperManifest();
    const deps = w.optionalDependencies as Record<string, string>;
    expect(Object.keys(deps).sort()).toEqual(
      TARGETS.map((t) => `@clidable/${t.platform}`).sort(),
    );
    // Pinned exactly: a range would let `npm i -g clidable` pair the wrapper
    // with a mismatched binary.
    for (const v of Object.values(deps)) expect(v).toBe(w.version);
  });

  test("exposes the one command users type", () => {
    // The naming contract: `clidable` is the command everywhere.
    expect(wrapperManifest().bin).toEqual({ clidable: "bin/clidable.js" });
  });

  test("is not marked private (the repo's own package.json is)", () => {
    expect(wrapperManifest().private).toBeUndefined();
  });
});

/**
 * F12: the artifact-name ↔ platform mapping lives in four places — TARGETS here,
 * the release workflow's cross-compile table, install.sh's uname mapping, and
 * the brew renderer. Nothing type-checks them against each other, and the
 * project has already paid for that once (windows-arm64 was "missing here by
 * oversight"). These read the other three and assert they agree.
 */
describe("the target table is the single source of truth", () => {
  // `import.meta.dir` + join, NOT `new URL(…).pathname`: on Windows the latter
  // yields "/C:/…", which no filesystem call resolves. (Caught by the windows CI
  // job, which exists for exactly this.)
  const repoFile = (rel: string): string => join(import.meta.dir, "..", rel);

  test("release.yml cross-compiles exactly the artifacts TARGETS expects", async () => {
    const yml = await Bun.file(repoFile(".github/workflows/release.yml")).text();
    // The host binary is built separately (mv … clidable-server-linux-x64); the
    // rest come from the `[bun-target]=artifact` table.
    const inWorkflow = new Set(
      [...yml.matchAll(/\[bun-[\w-]+\]=(clidable-server-[\w.-]+)/g)].map((m) => m[1]!),
    );
    for (const m of yml.matchAll(/mv dist\/clidable-server artifacts\/(clidable-server-[\w.-]+)/g)) {
      inWorkflow.add(m[1]!);
    }
    expect([...inWorkflow].sort()).toEqual(TARGETS.map((t) => t.artifact).sort());
  });

  test("install.sh can name every unix artifact TARGETS lists", async () => {
    const sh = await Bun.file(repoFile("install.sh")).text();
    // install.sh builds `clidable-server-${os_slug}-${arch_slug}`; assert the
    // slug pairs it can produce cover the unix targets (it sends Windows users
    // to the Releases page instead of downloading).
    const osSlugs = [...sh.matchAll(/os_slug="(\w+)"/g)].map((m) => m[1]!);
    const archSlugs = [...sh.matchAll(/arch_slug="(\w+)"/g)].map((m) => m[1]!);
    const buildable = new Set(
      osSlugs.flatMap((o) => archSlugs.map((a) => `clidable-server-${o}-${a}`)),
    );
    for (const t of TARGETS) {
      if (t.os === "win32") continue;
      expect(buildable).toContain(t.artifact);
    }
  });
});
