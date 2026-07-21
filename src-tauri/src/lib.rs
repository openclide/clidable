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

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{IconMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, Manager, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
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
        // Open maximized (fills the work area) — the restore size is the fallback
        // when the user un-maximizes. Keeps parity with the main window's config.
        .maximized(true)
        .inner_size(1440.0, 900.0)
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

/// Frontend command: open a URL in the user's default browser.
///
/// `window.open` can't do this from the webview — WKWebView asks a navigation
/// delegate Tauri doesn't install, so the call silently no-ops. Handing the URL
/// to the OS is the shell's job.
///
/// Only http/https are forwarded. The preview address bar is user-typed, but a
/// dev server can also redirect it, and `open`ing an arbitrary scheme is how a
/// URL turns into "run this" (file://, and every app-registered handler on the
/// machine). Anything else is refused rather than passed through.
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // A prefix test is enough to decide this: a string starting with `http://`
    // IS an http URL to whatever the OS hands it to. Deliberately strict —
    // leading whitespace or any other scheme is refused, not normalised.
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("refusing to open a non-http(s) URL".into());
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Reveal + focus the window whose webview invoked this. Tauri injects the
/// caller's window, so the frontend calls it with no args. The tray's
/// "open agent" flow uses it to bring forward the window owning that agent —
/// including a secondary workspace window the tray can't address by name.
#[tauri::command]
fn reveal_window(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

// ── Tray agent status ───────────────────────────────────────────────────────
// The menu-bar tray mirrors every live agent across the whole server: the
// dropdown lists them (name + a colored state dot) and the tray icon wears a
// corner pip in the highest-priority color. A background thread polls the
// server's authoritative /api/agents/live (the frontend's status store is
// per-window, so only the server sees agents in *other*, hidden windows) and
// marshals UI updates to the main thread.

/// Stable id so the poll thread can fetch the tray via `tray_by_id`.
const TRAY_ID: &str = "clidable-tray";
/// How often to re-read live agent status (ms).
const TRAY_POLL_MS: u64 = 1200;
/// Side of the square tray icon we render (the OS downscales to the menu bar).
const TRAY_ICON_PX: u32 = 128;
/// Side of the small status-dot icon on each menu row (2× for retina crispness).
const MENU_DOT_PX: u32 = 36;

/// A live agent as the tray needs it. Extra JSON fields (e.g. `agent`) are
/// ignored — serde skips unknown keys by default.
#[derive(Deserialize, Clone)]
struct TrayAgent {
    id: String,
    name: String,
    state: String,
}

#[derive(Deserialize)]
struct LiveAgentsResp {
    agents: Vec<TrayAgent>,
}

/// Pre-rendered tray icon variants, kept as raw RGBA so a borrowed
/// `Image::new` can be handed to `set_icon` on demand. Indexed by priority
/// rank (see `rank_of`): 0 neutral, 1 working, 2 done, 3 blocked.
struct TrayAssets {
    w: u32,
    h: u32,
    variants: Vec<Vec<u8>>,
    /// Small status-dot icons for menu rows (RGBA), indexed by `rank_of`.
    dot_px: u32,
    dots: Vec<Vec<u8>>,
    /// Last-rendered `id/state/name` signature — skip the UI churn when unchanged.
    last_sig: Mutex<String>,
    /// Whether any agent is currently "done" — a tray hover only fires the
    /// ack-done POST when there's actually a green pip to clear.
    has_done: AtomicBool,
}

/// Priority of a state for the tray icon's pip: blocked ▸ done ▸ working ▸ idle.
fn rank_of(state: &str) -> usize {
    match state {
        "blocked" => 3,
        "done" => 2,
        "working" => 1,
        _ => 0,
    }
}

/// Human-readable status shown in parens after each agent's name in the menu.
fn state_label(state: &str) -> &'static str {
    match state {
        "blocked" => "waiting",
        "working" => "working",
        "done" => "done",
        _ => "idle",
    }
}

/// RGB for each rank's pip (index matches `rank_of`; 0 is unused — no pip).
const PIP_COLORS: [[u8; 3]; 4] = [
    [0, 0, 0],       // idle — neutral icon, no pip drawn
    [10, 132, 255],  // working — blue
    [48, 209, 88],   // done — green
    [245, 166, 35],  // blocked — amber
];

/// Muted RGB for each rank's menu-row status dot (index matches `rank_of`).
/// Softer than the tray-icon pip so the dropdown stays calm, and idle is a
/// quiet gray rather than a stark white.
const DOT_COLORS: [[u8; 3]; 4] = [
    [142, 142, 147], // idle — muted gray
    [90, 165, 245],  // working — soft blue
    [78, 200, 120],  // done — soft green
    [235, 170, 70],  // blocked — soft amber
];

/// Draw a filled status dot with a white halo (so it reads on any menu-bar
/// shade) into a copy of the base RGBA buffer's top-right corner.
fn draw_pip(base: &[u8], w: u32, h: u32, color: [u8; 3]) -> Vec<u8> {
    let mut out = base.to_vec();
    let cx = w as f32 * 0.74; // right
    let cy = h as f32 * 0.26; // top
    let r_fill = w as f32 * 0.21; // a touch bigger
    let r_out = r_fill + w as f32 * 0.05; // white halo width
    let x0 = (cx - r_out).floor().max(0.0) as u32;
    let x1 = (cx + r_out).ceil().min(w as f32) as u32;
    let y0 = (cy - r_out).floor().max(0.0) as u32;
    let y1 = (cy + r_out).ceil().min(h as f32) as u32;
    for y in y0..y1 {
        for x in x0..x1 {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let d = (dx * dx + dy * dy).sqrt();
            let i = ((y * w + x) * 4) as usize;
            if d <= r_fill {
                out[i] = color[0];
                out[i + 1] = color[1];
                out[i + 2] = color[2];
                out[i + 3] = 255;
            } else if d <= r_out {
                out[i] = 255;
                out[i + 1] = 255;
                out[i + 2] = 255;
                out[i + 3] = 255;
            }
        }
    }
    out
}

/// A small, anti-aliased status dot on a transparent square — the subtle
/// menu-row indicator that replaces the clunky full-color emoji. The dot is
/// deliberately small within its box so it reads as a quiet accent, not a bullet.
fn draw_dot(px: u32, color: [u8; 3]) -> Vec<u8> {
    let mut out = vec![0u8; (px * px * 4) as usize]; // transparent
    let c = px as f32 / 2.0;
    let r = px as f32 * 0.24; // small + padded = subtle
    for y in 0..px {
        for x in 0..px {
            let dx = x as f32 + 0.5 - c;
            let dy = y as f32 + 0.5 - c;
            let d = (dx * dx + dy * dy).sqrt();
            // 1px alpha ramp at the edge → a smooth, non-pixelated circle.
            let a = ((r - d + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
            if a > 0 {
                let i = ((y * px + x) * 4) as usize;
                out[i] = color[0];
                out[i + 1] = color[1];
                out[i + 2] = color[2];
                out[i + 3] = a;
            }
        }
    }
    out
}

/// Decode the embedded tray mark, resize it, and build the four pip variants.
/// `None` if the PNG can't be decoded (keeps the app booting with a static tray).
fn build_tray_assets() -> Option<TrayAssets> {
    // `include_bytes!` is relative to THIS source file (src/), unlike
    // `include_image!` above which resolves from the crate root.
    let img = image::load_from_memory(include_bytes!("../icons/tray.png")).ok()?;
    let rgba = image::imageops::resize(
        &img.to_rgba8(),
        TRAY_ICON_PX,
        TRAY_ICON_PX,
        image::imageops::FilterType::Lanczos3,
    );
    let (w, h) = (rgba.width(), rgba.height());
    let base = rgba.into_raw();
    let variants = vec![
        base.clone(),                          // 0 neutral (no pip)
        draw_pip(&base, w, h, PIP_COLORS[1]),  // 1 working
        draw_pip(&base, w, h, PIP_COLORS[2]),  // 2 done
        draw_pip(&base, w, h, PIP_COLORS[3]),  // 3 blocked
    ];
    let dots = DOT_COLORS.iter().map(|&c| draw_dot(MENU_DOT_PX, c)).collect();
    Some(TrayAssets {
        w,
        h,
        variants,
        dot_px: MENU_DOT_PX,
        dots,
        last_sig: Mutex::new(String::new()),
        has_done: AtomicBool::new(false),
    })
}

/// Parse a `Content-Length` value out of raw HTTP response headers.
fn content_length(headers: &[u8]) -> Option<usize> {
    let s = std::str::from_utf8(headers).ok()?;
    for line in s.split("\r\n") {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                return v.trim().parse().ok();
            }
        }
    }
    None
}

/// Send a request to the loopback server and return the response body (no
/// HTTP-client dep). Reads headers to CRLFCRLF, then exactly `Content-Length`
/// body bytes when present — so it does NOT depend on the server closing the
/// socket — else reads to EOF. `None` on any I/O error. Shared by the poll
/// (GET) and ack (POST) paths.
fn loopback_request(port: u16, req: &[u8]) -> Option<Vec<u8>> {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    stream.write_all(req).ok()?;

    let mut buf = Vec::new();
    let mut tmp = [0u8; 2048];
    // Read until the header/body separator is in hand.
    let head_end = loop {
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break p;
        }
        let n = stream.read(&mut tmp).ok()?;
        if n == 0 {
            return None; // closed before the headers completed
        }
        buf.extend_from_slice(&tmp[..n]);
    };
    let body_start = head_end + 4;
    match content_length(&buf[..head_end]) {
        Some(len) => {
            while buf.len() - body_start < len {
                let n = stream.read(&mut tmp).ok()?;
                if n == 0 {
                    break; // server closed early
                }
                buf.extend_from_slice(&tmp[..n]);
            }
            let end = (body_start + len).min(buf.len());
            Some(buf[body_start..end].to_vec())
        }
        None => {
            let _ = stream.read_to_end(&mut buf); // no length ⇒ read to close
            Some(buf[body_start..].to_vec())
        }
    }
}

