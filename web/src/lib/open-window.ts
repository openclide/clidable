/**
 * Open a workspace in a second UI surface.
 *
 * On the desktop app this asks the Rust shell to spawn a real native window
 * (a genuine second window sharing the one background server); in the browser
 * it opens a new tab. Either way the new surface lands via the App's deep-link
 * parsing (`?workspace=` / `?cwd=`), so both paths converge on the same code.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./shell";

function openWith(query: string): void {
  const url = `/?${query}`;
  if (isTauri()) {
    // The Rust command lands in the desktop shell (see src-tauri). If it isn't
    // available yet (older shell), fall back to a browser-style window.
    void invoke("open_workspace_window", { query }).catch((e) => {
      console.error("[open-window] native window failed; falling back", e);
      window.open(url);
    });
  } else {
    window.open(url);
  }
}

/** Resume an existing workspace in a new window/tab. */
export function openWorkspaceInNewWindow(workspaceId: string): void {
  openWith(`workspace=${encodeURIComponent(workspaceId)}`);
}
