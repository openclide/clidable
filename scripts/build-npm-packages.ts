/**
 * Stage the npm publish tree: one thin `clidable` wrapper plus one
 * `@clidable/<platform>` package per compiled binary.
 *
 *   bun scripts/build-npm-packages.ts                    # from ./artifacts
 *   bun scripts/build-npm-packages.ts --from=dist --version=0.1.1
 *
 * Why seven packages and not one: `clidable` is a compiled ~70 MB binary per
 * platform, so a single package would make everyone download six binaries they
 * can't run. The wrapper declares the platform packages as
 * `optionalDependencies` with `os`/`cpu` constraints, so npm installs exactly
 * the one that matches and skips the rest.
 *
 * Why not a postinstall that downloads the binary: Bun blocks postinstall
 * scripts by default (this repo's own `trustedDependencies` exists for that
 * reason), and `--ignore-scripts` is common in CI — a Bun-native tool whose npm
 * install silently produces no working command would be a bad first contact.
 * Resolution at *run* time needs no scripts at all.
 */
import { chmod, mkdir, copyFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = join(import.meta.dir, "..");

const arg = (name: string): string | undefined =>
  Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// `resolve`, not `join`: these are user-supplied and may be absolute, which
// `join` would silently graft onto the repo root instead of honouring.
const fromDir = resolve(root, arg("from") ?? "artifacts");
const outDir = resolve(root, arg("out") ?? "npm-dist");
const version = arg("version") ?? (await Bun.file(join(root, "package.json")).json()).version;

/**
 * Release artifact → npm platform package. The keys on the right are
 * `${process.platform}-${process.arch}` as Node reports them, which is what the
 * wrapper's resolver computes at run time — note `win32`, not the `windows` used
 * in the artifact filenames.
 */
export const TARGETS: Array<{ artifact: string; platform: string; os: string; cpu: string }> = [
  { artifact: "clidable-server-darwin-arm64", platform: "darwin-arm64", os: "darwin", cpu: "arm64" },
  { artifact: "clidable-server-darwin-x64", platform: "darwin-x64", os: "darwin", cpu: "x64" },
  { artifact: "clidable-server-linux-x64", platform: "linux-x64", os: "linux", cpu: "x64" },
  { artifact: "clidable-server-linux-arm64", platform: "linux-arm64", os: "linux", cpu: "arm64" },
  { artifact: "clidable-server-windows-x64.exe", platform: "win32-x64", os: "win32", cpu: "x64" },
  { artifact: "clidable-server-windows-arm64.exe", platform: "win32-arm64", os: "win32", cpu: "arm64" },
];

const REPO = {
  type: "git",
  url: "git+https://github.com/openclide/clidable.git",
} as const;

/** Shared manifest fields, so the seven packages can't drift on metadata. */
const common = {
  version,
  license: "Apache-2.0",
  homepage: "https://github.com/openclide/clidable",
  repository: REPO,
  author: "openclide",
};

export function platformManifest(t: (typeof TARGETS)[number]): Record<string, unknown> {
  return {
    name: `@clidable/${t.platform}`,
    ...common,
    description: `Clidable binary for ${t.os} ${t.cpu}. Installed automatically by the \`clidable\` package.`,
    // npm skips a package whose os/cpu don't match, which is what makes the
    // wrapper's optionalDependencies resolve to exactly one binary.
    os: [t.os],
    cpu: [t.cpu],
    // No "exports": the wrapper resolves `<pkg>/bin/<exe>` as a subpath, and an
    // exports map would make that a hard error.
    files: ["bin"],
  };
}

export function wrapperManifest(): Record<string, unknown> {
  return {
    name: "clidable",
    ...common,
    description: "GUI for CLI coding agents — real terminals for Claude Code, Codex, Antigravity and friends.",
    keywords: ["claude-code", "codex", "ai", "agents", "cli", "terminal", "tui"],
    bin: { clidable: "bin/clidable.js" },
    files: ["bin"],
    // Node only runs the ~40-line resolver shim; the binary it execs is
    // self-contained (compiled with Bun) and needs no runtime.
    engines: { node: ">=18" },
    optionalDependencies: Object.fromEntries(
      TARGETS.map((t) => [`@clidable/${t.platform}`, version]),
    ),
  };
}

/** The wrapper's `bin`. Plain CJS (no "type" field) so it runs on any Node ≥18. */
const SHIM = `#!/usr/bin/env node
// Resolve the platform-specific Clidable binary installed as an optional
// dependency, then hand our argv to it. Kept dependency-free and tiny: it runs
// on every invocation of \`clidable\`.
"use strict";
const { spawnSync } = require("node:child_process");
const { chmodSync } = require("node:fs");

const key = process.platform + "-" + process.arch;
const pkg = "@clidable/" + key;
const exe = process.platform === "win32" ? "clidable.exe" : "clidable";

let bin;
try {
  bin = require.resolve(pkg + "/bin/" + exe);
} catch {
  console.error(
    "clidable: no binary for " + key + ".\\n" +
      "  Expected the optional dependency " + pkg + " to be installed.\\n" +
      "  If you installed with --no-optional or --ignore-optional, reinstall without it.\\n" +
      "  Supported: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64, win32-arm64.\\n" +
      "  Other platforms: build from source — https://github.com/openclide/clidable",
  );
  process.exit(1);
}

function run() {
  return spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
}

let res = run();
// npm normally preserves the executable bit, but a tarball unpacked by a client
// that doesn't would leave a binary we can't exec. Fix it once and retry rather
// than failing with a bare EACCES.
if (res.error && res.error.code === "EACCES" && process.platform !== "win32") {
  try {
    chmodSync(bin, 0o755);
    res = run();
  } catch {
    /* fall through to the error below */
  }
}

if (res.error) {
  console.error("clidable: could not run " + bin + " — " + res.error.message);
  process.exit(1);
}
// Re-raise a fatal signal (Ctrl-C, SIGTERM) so shells and supervisors see the
// real cause instead of a plain exit code.
if (res.signal) {
  process.kill(process.pid, res.signal);
}
process.exit(res.status === null ? 1 : res.status);
`;

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });

  // --- wrapper -------------------------------------------------------------
  const wrapperDir = join(outDir, "clidable");
  await mkdir(join(wrapperDir, "bin"), { recursive: true });
  await Bun.write(
    join(wrapperDir, "package.json"),
    JSON.stringify(wrapperManifest(), null, 2) + "\n",
  );
  await Bun.write(join(wrapperDir, "bin", "clidable.js"), SHIM);
  await chmod(join(wrapperDir, "bin", "clidable.js"), 0o755);
  await Bun.write(join(wrapperDir, "README.md"), await readmeFor("clidable"));
  console.log(`✓ clidable@${version}`);

  // --- one package per platform -------------------------------------------
  const missing: string[] = [];
  for (const t of TARGETS) {
    const src = join(fromDir, t.artifact);
    if (!(await Bun.file(src).exists())) {
      missing.push(t.artifact);
      continue;
    }
    const dir = join(outDir, "@clidable", t.platform);
    await mkdir(join(dir, "bin"), { recursive: true });
    const exe = t.os === "win32" ? "clidable.exe" : "clidable";
    await copyFile(src, join(dir, "bin", exe));
    if (t.os !== "win32") await chmod(join(dir, "bin", exe), 0o755);
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify(platformManifest(t), null, 2) + "\n",
    );
    await Bun.write(join(dir, "README.md"), await readmeFor(`@clidable/${t.platform}`));
    console.log(`✓ @clidable/${t.platform}@${version}  (${Bun.file(src).size} bytes)`);
  }

  if (missing.length) {
    // Publishing a wrapper whose optionalDependencies don't all exist would
    // leave those platforms with an install that resolves and then can't run.
    console.error(
      `\n✗ missing ${missing.length} binar${missing.length === 1 ? "y" : "ies"} in ${fromDir}:\n` +
        missing.map((m) => `    ${m}`).join("\n") +
        `\n  All six must be present — the wrapper declares an optionalDependency for each.`,
    );
    process.exit(1);
  }

  console.log(`\n→ staged in ${outDir}`);
}

async function readmeFor(name: string): Promise<string> {
  const isWrapper = name === "clidable";
  return (
    `# ${name}\n\n` +
    (isWrapper
      ? "GUI for CLI coding agents — real terminals for Claude Code, Codex, Antigravity\n" +
        "and friends, with rewindable checkpoints, live preview, and one-click\n" +
        "MCP / skills / plugins.\n\n" +
        "```sh\nnpm install -g clidable\nclidable\n```\n\n" +
        "Then open http://127.0.0.1:7878.\n\n" +
        "Docs: https://openclide.github.io/clidable/\n"
      : `Platform binary for [clidable](https://www.npmjs.com/package/clidable).\n\n` +
        "You don't install this directly — `clidable` pulls in the one matching\n" +
        "your platform automatically.\n")
  );
}

if (import.meta.main) await main();
