/**
 * Production build for the Clidable server (frontend bundled in).
 *
 *   bun scripts/build.ts                    → dist/ (bundle: index.js + assets)
 *   bun scripts/build.ts --compile          → dist/clidable-server (single binary)
 *   bun scripts/build.ts --compile --target=bun-linux-x64
 *                                           → cross-compiled binary (CI)
 *
 * Why this script exists instead of a plain `bun build` CLI line:
 *
 *   1. TAILWIND. `bun-plugin-tailwind` is declared under `[serve.static]` in
 *      bunfig.toml, which only the DEV server (Bun.serve HTML bundling) loads.
 *      The `bun build` CLI does not load bunfig plugins ("once it supports
 *      them" — Bun docs), so a CLI build inlines `@import "tailwindcss"` but
 *      never runs the Tailwind engine: no utilities are generated and raw
 *      `@theme` / `@utility` / `@tailwind` blocks ship to the browser — an
 *      unstyled app. Plugins can only be attached via this JS API.
 *
 *   2. SOURCE MUTATION. `bun build --outdir=dist server/index.ts` (server
 *      importing ../web/index.html) rewrites the SOURCE web/index.html in
 *      place with hashed asset paths. Building through Bun.build with an
 *      explicit outdir keeps outputs in dist/ only — and `verifyBuild()`
 *      below fails the build if either regression ever comes back.
 *
 *   3. DEV FLAG. server/cli.ts derives `dev` from NODE_ENV. Baking in the
 *      production define ensures a distributed binary never boots with
 *      `development: { hmr: true }`.
 *
 * Running the outputs:
 *   - dist/clidable-server: self-contained, run from anywhere (assets are
 *     embedded). This is the distribution artifact.
 *   - dist/index.js: the HTML manifest resolves its "./chunk-*" refs against
 *     the process CWD, so it must be run FROM dist/ — `bun run start` does.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

const compile = Bun.argv.includes("--compile");
const targetArg = Bun.argv
  .find((a) => a.startsWith("--target="))
  ?.slice("--target=".length);

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

// Snapshot every source HTML the server may import — the historical mutation
// bug rewrote these in place (index.html AND the untracked landing.html).
const srcHtml = new Map<string, string>();
for (const f of new Bun.Glob("web/*.html").scanSync(root)) {
  srcHtml.set(f, await Bun.file(join(root, f)).text());
}

console.log(
  compile
    ? `→ compiling dist/clidable-server${targetArg ? ` (${targetArg})` : ""}`
    : "→ bundling dist/",
);

// Deterministic builds: stale dist/ content from a previous mode must never
// leak into (or confuse) this one. dist/ is gitignored and ours to own.
await rm(dist, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "server/index.ts")],
  target: "bun",
  // Everything lands FLAT in outdir, one directory for entries + chunks +
  // assets. Two bugs live here:
  //   • default entry naming is "[dir]/[name].[ext]" with [dir] relative to
  //     the lowest common entry ancestor (server/), so the HTML sub-entry's
  //     output path became `../web/index.html` — escaping outdir and
  //     OVERWRITING THE SOURCE FILE in place (mutation bug #2 in the header);
  //   • chunks always land flat in outdir, and the server manifest resolves
  //     its "./chunk-*.js" refs relative to the ENTRY file's directory at
  //     runtime, so a nested entry ("server/index.js") can't find them.
  // "[name].[ext]" has no [dir] token: nothing escapes, nothing nests.
  root,
  naming: { entry: "[name].[ext]" },
  // Tailwind v4 — see header. Dev gets this from bunfig [serve.static].
  plugins: [tailwind],
  minify: true,
  sourcemap: "linked",
  // `process.env.NODE_ENV !== "production"` in server/cli.ts must fold to
  // `false` in the artifact (a user running the binary won't set NODE_ENV).
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  ...(compile
    ? {
        compile: {
          outfile: join(dist, "clidable-server"),
          ...(targetArg ? { target: targetArg as never } : {}),
        },
      }
    : { outdir: dist }),
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

/** Guard the two historical regressions (unprocessed Tailwind, source-tree
 *  mutation) so they fail the build loudly instead of shipping. */
