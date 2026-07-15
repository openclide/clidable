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
