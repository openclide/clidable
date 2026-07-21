/**
 * `backdropMode` decides whether the OS paints behind the window or we do, and
 * getting it wrong is invisible in CI and obvious to a user: too eager and a
 * platform ships a transparent window with nothing behind it (which is exactly
 * what Linux did — it matched the Tauri branch, got `background: transparent`,
 * and never got the gradient because that was keyed to the browser shell); too
 * shy and macOS/Windows lose their native material.
 *
 * These run without a DOM, so `window`/`navigator` are stubbed per case.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { backdropMode, isLinux } from "./shell";

const realNavigator = globalThis.navigator;
const realWindow = (globalThis as { window?: unknown }).window;

/** Pretend to be a given platform, optionally inside the Tauri shell. */
function pretend(opts: { platform: string; ua: string; tauri: boolean }) {
  Object.defineProperty(globalThis, "navigator", {
    value: { platform: opts.platform, userAgent: opts.ua },
    configurable: true,
    writable: true,
  });
  (globalThis as { window?: unknown }).window = opts.tauri ? { __TAURI_INTERNALS__: {} } : {};
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: realNavigator,
    configurable: true,
    writable: true,
  });
  (globalThis as { window?: unknown }).window = realWindow;
});

const MAC = { platform: "MacIntel", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };
const WIN = { platform: "Win32", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const LINUX = { platform: "Linux x86_64", ua: "Mozilla/5.0 (X11; Linux x86_64)" };
const ANDROID = { platform: "Linux armv8l", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" };

describe("backdropMode", () => {
  it("defers to the OS in the desktop shell on macOS and Windows", () => {
    // macOS: NSVisualEffectView. Windows: Mica (Acrylic on Win10). Both are
    // real OS backdrops, so we must NOT paint over them.
    pretend({ ...MAC, tauri: true });
    expect(backdropMode()).toBe("vibrancy");
    pretend({ ...WIN, tauri: true });
    expect(backdropMode()).toBe("vibrancy");
  });

  it("paints on Linux even in the desktop shell", () => {
    // window-vibrancy has no Linux support and there is no cross-desktop blur
    // API, so a see-through window there shows the raw desktop (with a
    // compositor) or renders undefined (without one).
    pretend({ ...LINUX, tauri: true });
    expect(backdropMode()).toBe("painted");
  });

  it("paints in the browser on every platform", () => {
    for (const p of [MAC, WIN, LINUX]) {
      pretend({ ...p, tauri: false });
      expect(backdropMode()).toBe("painted");
    }
  });
});

describe("isLinux", () => {
  it("is true for desktop Linux and false for the other desktops", () => {
    pretend({ ...LINUX, tauri: false });
    expect(isLinux()).toBe(true);
    pretend({ ...MAC, tauri: false });
    expect(isLinux()).toBe(false);
    pretend({ ...WIN, tauri: false });
    expect(isLinux()).toBe(false);
  });

  it("does not count Android as Linux", () => {
    // Android's UA and platform both say Linux; treating it as desktop Linux
    // would opt the mobile PWA out of the painted backdrop for no reason.
    pretend({ ...ANDROID, tauri: false });
    expect(isLinux()).toBe(false);
  });
});
