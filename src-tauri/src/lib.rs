// Clidable Tauri shell.
//
// Intentionally thin: ~95% of the app lives in the Bun server. Tauri's job:
//   (a) own ONE background server for its lifetime (a sidecar spawned on launch
//       if none is already up) — so closing a window HIDES it (the app + server
//       keep running) and only the tray's Quit stops everything;
//   (b) open a native window per workspace (multi-window), each a webview onto
//       the same server via a `?workspace=`/`?cwd=` deep-link;
//   (c) forward a CLI launch (`clidable open <dir>` → `open -a Clidable --args
//       --cwd <dir>`) into the running instance via single-instance, opening a
//       window for that directory;
//   (d) apply OS-level window vibrancy (desktop-behind blur).
//
// In dev the server comes from `beforeDevCommand` (bun run dev); the sidecar is
// only spawned in release builds.

use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Manager, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

mod capture;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, apply_mica};

/// The port the main window's declarative URL (tauri.conf.json `windows[0].url`)
/// points at. Keep the two in sync — the setup navigates away from the
/// declarative URL whenever the effective port differs (see `need_nav`).
const DEFAULT_PORT: u16 = 7878;

/// The server port — matches the Bun server's own default + `CLIDABLE_PORT`
/// override (server/cli.ts). The sidecar inherits the app's env, so both layers
/// agree on the port. Defaults to 7878.
fn server_port() -> u16 {
    std::env::var("CLIDABLE_PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|p| *p > 0)
        .unwrap_or(DEFAULT_PORT)
}

/// The loopback server URL for the current port.
fn server_url() -> String {
    format!("http://127.0.0.1:{}", server_port())
}

/// Monotonic label counter so each dynamically-created window is unique. Labels
/// are `clidable-<n>`; the capability set globs `clidable-*` to grant them the
/// same permissions as `main`.
static WINDOW_SEQ: AtomicUsize = AtomicUsize::new(1);

fn next_label() -> String {
    format!("clidable-{}", WINDOW_SEQ.fetch_add(1, Ordering::Relaxed))
}

/// True if something is already listening on the server port (another Clidable
/// server — a still-running background instance, or a `clidable`-spawned daemon).
fn server_up() -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr: SocketAddr = ([127, 0, 0, 1], server_port()).into();
    TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300)).is_ok()
}

/// Spawn the bundled server as a sidecar IF one isn't already up. Plugin-shell
/// sidecars die with the app (Quit) but survive window-close (the app process
/// stays alive) — exactly the "background app, server until Quit" model.
fn ensure_server(app: &AppHandle) {
    if server_up() {
        return; // attach to the already-running server
    }
    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_shell::ShellExt;
        match app.shell().sidecar("clidable-server") {
            Ok(cmd) => {
                if let Err(e) = cmd.spawn() {
                    eprintln!("[clidable] could not spawn server sidecar: {e}");
                }
            }
            Err(e) => eprintln!("[clidable] server sidecar missing: {e}"),
        }
    }
    // Dev: the server is started by `beforeDevCommand` (bun run dev).
    #[cfg(debug_assertions)]
    let _ = app;
}

/// Clidable is dark-first + uses OS vibrancy. Force the window dark and apply the
/// platform blur. Applied to every window (main and dynamic) so new windows
/// match — the old code only did this for "main".
fn apply_window_chrome(window: &WebviewWindow) {
    let _ = window.set_theme(Some(Theme::Dark));

    #[cfg(target_os = "macos")]
    {
        let _ = apply_vibrancy(
            window,
            NSVisualEffectMaterial::HudWindow,
            Some(NSVisualEffectState::Active),
            None,
        );
    }

    #[cfg(target_os = "windows")]
    {
        // Prefer Mica on Win11; fall back to Acrylic on Win10.
        if apply_mica(window, Some(true)).is_err() {
            let _ = apply_acrylic(window, Some((18, 18, 18, 125)));
        }
    }

    // Linux is compositor-dependent — the CSS gradient fallback handles it.
    let _ = window;
}

