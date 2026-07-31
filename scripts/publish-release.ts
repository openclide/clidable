/**
 * Publish a released version to npm and open the Homebrew tap PR — from your
 * machine, after you've published the GitHub Release.
 *
 *   bun scripts/publish-release.ts              # newest published release
 *   bun scripts/publish-release.ts --version=0.1.1
 *   bun scripts/publish-release.ts --dry-run    # do everything except publish/push
 *
 * WHY LOCAL. These are the only two release steps that need credentials CI
 * doesn't have: an npm token and write access to openclide/homebrew-tap. Running
 * them here means neither secret has to exist in GitHub at all — nothing to
 * scope, rotate, or leak — and it puts the irreversible step (npm publish is
 * forever: unpublish is blocked after 72h and a version can never be reused)
 * after the human review the draft release exists for.
 *
 * WHAT STAYS IN CI. Everything that builds: the six server binaries, the
 * three-OS desktop matrix (Windows/Linux installers genuinely cannot be built on
 * a Mac), the checksums, and the draft.
 *
 * PROVENANCE. This DOWNLOADS the published release's own assets rather than
 * rebuilding. The bytes that reach npm are then provably the ones CI built and
 * you reviewed; only the tarball wrapping happens locally. Rebuilding here would
 * quietly break that, so don't.
 *
 * Idempotent: already-published packages are skipped and an existing tap PR is
 * reused, so a re-run after a hiccup finishes the job instead of dying.
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flag, has } from "./lib/args";
import { TARGETS } from "./build-npm-packages";
import { packageNames } from "./npm-package-names";
import { parseSums, renderCask, renderFormula } from "./render-brew-packaging";

const root = join(import.meta.dir, "..");
const dryRun = has(Bun.argv, "dry-run");
const TAP = "openclide/homebrew-tap";

function say(msg: string): void {
  console.log(msg);
}
function die(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

/** Run a command, streaming output. Returns the exit code. */
async function run(cmd: string[], opts: { cwd?: string } = {}): Promise<number> {
  const p = Bun.spawn(cmd, { cwd: opts.cwd ?? root, stdout: "inherit", stderr: "inherit" });
  return await p.exited;
}

