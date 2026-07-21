import { describe, expect, it } from "bun:test";
import { isAbsolute } from "node:path";
import { AGENTS, resolveBin } from "./agents";

const IS_WINDOWS = process.platform === "win32";

/**
 * PATH lookup is the gate every spawn goes through — agents AND the plain
 * terminal. It once hardcoded `which`, which does not exist on Windows; because
 * we exec it directly (no shell), that surfaced as a hard ENOENT rather than a
 * "not installed" answer, and took down every terminal on the platform. These
 * tests pin the contract on whichever host they run on.
 */
describe("resolveBin", () => {
  it("resolves a binary that is definitely on PATH", async () => {
    // Something guaranteed present on each platform, looked up by bare name so
    // the PATH branch (not the absolute-path shortcut) is the one exercised.
    const known = IS_WINDOWS ? "powershell.exe" : "sh";
    const resolved = await resolveBin(known);
    expect(resolved).not.toBeNull();
    expect(isAbsolute(resolved!)).toBe(true);
  });

  it("returns null for a binary that does not exist", async () => {
    // Must be a plain null, not a throw: a missing agent is a normal state the
    // UI renders as "not installed".
    expect(await resolveBin("clidable-definitely-not-a-real-binary-xyz")).toBeNull();
  });

  it("resolves the plain terminal's shell on this platform", async () => {
    // The terminal agent is the one that must ALWAYS work — it's the fallback
    // when no AI agent is installed. On POSIX `bin` is already absolute; on
    // Windows it's a bare `powershell.exe` that has to survive the PATH lookup.
    const resolved = await resolveBin(AGENTS.terminal.bin);
    expect(resolved).not.toBeNull();
    expect(isAbsolute(resolved!)).toBe(true);
  });
});