/// Open a native window onto the server, optionally deep-linked (`workspace=<id>`
/// or `cwd=<path>`). The webview loads from the server URL, so every window is
/// the same app the browser gets.
fn open_window(app: &AppHandle, query: &str) -> tauri::Result<WebviewWindow> {
    let base = server_url();
    let url = if query.is_empty() {
        base.clone()
    } else {
        format!("{base}/?{query}")
    };
    // A well-formed base + our own query — parse never realistically fails; on a
    // malformed frontend query, fall back to the base URL rather than panic.
    let parsed: tauri::Url = url
        .parse()
        .unwrap_or_else(|_| base.parse().expect("server url is valid"));
    let window = WebviewWindowBuilder::new(app, next_label(), WebviewUrl::External(parsed))
        .title("")
        .inner_size(1280.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .transparent(true)
        .decorations(true)
        .build()?;
    apply_window_chrome(&window);
    Ok(window)
}

/// Frontend command: open a workspace in a new native window. `query` is the raw
/// query string, e.g. `workspace=<id>`.
#[tauri::command]
fn open_workspace_window(app: AppHandle, query: String) -> Result<(), String> {
    open_window(&app, &query).map(|_| ()).map_err(|e| e.to_string())
}

/// Pull `--cwd <path>` (or `--cwd=<path>`) out of an argv vector.
fn cwd_arg(argv: &[String]) -> Option<String> {
    let mut it = argv.iter();
    while let Some(a) = it.next() {
        if a == "--cwd" {
            return it.next().cloned();
        }
        if let Some(v) = a.strip_prefix("--cwd=") {
            return Some(v.to_string());
        }
    }
    None
}

/// Build the deep-link query for a CLI launch — `cwd=<path>` plus `&new=1` when
/// `--new` was passed (force a fresh workspace rather than resuming the latest
/// one that already contains the folder). None when there's no `--cwd`.
fn cwd_query(argv: &[String]) -> Option<String> {
    let dir = cwd_arg(argv)?;
    let mut q = format!("cwd={}", urlencoding::encode(&dir));
    if argv.iter().any(|a| a == "--new") {
        q.push_str("&new=1");
    }
    Some(q)
}

/// Show + focus the main window (creating nothing new).
fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance FIRST so it grabs the lock before anything else. A
        // second launch (e.g. `clidable open <dir>` → `open -a Clidable --args
        // --cwd <dir>`) fires this callback in the ALREADY-running instance with
        // the new argv → we open a window for that directory instead of booting
        // a second app.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            match cwd_query(&argv) {
                Some(q) => {
                    let _ = open_window(app, &q);
                }
                None => focus_main(app),
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            capture::capture_webview,
            open_workspace_window
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Was a server already answering before we (maybe) spawned the sidecar?
            // If so, the main window's declarative load succeeds and needs no
            // re-navigation; if not, that first load races a not-yet-ready server.
            let was_up = server_up();
            // Own the background server for this app's lifetime.
            ensure_server(&handle);

            // The main window is created hidden (tauri.conf `visible: false`) and
            // loads the server URL immediately. Wait for the server to answer, then
            // reveal it — navigating first ONLY when needed: to apply a `--cwd`
            // deep-link, or to recover a first load that raced a cold sidecar. In
            // the common case (server already up, no deep-link) the declarative
            // load already succeeded, so we just show it — no redundant reload.
            if let Some(main) = app.get_webview_window("main") {
                apply_window_chrome(&main);
                let base = server_url();
                let cwd_q = cwd_query(&std::env::args().collect::<Vec<_>>());
                // Re-navigate when: a `--cwd` deep-link needs applying, the first
                // load raced a cold sidecar, OR the effective port differs from the
                // one baked into the declarative URL (else a CLIDABLE_PORT override
                // would leave the window pointed at the wrong, default port).
                let need_nav = cwd_q.is_some() || !was_up || server_port() != DEFAULT_PORT;
                let target = match &cwd_q {
                    Some(q) => format!("{base}/?{q}"),
                    None => base.clone(),
                };
                let url: tauri::Url = target
                    .parse()
                    .unwrap_or_else(|_| base.parse().expect("server url is valid"));
                std::thread::spawn(move || {
                    for _ in 0..50 {
                        if server_up() {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(300));
                    }
                    if need_nav {
                        // Native navigate (not eval) so it works even if the initial
                        // hidden load errored on a not-yet-ready server.
                        let _ = main.navigate(url);
                    }
                    let _ = main.show();
                    let _ = main.set_focus();
                });
            }

            // Menu-bar / tray — the real off-switch. Show restores the main
            // window; Quit exits the app (killing the sidecar server with it).
            let menu = MenuBuilder::new(app)
                .text("show", "Show Clidable")
                .separator()
                .text("quit", "Quit Clidable")
                .build()?;
            // A dedicated WHITE menu-bar icon (icons/tray.png) — distinct from the
            // full-color dock/app icon. Not a template image, so it stays white
            // as-drawn rather than being re-tinted by the system.
            TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(false)
                .tooltip("Clidable")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => focus_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        // Closing the MAIN window HIDES it (the app + its server keep running);
        // only the tray's Quit stops everything. Secondary workspace windows
        // close/destroy normally — hiding them too would leak webviews and keep
        // their WebSockets open, pinning their PTYs so the reaper never collects
        // them. A destroyed window's PTYs enter the normal detach-grace instead.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
