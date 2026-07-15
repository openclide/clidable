/**
 * Unit tests for the dev-server URL scanner. Run with `bun test`.
 * Covers the real banners Vite / Next / uvicorn / Astro print, including the
 * ANSI color codes they wrap the URL in.
 */
import { describe, expect, it } from "bun:test";
import { findDevServerUrls, stripAnsi } from "./url-finder";

const ESC = "\x1b";

describe("findDevServerUrls", () => {
  it("finds a plain Vite banner", () => {
    const out = findDevServerUrls("  ➜  Local:   http://localhost:5173/");
    expect(out).toEqual(["http://localhost:5173"]);
  });

  it("strips ANSI color codes around the URL", () => {
    const banner = `  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mLocal${ESC}[22m:   ${ESC}[36mhttp://localhost:5173/${ESC}[39m`;
    expect(findDevServerUrls(banner)).toEqual(["http://localhost:5173"]);
  });

  it("normalizes 127.0.0.1 and 0.0.0.0 to localhost", () => {
    expect(findDevServerUrls("Uvicorn running on http://127.0.0.1:8000")).toEqual([
      "http://localhost:8000",
    ]);
    expect(findDevServerUrls("ready - started server on 0.0.0.0:3000, url: http://localhost:3000")).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("dedupes repeated URLs", () => {
    const out = findDevServerUrls(
      "http://localhost:3000 ... http://localhost:3000 ... http://localhost:3000",
    );
    expect(out).toEqual(["http://localhost:3000"]);
  });

  it("ignores non-loopback origins", () => {
    expect(findDevServerUrls("deployed at https://example.com:443/app")).toEqual([]);
  });

  it("defaults the port by scheme when absent", () => {
    expect(findDevServerUrls("serving http://localhost/")).toEqual([
      "http://localhost:80",
    ]);
  });

  it("stripAnsi removes CSI sequences but keeps text", () => {
    expect(stripAnsi(`${ESC}[36mhello${ESC}[0m world`)).toBe("hello world");
  });
});
