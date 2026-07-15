/**
 * Source-level regression test for the preview iframe's security attributes.
 * Rendering the component for real needs a DOM; for a focused security check
 * we assert the static JSX still carries the sandbox / referrerPolicy — if a
 * future edit silently loosens them, this fails. Ported from terax-ai.
 *
 * Run with `bun test`.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dir, "PreviewPane.tsx"), "utf8");
const iframeMatch = src.match(/<iframe[\s\S]*?\/>/);
// Strip JS comments so the assertions only see real attribute syntax (the file
// explains in prose why `allow-top-navigation` is omitted — don't match that).
const iframeJsx = (iframeMatch?.[0] ?? "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

describe("PreviewPane iframe sandbox", () => {
  it("declares an iframe in the source", () => {
    expect(iframeJsx).not.toBe("");
  });

  it("includes a sandbox attribute", () => {
    expect(iframeJsx).toMatch(/sandbox="[^"]*"/);
  });

  it("grants allow-scripts and allow-same-origin", () => {
    expect(iframeJsx).toMatch(/sandbox="[^"]*allow-scripts/);
    expect(iframeJsx).toMatch(/sandbox="[^"]*allow-same-origin/);
  });

  it("does NOT include allow-top-navigation* tokens", () => {
    // The whole point: forbid the iframe from navigating the parent Tauri
    // webview to an attacker origin (which would expose window.__TAURI__).
    expect(iframeJsx).not.toMatch(/allow-top-navigation/);
  });

  it("pairs allow-popups with allow-popups-to-escape-sandbox", () => {
    if (/allow-popups\b/.test(iframeJsx)) {
      expect(iframeJsx).toMatch(/allow-popups-to-escape-sandbox/);
    }
  });

  it("sets referrerPolicy to no-referrer", () => {
    expect(iframeJsx).toMatch(/referrerPolicy="no-referrer"/);
  });
});
