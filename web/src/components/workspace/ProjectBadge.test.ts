/**
 * The badge colour exists so same-initial projects stay tellable apart, which
 * makes hue SEPARATION the contract — not merely "different names hash
 * differently".
 *
 * The old `h * 31 + c` hash had no avalanche: a one-character change moved the
 * hash by one, and `% 360` turned that into a ONE DEGREE shift. `expo-1` (118°)
 * and `expo-2` (119°) both render an "E" in the same green, which is exactly
 * the case the colour is for.
 *
 * Note what is NOT asserted: a guaranteed minimum gap for any pair. Hashing
 * into 360 slots cannot promise that — two unrelated names may legitimately
 * land close, and only set-aware assignment (which a badge rendering ONE name
 * can't do) could fix it. So the pinned cases are the reported regressions, and
 * the general property is checked statistically, which is what "avalanche"
 * actually means.
 */
import { describe, expect, it } from "bun:test";
import { __projectHue as projectHue } from "./ProjectBadge";

/** Shortest distance around the 360° wheel. */
const apart = (a: string, b: string) => {
  const d = Math.abs(projectHue(a) - projectHue(b));
  return Math.min(d, 360 - d);
};

describe("projectHue", () => {
  it("keeps the reported collisions well apart", () => {
    // Both were 1° apart before the fix.
    expect(apart("expo-1", "expo-2")).toBeGreaterThan(60);
    expect(apart("next-1", "next-2")).toBeGreaterThan(60);
  });

  it("does not map single-character changes to adjacent hues", () => {
    // The old hash put EVERY such pair within 1-2°. Measure the distribution
    // rather than any single pair.
    const gaps: number[] = [];
    for (let i = 0; i < 300; i++) {
      gaps.push(apart(`project-${i}`, `project-${i + 1}`));
    }
    const nearlyIdentical = gaps.filter((g) => g < 5).length;
    const median = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;

    // Old hash: 300/300 under 5°, median 1. New: a spread across the wheel.
    expect(nearlyIdentical).toBeLessThan(gaps.length * 0.05);
    expect(median).toBeGreaterThan(45);
  });

  it("is stable for a given name", () => {
    expect(projectHue("expo-1")).toBe(projectHue("expo-1"));
  });

  it("stays in range", () => {
    for (const n of ["", "a", "expo-1", "a-very-long-project-name-here"]) {
      const h = projectHue(n);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});
