/**
 * Integration test for process-mode port detection. Serves on a random free
 * port in *this* process, then asserts the scanner finds that port owned by
 * the current pid's process tree. Exercises the live per-OS socket
 * enumeration (lsof on macOS, /proc on Linux, Get-NetTCPConnection on Win).
 *
 * Run with `bun test`.
 */
import { describe, expect, it } from "bun:test";
import { descendantsOf, listeningPorts, processTree } from "./port-scan";

describe("descendantsOf", () => {
  it("walks the tree depth-first including the root", () => {
    const tree = new Map<number, number[]>([
      [1, [2, 3]],
      [2, [4]],
      [3, []],
      [4, [5]],
    ]);
    expect([...descendantsOf([1], tree)].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect([...descendantsOf([2], tree)].sort((a, b) => a - b)).toEqual([2, 4, 5]);
  });
});

describe("listeningPorts (live)", () => {
  it("detects a socket this process is listening on", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    try {
      const tree = await processTree();
      const desc = descendantsOf([process.pid], tree);
      const ports = await listeningPorts(desc);
      expect(ports.some((p) => p.port === server.port)).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
