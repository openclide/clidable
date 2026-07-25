import { describe, expect, test } from "bun:test";
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
