// Clidable Tauri shell.
//
// This is intentionally thin: ~95% of the application lives in the Bun
// process. Tauri's job here is to (a) open a native window pointed at the
// Bun server, and (b) apply OS-level window vibrancy so the user's desktop
// shows through with a blur (see PLAN.md §9).
//
// The Bun server is started by `beforeDevCommand` / `beforeBuildCommand`
// in tauri.conf.json. In a future revision we'll bundle the compiled Bun
// binary as a sidecar (`externalBin`) so production installs spawn it
// automatically.

use tauri::{Manager, Theme};

mod capture;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, apply_mica};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![capture::capture_webview])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window missing");

            // Clidable is dark-first. Force the window appearance so NSVisualEffectView
            // (and webview prefers-color-scheme) render dark even when the user's macOS
            // is in light mode — otherwise vibrancy is light + our text is white →
            // invisible UI. Light theme support is a v1.x feature.
            window
                .set_theme(Some(Theme::Dark))
                .expect("failed to set window theme");

            // Layer 1: OS-level vibrancy (real desktop-behind blur).
            // Layer 2 (in-webview backdrop-filter) is pure CSS in globals.css.
            #[cfg(target_os = "macos")]
            apply_vibrancy(
                &window,
                NSVisualEffectMaterial::HudWindow,
                Some(NSVisualEffectState::Active),
                None,
            )
            .expect("failed to apply macOS vibrancy");

            #[cfg(target_os = "windows")]
            {
                // Prefer Mica on Win11 (perf-friendly, wallpaper-tinted).
                // Fall back to Acrylic on Win10.
                if apply_mica(&window, Some(true)).is_err() {
                    apply_acrylic(&window, Some((18, 18, 18, 125)))
                        .expect("failed to apply Windows acrylic");
                }
            }

            // Linux is compositor-dependent — most Mutter setups don't
            // support per-window blur. CSS gradient fallback handles it
            // (body[data-shell="tauri"] still works without vibrancy;
            //  it just shows the OS-set window background).

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
