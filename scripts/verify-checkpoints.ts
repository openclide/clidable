/**
 * M1 verification harness for the checkpoint subsystem.
 *
 *   bun scripts/verify-checkpoints.ts
 *
 * Walks through the full create → list flow against a throwaway
 * scratch project it provisions in the OS temp dir, then prints the
 * shadow git log and SQLite rows so the human reviewer can
 * sanity-check the result.
 *
 * What it asserts:
 *   1. Project UUID is created and stable across calls.
 *   2. Three sequential checkpoints land, each producing a SHA.
 *   3. A no-changes checkpoint is recorded as `noop=1, sha=NULL`.
 *   4. node_modules content (we drop a fake file inside) does NOT
 *      appear in the shadow's `ls-tree` output (ignore handling).
 *   5. listCheckpoints returns rows in newest-first order with the
 *      filter by terminalId working.
 *
 * Cleans up its scratch edits at the end so the user's working tree
 * stays clean. Doesn't touch the shadow repo or SQLite — those
 * persist for inspection.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db";
import { ensureDirs } from "../server/paths";
import {
  createCheckpoint,
  listCheckpoints,
} from "../server/checkpoints";
import { git } from "../server/checkpoints/shadow";
import {
  readProjectUuid,
} from "../server/checkpoints/project";
import {
  projectIdFilePath,
  shadowGitDir,
} from "../server/checkpoints/paths";

// Self-provisioned scratch project — nothing in the repo is touched.
// Kept between runs (resetProject relies on the UUID file to clean up
// the prior run's shadow repo + rows before minting fresh state).
const PROJECT_PATH = join(tmpdir(), "clidable-verify-checkpoints");

// Scratch path we'll mutate between checkpoints.
const SCRATCH_FILE = join(PROJECT_PATH, "_verify.tmp");
const FAKE_NM_DIR = join(PROJECT_PATH, "node_modules", "should-not-appear");
const FAKE_NM_FILE = join(FAKE_NM_DIR, "marker.txt");

async function main(): Promise<void> {
  // The server's normal boot does this; the verify script bypasses
  // index.ts so we run it explicitly.
  ensureDirs();
  openDb();

  console.log("→ project:", PROJECT_PATH);

  // ── Step 0a: provision the scratch project (idempotent).
  await mkdir(join(PROJECT_PATH, "src"), { recursive: true });
  await writeFile(
    join(PROJECT_PATH, "package.json"),
    JSON.stringify({ name: "clidable-verify-scratch", private: true }, null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    join(PROJECT_PATH, "src", "app.ts"),
    "export const answer = 42;\n",
    "utf8",
  );

  // ── Step 0: scrub any leftover state from a prior run so the
  //            assertions further down can rely on a clean slate.
  //            We delete the per-project UUID file, the matching
  //            shadow git repo, and the SQLite rows.
  await resetProject();

  // ── Step 1: project UUID is created on first call, stable on
  //            subsequent calls.
  console.log("\nstep 1 — project UUID");
  const before = await readProjectUuid(PROJECT_PATH);
  console.log("  pre-create:", before ?? "(none)");

  // ── Step 2: drop a "node_modules" sentinel file. Should never
  //            appear in checkpoints regardless of project gitignore.
  await mkdir(FAKE_NM_DIR, { recursive: true });
  await writeFile(FAKE_NM_FILE, "this should never be tracked\n", "utf8");

  // ── Step 3: first checkpoint (initial state).
  console.log("\nstep 2 — first checkpoint (initial state)");
  const c1 = await createCheckpoint({
    projectPath: PROJECT_PATH,
    agentId: "claude",
    terminalId: "T-verify-1",
    message: "open the project",
  });
  console.log(
    `  id=${c1.id.slice(0, 8)}…  sha=${c1.sha?.slice(0, 7) ?? "—"}  initial=${c1.isInitial}  noop=${c1.noop}`,
  );

  const uuid = c1.projectUuid;
  console.log("  project_uuid:", uuid);
  if (before && before !== uuid) {
    throw new Error(`UUID changed between reads (was ${before}, now ${uuid})`);
  }
  if (!c1.isInitial) {
    throw new Error("first checkpoint should have isInitial=true");
  }
  if (c1.sha === null) {
    throw new Error("first checkpoint should have a SHA (commits initial)");
  }

  // ── Step 4: scratch edit + second checkpoint.
  console.log("\nstep 3 — edit + second checkpoint");
  await writeFile(SCRATCH_FILE, "edit #1\n", "utf8");
  const c2 = await createCheckpoint({
    projectPath: PROJECT_PATH,
    agentId: "claude",
    terminalId: "T-verify-1",
    message: "wrote a scratch file",
  });
  console.log(
    `  id=${c2.id.slice(0, 8)}…  sha=${c2.sha?.slice(0, 7) ?? "—"}  noop=${c2.noop}`,
  );
  if (c2.noop) throw new Error("second checkpoint should NOT be noop");
  if (c2.sha === null) {
    throw new Error("second checkpoint should have a SHA");
  }
  if (c2.sha === c1.sha) {
    throw new Error("second checkpoint SHA must differ from first");
  }

  // ── Step 5: no edits → third checkpoint should be noop.
  console.log("\nstep 4 — no edits, third checkpoint should be noop");
  const c3 = await createCheckpoint({
    projectPath: PROJECT_PATH,
    agentId: "codex",
    terminalId: "T-verify-2",
    message: "nothing changed since the previous one",
  });
  console.log(
    `  id=${c3.id.slice(0, 8)}…  sha=${c3.sha?.slice(0, 7) ?? "—"}  noop=${c3.noop}`,
  );
  if (!c3.noop) throw new Error("third checkpoint should be noop");
  if (c3.sha !== null) throw new Error("noop checkpoint must have sha=null");

  // ── Step 6: shadow git log + ls-tree check (ignore handling).
  console.log("\nstep 5 — shadow git inspection");
  const shadow = shadowGitDir(uuid);
  const log = await git(shadow, PROJECT_PATH, [
    "log",
    "--oneline",
    "--abbrev=7",
  ]);
  console.log(log.stdout.trim().split("\n").map((l) => "  " + l).join("\n"));

  const lsTree = await git(shadow, PROJECT_PATH, [
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
  ]);
  const tracked = lsTree.stdout.split("\n").filter(Boolean);
  const nmTracked = tracked.find((p) => p.startsWith("node_modules/"));
  console.log(`  tracked files: ${tracked.length}`);
  if (nmTracked) {
    throw new Error(
      `node_modules/ leaked into shadow tree: ${nmTracked}`,
    );
  }
  console.log("  ✓ node_modules/ correctly ignored");

  // ── Step 7: listCheckpoints — newest-first + terminal filter.
  console.log("\nstep 6 — listCheckpoints");
  const all = await listCheckpoints(PROJECT_PATH);
  console.log(`  all (${all.length}):`);
  for (const c of all) {
    console.log(
      `    [${c.terminalId}] ${c.agentId.padEnd(7)} ` +
        `sha=${(c.sha ?? "—").slice(0, 7).padEnd(7)} ` +
        `noop=${c.noop ? "y" : "n"}  ${truncate(c.message, 40)}`,
    );
  }
  if (all.length < 3) {
    throw new Error(`expected ≥3 checkpoints, got ${all.length}`);
  }
  for (let i = 1; i < all.length; i++) {
    if (all[i - 1]!.createdAt < all[i]!.createdAt) {
      throw new Error("listCheckpoints not in newest-first order");
    }
  }

  const t1Only = await listCheckpoints(PROJECT_PATH, {
    terminalId: "T-verify-1",
  });
  console.log(`  filter T-verify-1 (${t1Only.length}):`);
  for (const c of t1Only) {
    console.log(`    sha=${(c.sha ?? "—").slice(0, 7)}  ${truncate(c.message, 40)}`);
  }
  if (t1Only.some((c) => c.terminalId !== "T-verify-1")) {
    throw new Error("terminalId filter returned wrong rows");
  }

  console.log("\n✓ M1 checkpoints foundation verified");
  console.log(`  project UUID:   ${uuid}`);
  console.log(`  shadow git:     ${shadow}`);
  console.log(`  project-id at:  ${projectIdFilePath(PROJECT_PATH)}`);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

async function cleanup(): Promise<void> {
  await rm(SCRATCH_FILE, { force: true });
  await rm(join(PROJECT_PATH, "node_modules"), {
    recursive: true,
    force: true,
  });
}

/**
 * Idempotency helper: blow away any state from a prior verify run so
 * the assertions can rely on "this is the first checkpoint." Real
 * users never need this; verify needs it because the assertions are
 * pinned to first-run semantics (is_initial = true, etc.).
 */
async function resetProject(): Promise<void> {
  const existingUuid = await readProjectUuid(PROJECT_PATH);
  if (existingUuid) {
    // Delete the matching shadow repo + screenshots.
    const shadow = shadowGitDir(existingUuid);
    await rm(shadow, { recursive: true, force: true });
    await rm(join(shadow, "..", "screenshots"), {
      recursive: true,
      force: true,
    });
    // Delete the SQLite rows for that project.
    openDb()
      .query("DELETE FROM checkpoints WHERE project_uuid = ?")
      .run(existingUuid);
  }
  // Remove the project's .clidable/ so ensureProjectUuid mints fresh.
  await rm(join(PROJECT_PATH, ".clidable"), {
    recursive: true,
    force: true,
  });
}

await main()
  .then(cleanup)
  .catch(async (err) => {
    console.error("\n✗ verify failed:");
    console.error(err);
    await cleanup();
    process.exit(1);
  });
