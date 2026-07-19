import { afterAll, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scrollback, readScrollback, scrollbackPath } from "./scrollback-store";

const ROOT = join(tmpdir(), `clidable-scroll-test-${process.pid}`);
let n = 0;
const nextPath = () => join(ROOT, `s${n++}.scroll`);
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (u: Uint8Array) => new TextDecoder().decode(u);

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe("scrollbackPath", () => {
  it("nests under the project data dir's terminals/ folder", () => {
    const p = scrollbackPath("proj-uuid", "term-1");
    expect(p.endsWith(join("proj-uuid", "terminals", "term-1.scroll"))).toBe(true);
  });
});

describe("Scrollback — flush & read round-trip", () => {
  it("writes appended bytes to disk (creating parent dirs) and reads them back", async () => {
    const path = nextPath();
    const s = new Scrollback(path);
    s.append(bytes("hello "));
    s.append(bytes("world"));
    await s.flush();
    expect(text(await readScrollback(path))).toBe("hello world");
  });

  it("readScrollback returns empty for a missing file", async () => {
    expect((await readScrollback(join(ROOT, "does-not-exist.scroll"))).byteLength).toBe(0);
  });

  it("flush is a no-op when nothing changed since last flush", async () => {
    const path = nextPath();
    const s = new Scrollback(path);
    s.append(bytes("data"));
    await s.flush();
    await s.flush(); // second flush: dirty=false, must not throw / must keep content
    expect(text(await readScrollback(path))).toBe("data");
  });
});

describe("Scrollback — cap trimming", () => {
  it("drops whole chunks from the front once over the cap", async () => {
    const path = nextPath();
    // cap 10 bytes; three 4-byte chunks (12 total) → the first is trimmed.
    const s = new Scrollback(path, 10);
    s.append(bytes("aaaa"));
    s.append(bytes("bbbb"));
    s.append(bytes("cccc"));
    await s.flush();
    expect(text(await readScrollback(path))).toBe("bbbbcccc"); // "aaaa" trimmed
  });

  it("never drops the only chunk even if it exceeds the cap", async () => {
    const path = nextPath();
    const s = new Scrollback(path, 4);
    s.append(bytes("way too long for the cap"));
    await s.flush();
    expect(text(await readScrollback(path))).toBe("way too long for the cap");
  });
});

describe("Scrollback — close flushes", () => {
  it("close() flushes remaining bytes and clears the timer", async () => {
    const path = nextPath();
    const s = new Scrollback(path, 2_000_000, 10_000); // long debounce; close forces it
    s.append(bytes("final"));
    await s.close();
    expect(text(await readScrollback(path))).toBe("final");
  });
});
