/**
 * Compile the Bun server into a Tauri sidecar binary.
 *
 *   bun scripts/build-sidecar.ts                       → host triple
 *   bun scripts/build-sidecar.ts --target=bun-linux-x64 --triple=x86_64-unknown-linux-gnu
 *   bun scripts/build-sidecar.ts --stub                → placeholders only
 *
 * Tauri's `externalBin` resolves a sidecar as `binaries/<name>-<target-triple>`
 * (e.g. clidable-server-aarch64-apple-darwin), so we build the standalone server
 * (through scripts/build.ts, which carries the Tailwind plugin + guards) and copy
 * it to the triple-suffixed path the bundler expects. Run before `tauri build`.
 *
 * `--stub` writes the two paths tauri-build validates — the triple-suffixed
 * sidecar and the `frontendDist` directory — WITHOUT compiling anything. That is
 * for `cargo check`, which resolves `externalBin` in the build script and so
 * fails before compiling a line if the path is missing ("resource path
 * `binaries/clidable-server-…` doesn't exist"), but never reads the bytes. Type
 * checking the Rust shouldn't cost a 65 MB server compile.
 */
import { mkdir, copyFile, rename } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const binaries = join(root, "src-tauri", "binaries");

const bunTarget = Bun.argv.find((a) => a.startsWith("--target="));
const tripleArg = Bun.argv
  .find((a) => a.startsWith("--triple="))
  ?.slice("--triple=".length);

/** The Rust host target triple — used to name the sidecar the way Tauri expects. */
async function hostTriple(): Promise<string> {
  const p = Bun.spawn(["rustc", "-vV"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  const m = out.match(/^host:\s*(.+)$/m);
  if (!m) throw new Error("could not determine host target triple (is rustc installed?)");
  return m[1]!.trim();
}

const stub = Bun.argv.includes("--stub");
const triple = tripleArg ?? (await hostTriple());
const isWindows = triple.includes("windows");
const dest = join(binaries, `clidable-server-${triple}${isWindows ? ".exe" : ""}`);

await mkdir(binaries, { recursive: true });

if (stub) {
  // Never clobber a real sidecar: `--stub` is for a clean CI checkout, but it's
  // one flag away from `--target`, and on a dev machine the file it would
  // truncate is a 65 MB+ build you'd have to sit through again.
  const existing = Bun.file(dest);
  if ((await existing.exists()) && existing.size > 0) {
    console.log(`✓ sidecar already present, left alone → ${dest} (${existing.size} bytes)`);
  } else {
    // Existence is the whole contract for `cargo check` — never run a stubbed
    // sidecar, and never bundle one (a `tauri build` would ship a dud app).
    await Bun.write(dest, "");
    console.log(`✓ sidecar placeholder → ${dest}  (--stub: NOT a runnable binary)`);
  }
} else {
  console.log(`→ building server sidecar for ${triple}`);

  // Reuse the canonical production compile (Tailwind plugin, source-mutation
  // guards, prod define). Output lands at dist/clidable-server[.exe].
  const buildArgs = ["scripts/build.ts", "--compile"];
  if (bunTarget) buildArgs.push(bunTarget);
  const build = Bun.spawn(["bun", ...buildArgs], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await build.exited) !== 0) {
    console.error("sidecar server build failed");
    process.exit(1);
  }

  const compiled = join(root, "dist", isWindows ? "clidable-server.exe" : "clidable-server");
  try {
    await rename(compiled, dest);
  } catch {
    // cross-device or already-consumed → copy
    await copyFile(compiled, dest);
  }
  console.log(`✓ sidecar → ${dest}`);
}

// Tauri requires `frontendDist` to be a real directory at bundle time, but the
// app loads its UI from the running server (the window's `url` override + the
// Rust setup navigate), so the bundled frontend is never actually shown. Emit a
// minimal stub so the build validates — and so a fallback still points at the
// server if the override ever fails to take.
const webDir = join(root, "dist", "web");
await mkdir(webDir, { recursive: true });
// Honor CLIDABLE_PORT so a custom-port build's fallback redirects to the right
// place (the real UI comes from the running server; this is only a safety net).
const port = process.env.CLIDABLE_PORT || "7878";
await Bun.write(
  join(webDir, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><title>Clidable</title>' +
    `<meta http-equiv="refresh" content="0; url=http://127.0.0.1:${port}/"></head>` +
    "<body>Loading Clidable…</body></html>\n",
);
console.log(`✓ frontendDist stub → ${join(webDir, "index.html")}`);