async function verifyBuild(): Promise<string[]> {
  const problems: string[] = [];

  // The source HTML must be byte-identical after the build.
  for (const [rel, before] of srcHtml) {
    const after = await Bun.file(join(root, rel)).text();
    if (after !== before) {
      problems.push(
        `${rel} was mutated by the build — restore it (git checkout -- ${rel}) and fix the bundler invocation`,
      );
    }
  }

  // Tailwind must have actually run: compiled CSS has no raw v4 directives
  // and DOES contain generated utilities.
  if (compile && targetArg) {
    // Cross-compiled binary — can't execute it on this host; existence is all
    // we can assert (Tailwind processing is covered by the host-target build
    // in the same CI run). Bun appends .exe for windows targets.
    const bin = targetArg.startsWith("bun-windows")
      ? "clidable-server.exe"
      : "clidable-server";
    if (!(await Bun.file(join(dist, bin)).exists())) {
      problems.push(`cross-compiled binary not found at dist/${bin}`);
    }
  } else if (compile) {
    // Can't scan the binary's bytes — the embedded sourcemaps carry the
    // ORIGINAL globals.css (raw directives) and would false-positive. Boot it
    // with an isolated HOME and check the CSS it actually serves. This also
    // catches a binary that landed somewhere other than the outfile path.
    problems.push(...(await verifyCompiledBinary()));
  } else {
    const cssFiles = [...new Bun.Glob("**/*.css").scanSync(dist)];
    if (cssFiles.length === 0) problems.push("no CSS asset in dist/");
    for (const f of cssFiles) {
      problems.push(...checkCss(f, await Bun.file(join(dist, f)).text()));
    }
  }
  return problems;
}

function checkCss(label: string, css: string): string[] {
  if (/@tailwind |@utility |@theme[ {]/.test(css)) {
    return [`${label}: raw Tailwind directives survived (plugin didn't run)`];
  }
  if (!css.includes(".flex{display:flex")) {
    return [`${label}: no generated utilities found (Tailwind produced nothing)`];
  }
  return [];
}

/** Boot dist/clidable-server on an ephemeral port with a scratch HOME and
 *  assert it serves health + Tailwind-compiled CSS. */
async function verifyCompiledBinary(): Promise<string[]> {
  const bin = join(dist, "clidable-server");
  if (!(await Bun.file(bin).exists())) {
    return [`${bin}: binary not found where compile.outfile pointed`];
  }
  const port = 20000 + Math.floor(Math.random() * 20000);
  const scratch = await mkdtemp(join(tmpdir(), "clidable-verify-"));
  const child = Bun.spawn([bin, "--port", String(port)], {
    env: { ...process.env, HOME: scratch, NODE_ENV: "production" },
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    // Poll health up to ~5s.
    let up = false;
    for (let i = 0; i < 25 && !up; i++) {
      up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
      if (!up) await Bun.sleep(200);
    }
    if (!up) {
      const err = await new Response(child.stderr).text().catch(() => "");
      return [`compiled binary did not become healthy on :${port}${err ? ` — ${err.slice(0, 300)}` : ""}`];
    }
    const html = await fetch(`${base}/`).then((r) => r.text());
    const cssPath = html.match(/href="([^"]+\.css)"/)?.[1];
    if (!cssPath) return ["compiled binary serves an HTML shell with no stylesheet link"];
    const css = await fetch(new URL(cssPath, base)).then((r) => r.text());
    return checkCss(`served ${cssPath}`, css);
  } finally {
    child.kill();
    await child.exited.catch(() => {});
  }
}

const problems = await verifyBuild();
if (problems.length > 0) {
  console.error("✗ build verification failed:");
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}

for (const artifact of result.outputs) {
  const rel = artifact.path.startsWith(`${root}/`)
    ? artifact.path.slice(root.length + 1)
    : artifact.path;
  // artifact.size reports the inner entry bundle for a compiled binary (~650
  // KB for a ~68 MB executable) — stat the file on disk instead.
  const size = Bun.file(artifact.path).size;
  console.log(`  ${rel}  ${(size / 1024 / 1024).toFixed(1)} MB`);
}
console.log("✓ build verified (Tailwind compiled, source tree untouched)");
