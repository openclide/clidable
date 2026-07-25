/**
 * `--flag=value` parsing for the scripts in this directory.
 *
 * Four hand-rolled copies of this existed (build.ts, build-sidecar.ts,
 * build-npm-packages.ts, render-brew-packaging.ts). That cost was concrete: the
 * empty-string hole that made `--out=` resolve to the repo root — and get it
 * rm -rf'd — was fixed in one copy and not the others.
 */

/** The value of `--name=…`, or undefined when absent. An explicitly empty
 *  `--name=` yields undefined, NOT "" — the caller's `?? default` then behaves,
 *  and no path treats "" as a meaningful directory. */
export function flag(argv: string[], name: string): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  const value = hit.slice(name.length + 3);
  return value === "" ? undefined : value;
}

/** True when `--name` is present as a bare switch. */
export function has(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}