/** Run a command and capture stdout. */
async function capture(cmd: string[], opts: { cwd?: string } = {}): Promise<string> {
  const p = Bun.spawn(cmd, { cwd: opts.cwd ?? root, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim();
}

async function main(): Promise<void> {
  // ---- preflight: the tools and logins this needs ------------------------
  if (!(await capture(["gh", "--version"]))) die("gh is required (brew install gh)");
  if (!(await capture(["npm", "--version"]))) die("npm is required");

  const whoami = await capture(["npm", "whoami"]);
  if (!whoami) {
    die("not logged in to npm — run `npm login` first (this is the credential CI deliberately doesn't have)");
  }
  say(`→ npm user: ${whoami}`);

  // ---- which version -----------------------------------------------------
  let version = flag(Bun.argv, "version");
  if (!version) {
    // Newest PUBLISHED release: a draft is exactly what shouldn't be published
    // from, and `--exclude-drafts` is what makes that explicit.
    const tag = await capture([
      "gh", "release", "list", "--exclude-drafts", "--exclude-pre-releases",
      "--limit", "1", "--json", "tagName", "--jq", ".[0].tagName",
    ]);
    if (!tag) die("no published release found — publish the draft first, or pass --version=");
    version = tag.replace(/^v/, "");
  }
  say(`→ version: ${version}${dryRun ? "  (dry run)" : ""}`);

  if (version.includes("-")) {
    die(
      `"${version}" is a pre-release.\n` +
        `  npm would need a --tag next publish, and the tap must never point its bare\n` +
        `  \`clidable\` name at a pre-release. Publish those by hand, deliberately.`,
    );
  }

  // Guard against publishing a version whose release isn't actually public.
  const state = await capture([
    "gh", "release", "view", `v${version}`, "--json", "isDraft", "--jq", ".isDraft",
  ]);
  if (state === "") die(`release v${version} not found`);
  if (state === "true") {
    die(
      `release v${version} is still a DRAFT.\n` +
        `  Publish it on GitHub first — that review is the gate this script sits behind.`,
    );
  }

  // ---- download the published assets ------------------------------------
  const work = join(tmpdir(), `clidable-publish-${version}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  say(`\n→ downloading v${version} assets to ${work}`);
  if (
    (await run([
      "gh", "release", "download", `v${version}`, "--dir", work,
      "--pattern", "SHA256SUMS",
      ...TARGETS.flatMap((t) => ["--pattern", t.artifact]),
    ])) !== 0
  ) {
    die("could not download the release assets");
  }

  // ---- verify the checksums ---------------------------------------------
  // The point of downloading rather than rebuilding is that these bytes are
  // CI's; verifying them here proves the download wasn't truncated or swapped.
  const sums = parseSums(await Bun.file(join(work, "SHA256SUMS")).text());
  for (const t of TARGETS) {
    const file = Bun.file(join(work, t.artifact));
    if (!(await file.exists())) die(`missing asset ${t.artifact} in release v${version}`);
    const digest = new Bun.CryptoHasher("sha256")
      .update(new Uint8Array(await file.arrayBuffer()))
      .digest("hex");
    if (digest !== sums[t.artifact]) {
      die(
        `checksum mismatch for ${t.artifact}\n` +
          `  release SHA256SUMS: ${sums[t.artifact]}\n` +
          `  downloaded file:    ${digest}`,
      );
    }
  }
  say(`✓ all ${TARGETS.length} binaries match the release's SHA256SUMS`);

  // ---- stage the npm packages ------------------------------------------
  // Reuses the staging script (arch assertions, LICENSE/NOTICE, the resolver
  // shim) rather than duplicating it.
  const staged = join(work, "npm-dist");
  say(`\n→ staging npm packages`);
  if (
    (await run([
      "bun", "scripts/build-npm-packages.ts",
      `--from=${work}`, `--out=${staged}`, `--version=${version}`,
    ])) !== 0
  ) {
    die("staging failed");
  }

  // ---- publish ----------------------------------------------------------
  // Platform packages first: the wrapper pins them at this exact version, so
  // publishing it first leaves a window where `npm i -g @clidable/cli` resolves
  // a wrapper whose binaries don't exist yet.
  say(`\n→ publishing to npm`);
  for (const pkg of packageNames()) {
    // Every package is scoped, and the staging tree mirrors the names, so the
    // directory is just the name split on its slash.
    const dir = join(staged, ...pkg.split("/"));

    if (await capture(["npm", "view", `${pkg}@${version}`, "version"])) {
      say(`  = ${pkg}@${version} already published, skipping`);
      continue;
    }
    if (dryRun) {
      say(`  (dry run) would publish ${pkg}@${version}`);
      continue;
    }
    // `./`-relative or absolute — never a bare `a/b`, which npm reads as the
    // GitHub shorthand user/repo instead of a directory.
    if ((await run(["npm", "publish", dir, "--access", "public"])) !== 0) {
      die(`publishing ${pkg} failed — re-run this script to resume (published ones are skipped)`);
    }
    say(`  ✓ ${pkg}@${version}`);
  }

  // ---- the Homebrew tap -------------------------------------------------
  say(`\n→ Homebrew tap`);
  const formula = renderFormula(version, sums);
  let cask: string | null = null;
  try {
    cask = renderCask(version, sums);
  } catch {
    say(`  ! no dmg in this release — bumping the formula only`);
  }

  const tapDir = join(work, "tap");
  if ((await run(["git", "clone", "--depth", "1", `https://github.com/${TAP}.git`, tapDir], { cwd: work })) !== 0) {
    die(`could not clone ${TAP}`);
  }
  await mkdir(join(tapDir, "Formula"), { recursive: true });
  await mkdir(join(tapDir, "Casks"), { recursive: true });
  await Bun.write(join(tapDir, "Formula/clidable.rb"), formula);
  if (cask) await Bun.write(join(tapDir, "Casks/clidable-desktop.rb"), cask);

  // Stage BEFORE diffing: `git diff` ignores untracked files, so a first-ever
  // Casks/clidable-desktop.rb would read as "no change".
  await run(["git", "add", "Formula", "Casks"], { cwd: tapDir });
  if ((await run(["git", "diff", "--cached", "--quiet"], { cwd: tapDir })) === 0) {
    say(`  = tap already at ${version} — nothing to do`);
    say(`\n✓ done`);
    return;
  }

  if (dryRun) {
    say(`  (dry run) tap changes that would be proposed:`);
    await run(["git", "--no-pager", "diff", "--cached", "--stat"], { cwd: tapDir });
    say(`\n✓ dry run complete (nothing published, nothing pushed)`);
    return;
  }

  const branch = `clidable-${version}`;
  await run(["git", "config", "user.name", await capture(["git", "config", "user.name"])], { cwd: tapDir });
  await run(["git", "config", "user.email", await capture(["git", "config", "user.email"])], { cwd: tapDir });
  await run(["git", "checkout", "-b", branch], { cwd: tapDir });
  await run(["git", "commit", "-m", `clidable ${version}`], { cwd: tapDir });
  if ((await run(["git", "push", "-u", "--force", "origin", branch], { cwd: tapDir })) !== 0) {
    die(`could not push to ${TAP} — do you have write access?`);
  }

  const body = [
    `Automated bump for [v${version}](https://github.com/openclide/clidable/releases/tag/v${version}).`,
    "",
    "Rendered by `scripts/render-brew-packaging.ts` from the published release's own",
    "SHA256SUMS (verified byte-for-byte against the downloaded assets), so the pinned",
    "hashes are exactly what users download.",
    "",
    "Merging makes `brew install openclide/tap/clidable` and `brew upgrade` serve",
    `${version}.`,
  ].join("\n");
  const bodyFile = join(work, "pr-body.md");
  await Bun.write(bodyFile, body);

  let url = await capture([
    "gh", "pr", "create", "--repo", TAP, "--head", branch, "--base", "main",
    "--title", `clidable ${version}`, "--body-file", bodyFile,
  ]);
  if (!url) {
    // Already open from an earlier run; the force-push above updated it.
    url = await capture(["gh", "pr", "view", branch, "--repo", TAP, "--json", "url", "--jq", ".url"]);
  }
  say(`  ✓ tap PR: ${url || "(open it manually — the branch is pushed)"}`);

  say(`\n✓ done — npm serves ${version} as latest; merge the tap PR to finish brew.`);
}

if (import.meta.main) await main();