/// GET /api/agents/live → the live agent list, or None on any failure.
fn fetch_live_agents(port: u16) -> Option<Vec<TrayAgent>> {
    let body = loopback_request(
        port,
        b"GET /api/agents/live HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )?;
    let resp: LiveAgentsResp = serde_json::from_slice(&body).ok()?;
    Some(resp.agents)
}

/// POST /api/agents/ack-done — clear finished ("done") agents so the green pip
/// drops once the user has looked at the tray. Fire-and-forget.
fn ack_done(port: u16) {
    let _ = loopback_request(
        port,
        b"POST /api/agents/ack-done HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
}

/// Sorted `id/state/name` fingerprint — the tray re-renders when this changes.
/// Name is included so a rename (which changes only the name, not the state)
/// still triggers a redraw; without it the poller would skip the update and the
/// old name would linger until the agent's state next changed. Control-char
/// separators (`\u{1f}` fields, `\u{1e}` records) can't collide with a name.
fn agents_signature(agents: &[TrayAgent]) -> String {
    let mut parts: Vec<String> = agents
        .iter()
        .map(|a| format!("{}\u{1f}{}\u{1f}{}", a.id, a.state, a.name))
        .collect();
    parts.sort();
    parts.join("\u{1e}")
}

/// Human summary for the tray tooltip, e.g. "2 waiting · 1 done · 3 working".
fn tray_tooltip(agents: &[TrayAgent]) -> String {
    if agents.is_empty() {
        return "Clidable — no active agents".into();
    }
    let count = |s: &str| agents.iter().filter(|a| a.state == s).count();
    let mut segs = Vec::new();
    let (b, d, w) = (count("blocked"), count("done"), count("working"));
    if b > 0 {
        segs.push(format!("{b} waiting"));
    }
    if d > 0 {
        segs.push(format!("{d} done"));
    }
    if w > 0 {
        segs.push(format!("{w} working"));
    }
    if segs.is_empty() {
        format!("Clidable — {} idle", agents.len())
    } else {
        segs.join(" · ")
    }
}

/// Rebuild the tray menu + icon from a fresh agent list. Must run on the main
/// thread (macOS UI). Called via `run_on_main_thread` from the poll loop.
fn render_tray(app: &AppHandle, agents: &[TrayAgent]) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    // One lookup for the whole render — the dot images, the icon pip, and the
    // has-done flag all read it. Held so each row's dot Image can borrow its
    // cached RGBA buffer through the build call.
    let assets = app.try_state::<TrayAssets>();

    let mut mb = MenuBuilder::new(app);
    if agents.is_empty() {
        if let Ok(item) = MenuItemBuilder::with_id("noagents", "No active agents")
            .enabled(false)
            .build(app)
        {
            mb = mb.item(&item);
        }
    } else {
        for a in agents {
            let label = format!("{} ({})", a.name, state_label(&a.state));
            let mut builder = IconMenuItemBuilder::with_id(format!("agent:{}", a.id), label);
            if let Some(assets) = assets.as_ref() {
                if let Some(buf) = assets.dots.get(rank_of(&a.state)) {
                    builder = builder.icon(Image::new(buf, assets.dot_px, assets.dot_px));
                }
            }
            if let Ok(item) = builder.build(app) {
                mb = mb.item(&item);
            }
        }
    }
    let menu = match mb
        .separator()
        .text("show", "Show Clidable")
        .separator()
        .text("quit", "Quit Clidable")
        .build()
    {
        Ok(m) => m,
        Err(_) => return,
    };
    let _ = tray.set_menu(Some(menu));
    let _ = tray.set_tooltip(Some(tray_tooltip(agents)));

    // Icon pip = highest-priority state across all agents; record whether
    // anything is "done" so a tray hover only fires the ack POST when needed.
    let rank = agents.iter().map(|a| rank_of(&a.state)).max().unwrap_or(0);
    if let Some(assets) = assets.as_ref() {
        if let Some(buf) = assets.variants.get(rank) {
            let _ = tray.set_icon(Some(Image::new(buf, assets.w, assets.h)));
        }
        assets
            .has_done
            .store(agents.iter().any(|a| a.state == "done"), Ordering::Relaxed);
    }
}

/// Spawn the background poller that keeps the tray in sync with live agents.
fn spawn_tray_poller(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(TRAY_POLL_MS));
        if !server_up() {
            continue;
        }
        let Some(agents) = fetch_live_agents(server_port()) else {
            continue;
        };
        let sig = agents_signature(&agents);
        // Skip if unchanged. Only this thread touches last_sig, so a check-now,
        // set-later without holding the lock across the render is race-free.
        if let Some(assets) = handle.try_state::<TrayAssets>() {
            if *assets.last_sig.lock().unwrap() == sig {
                continue;
            }
        }
        let h = handle.clone();
        // Advance last_sig only once the render is actually queued — if the
        // dispatch fails, leave the signature stale so the next poll retries
        // instead of skipping a lost update forever.
        if handle
            .run_on_main_thread(move || render_tray(&h, &agents))
            .is_ok()
        {
            if let Some(assets) = handle.try_state::<TrayAssets>() {
                *assets.last_sig.lock().unwrap() = sig;
            }
        }
    });
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            capture::capture_webview,
            open_workspace_window,
            open_external,
            reveal_window
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
                    // Maximize on reveal too — the `maximized: true` config can be
                    // flaky on a window created hidden, so force it before showing.
                    let _ = main.maximize();
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
            // as-drawn (plus its colored status pip) rather than being re-tinted.
            // A stable id lets the status poller re-target it via `tray_by_id`.
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(false)
                .tooltip("Clidable")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    let id = event.id().as_ref();
                    match id {
                        "show" => focus_main(app),
                        "quit" => app.exit(0),
                        // Clicking an agent row opens that exact terminal. We only
                        // know its session id, not which window holds it, so fan
                        // the id out to every window — the one that owns it
                        // activates the tab and reveals itself (see lib/tray.ts).
                        // focus_main guarantees the app surfaces even if the owner
                        // is the hidden main window (whose webview may be parked).
                        _ if id.starts_with("agent:") => {
                            focus_main(app);
                            if let Some(sid) = id.strip_prefix("agent:") {
                                let _ = app.emit("tray:open-agent", sid.to_string());
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::TrayIconEvent;
                    // Interacting with the tray icon (clicking or hovering to open
                    // the menu) means the user is looking → acknowledge finished
                    // agents so the green "done" pip clears. Blocked (amber) is a
                    // live state and stays. Off the UI thread — it's a blocking
                    // loopback POST. (macOS suppresses the left-click event when a
                    // menu is attached, so Enter/hover is the reliable trigger.)
                    if matches!(
                        event,
                        TrayIconEvent::Click { .. } | TrayIconEvent::Enter { .. }
                    ) {
                        // Only when there's actually a green pip to clear — avoids
                        // a thread + POST on every incidental hover.
                        let has_done = tray
                            .app_handle()
                            .try_state::<TrayAssets>()
                            .map(|a| a.has_done.load(Ordering::Relaxed))
                            .unwrap_or(false);
                        if has_done {
                            std::thread::spawn(|| ack_done(server_port()));
                        }
                    }
                })
                .build(app)?;

            // Keep the tray's agent roster + status pip live. Skips silently if the
            // tray mark can't be decoded (the static Show/Quit tray still works).
            if let Some(assets) = build_tray_assets() {
                app.manage(assets);
                spawn_tray_poller(&handle);
            }

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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Drive the event loop so we can react to app-level events. On macOS,
        // clicking the Dock icon of a running-but-hidden app fires `Reopen`
        // (the app has no visible window because close only HID it) — bring the
        // main window back, matching the tray's Show. Without this the Dock icon
        // is a dead click and the tray is the only way in.
        .run(|_handle, _event| {
            // Only surface main when the app has NO visible window (it was hidden
            // on close) — if a secondary workspace window is already up, a Dock
            // click shouldn't yank the hidden main window in front of it.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = _event
            {
                focus_main(_handle);
            }
        });
}
