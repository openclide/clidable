/**
 * Open a URL in the user's real browser.
 *
 * `window.open` is the obvious call and it silently does nothing in the desktop
 * app: WKWebView routes a new-window request to a navigation delegate Tauri
 * doesn't install, so the click just dies. The shell has to do it, via a Rust
 * command that hands the URL to the OS.
 *
 * Note there is deliberately NO window.open fallback on desktop — that is the
 * broken call this exists to replace, so using it as a rescue would just
 * reproduce the dead click with extra steps. The failure is logged and reported
 * to the caller instead; the app has no toast surface to show it in yet, so
 * that's the honest limit until one exists.
 *
 * Resolves true when the URL was handed off, false when it wasn't.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./shell";

export async function openExternal(url: string): Promise<boolean> {
  if (!url) return false;
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return true;
  }
  try {
    await invoke("open_external", { url });
    return true;
  } catch (e) {
    console.error("[open-external] the desktop shell refused to open", url, e);
    return false;
  }
}
