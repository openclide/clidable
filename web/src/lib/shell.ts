/**
 * Detects which "shell" the frontend is running inside:
 *   - "tauri"   — bundled desktop app, Tauri APIs available
 *   - "browser" — plain web/PWA mode, only browser APIs
 *
 * Used both to gate Tauri-only features (window vibrancy reads, system tray,
 * deep keychain, etc.) and to swap visual fallbacks (solid background in
 * browser; transparent + OS-level vibrancy in Tauri — see globals.css).
 */
export type Shell = "tauri" | "browser";

export function detectShell(): Shell {
  if (typeof window === "undefined") return "browser";
  return "__TAURI_INTERNALS__" in window ? "tauri" : "browser";
}

export const isTauri = (): boolean => detectShell() === "tauri";

/** True on macOS. Used to reserve space for the overlay traffic lights, which
 *  sit at the window's top-left only on macOS — on Windows/Linux the controls
 *  are elsewhere, and in the browser there are none. */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform) || /Macintosh|Mac OS X/i.test(navigator.userAgent ?? "");
}

/** Reserve the top-left strip for the macOS traffic lights — only when the
 *  desktop app is actually running on macOS (overlay titlebar). */
export const hasMacTrafficLights = (): boolean => isTauri() && isMacOS();

/** True on Linux. Only interesting because it's the one desktop platform with no
 *  OS backdrop API at all — see `backdropMode`. */
export function isLinux(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";
  // "Android" also matches /linux/i in the UA string; exclude it explicitly.
  if (/android/i.test(navigator.userAgent ?? "")) return false;
  return /linux|x11/i.test(platform) || /X11|Linux/.test(navigator.userAgent ?? "");
}

/**
 * Who draws the window's backdrop.
 *
 *   - "vibrancy" — nobody, deliberately. The window is see-through and the OS
 *     paints behind it, so any background of ours would cover that up. macOS
 *     (NSVisualEffectView) and Windows (Mica, or Acrylic on Win10) both do this.
 *   - "painted"  — we do, with the gradient mesh. The browser/PWA has no window
 *     to see through, and Linux has no blur API at all: `window-vibrancy`
 *     supports only macOS and Windows, and there is no cross-desktop
 *     equivalent. A transparent window there shows the raw desktop (with a
 *     compositor) or renders undefined (without one), so Linux must paint.
 *
 * Keyed on the capability rather than the shell, because "is it Tauri" and "is
 * the window see-through" are NOT the same question — that conflation is why
 * the Linux build shipped transparent with nothing behind it.
 *
 * Note on Windows: Mica samples the desktop WALLPAPER (blurred and tinted), it
 * does not live-blur the windows behind you. Over a plain or solid wallpaper a
 * perfectly working Mica looks flat — verified on Windows 11 build 26100, where
 * the app reported `window backdrop: mica` and still looked like a flat panel.
 * Flat is not evidence that it failed.
 */
export type BackdropMode = "vibrancy" | "painted";

export const backdropMode = (): BackdropMode =>
  isTauri() && !isLinux() ? "vibrancy" : "painted";
