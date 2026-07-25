import { describe, expect, test } from "bun:test";
import { parseSums, renderCask, renderFormula } from "./render-brew-packaging";

const SUMS = parseSums(`
55217e69b238c682f176f2893a36d000560738c542087461894575c08912369f  clidable-server-darwin-arm64
2452ee86844f6d90476e86353e17705ac3ee34b116d7e8f7d1ea0430b4607023  clidable-server-darwin-x64
1f61863a4b84495981ac6d75736e71d30a7618ee041987a589398fd522820f8f  clidable-server-linux-arm64
907aa9fc1ac3aa76e4332eb3d9652ee70e1b2bf0169608c5c0cf7efa5098b4ac  clidable-server-linux-x64
aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888  Clidable_0.1.1_aarch64.dmg
cccc9999dddd0000eeee1111ffff2222aaaa3333bbbb4444cccc5555dddd6666  Clidable_0.1.1_x64.dmg
`);

describe("parseSums", () => {
  test("reads the sha256sum format, including the binary-mode asterisk", () => {
    const s = parseSums(
      "a".repeat(64) + "  plain\n" + "b".repeat(64) + " *binary-mode\n",
    );
    expect(s["plain"]).toBe("a".repeat(64));
    expect(s["binary-mode"]).toBe("b".repeat(64));
  });

  test("ignores blank lines and anything that isn't a digest line", () => {
    expect(Object.keys(parseSums("\n# a comment\nnot a digest  x\n"))).toEqual([]);
  });

  test("normalises uppercase digests", () => {
    expect(parseSums("A".repeat(64) + "  x")["x"]).toBe("a".repeat(64));
  });
});

describe("renderFormula", () => {
  const rb = renderFormula("0.1.1", SUMS);

  test("pins the version and every unix asset's hash", () => {
    expect(rb).toContain('version "0.1.1"');
    expect(rb).toContain("55217e69b238c682f176f2893a36d000560738c542087461894575c08912369f");
    expect(rb).toContain("907aa9fc1ac3aa76e4332eb3d9652ee70e1b2bf0169608c5c0cf7efa5098b4ac");
    // Four assets → four sha256 lines, no more and no fewer.
    expect(rb.match(/sha256 "/g)).toHaveLength(4);
  });

  test("keeps the naming contract: installs the artifact AS `clidable`", () => {
    expect(rb).toContain('bin.install Dir["clidable-server-*"].first => "clidable"');
    expect(rb).toContain("class Clidable < Formula");
  });

  test("URLs point at the tag matching the version", () => {
    for (const m of rb.matchAll(/releases\/download\/v([\d.]+)\//g)) {
      expect(m[1]).toBe("0.1.1");
    }
  });
});

describe("renderCask", () => {
  const rb = renderCask("0.1.1", SUMS);

  test("carries both arch hashes, keyed the way brew expects", () => {
    expect(rb).toContain('arch arm: "aarch64", intel: "x64"');
    expect(rb).toContain('arm:   "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888"');
    expect(rb).toContain('intel: "cccc9999dddd0000eeee1111ffff2222aaaa3333bbbb4444cccc5555dddd6666"');
  });

  test("is the desktop token, distinct from the formula's bare name", () => {
    expect(rb).toContain('cask "clidable-desktop" do');
    expect(rb).toContain('app "Clidable.app"');
  });

  test("interpolates the dmg name at install time, not at render time", () => {
    // brew substitutes #{version}/#{arch} per machine; baking one arch in would
    // give Intel users the arm64 dmg.
    expect(rb).toContain("Clidable_#{version}_#{arch}.dmg");
  });
});

describe("missing assets", () => {
  test("throws instead of rendering an empty sha256", () => {
    // A blank hash would install fine for us and fail checksum verification for
    // every user, so this has to be loud at render time.
    expect(() => renderFormula("0.1.1", {})).toThrow(/no entry for "clidable-server-darwin-arm64"/);
    expect(() => renderCask("0.1.1", {})).toThrow(/no entry for "Clidable_0.1.1_aarch64.dmg"/);
  });

  test("a version mismatch surfaces as a missing dmg, not a silent wrong hash", () => {
    // SUMS holds 0.1.1 dmgs; asking for 0.1.2 must fail rather than reuse them.
    expect(() => renderCask("0.1.2", SUMS)).toThrow(/Clidable_0\.1\.2_aarch64\.dmg/);
  });
});
