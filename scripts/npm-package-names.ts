/**
 * Print every npm package name this repo publishes, one per line.
 *
 *   bun scripts/npm-package-names.ts
 *
 * Exists so the promote workflow doesn't keep its own copy of the package list:
 * it reads TARGETS, the same table that stages and publishes them, so adding a
 * platform can't leave a package un-promoted (which would strand `latest` on a
 * wrapper whose binaries it can't resolve).
 */
import { TARGETS, WRAPPER } from "./build-npm-packages";

export function packageNames(): string[] {
  return [...TARGETS.map((t) => `@clidable/${t.platform}`), WRAPPER];
}

if (import.meta.main) console.log(packageNames().join("\n"));
