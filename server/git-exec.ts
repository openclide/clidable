/**
 * Low-level git runner shared by the real-repo route (`routes/git.ts`,
 * which scopes with `-C <cwd>`) and the shadow-repo layer
 * (`checkpoints/shadow.ts`, which scopes with `--git-dir`/`--work-tree`).
 * Both used to hand-roll the same Bun.spawn + pipe + Promise.all dance;
 * this is the one copy.
 *
 * Argv-style — no shell, so paths and commit messages with spaces,
 * quotes, backticks, or `$` are safe without escaping.
 */
export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runGit(args: string[]): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}
