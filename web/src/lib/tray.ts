/**
 * Desktop tray → workspace bridge.
 *
 * The menu-bar tray (see src-tauri) emits `tray:open-agent` carrying a
 * session/instance id when the user clicks an agent row. The event fans out to
 * every window; only the one that actually owns that terminal acts on it —
 * activating the tab and revealing itself. No-op in the browser.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./shell";

/**
 * Subscribe to tray "open agent" clicks. `open(instanceId)` should surface the
 * terminal (restoring it from the dock if minimized) and return `true` when
 * this window owns it — in which case the window is shown + focused. Windows
 * that don't own it return `false` and stay put. Returns an unsubscribe fn.
 */
export function subscribeTrayOpenAgent(open: (instanceId: string) => boolean): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  void listen<string>("tray:open-agent", (e) => {
    if (open(e.payload)) void invoke("reveal_window").catch(() => {});
  }).then((un) => {
    // Unmounted before the listener resolved — drop it immediately.
    if (cancelled) un();
    else unlisten = un;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
