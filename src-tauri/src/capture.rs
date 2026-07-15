// Desktop-only screen capture for checkpoint screenshots (PLAN.md §2).
//
// We snapshot the *webview itself* via WKWebView.takeSnapshot, not the
// OS screen. Two reasons this beats an OS-level grab (xcap etc.):
//   1. No permission. OS screen capture is gated by macOS Screen
//      Recording (TCC) regardless of window ownership; a webview
//      snapshotting itself is in-process and needs nothing.
//   2. It captures cross-origin iframe pixels. The cross-origin wall
//      blocks DOM-canvas *reads*; a render-to-image of the composited
//      webview is fine.
//
// The command returns a base64 PNG of the *whole* webview viewport;
// the frontend crops to the preview pane (where the rect math is
// unambiguous — see lib/screenshot.ts). Errors come back as strings;
// the frontend treats them as "no screenshot" and the checkpoint still
// records.
//
// Every desktop platform uses the webview's own permission-free
// snapshot API:
//   - macOS:        WKWebView.takeSnapshot                (objc2)
//   - Windows:      ICoreWebView2.CapturePreview → IStream (webview2-com)
//   - Linux + BSDs: webkit_web_view_get_snapshot → cairo   (webkit2gtk)
//
// They share one shape: `with_webview` hops to the main/UI thread to
// kick off the (async) snapshot, the completion handler fires later —
// also on the main thread — and ships the base64 PNG back over an mpsc
// channel that this (worker-thread) async command is blocked on. The
// command MUST stay `async`: a sync command runs on the main thread, so
// blocking on the channel there would deadlock the very thread the
// completion handler needs (see the macOS note below).
//
// PANIC-SAFETY: the snapshot kickoff and the completion callbacks run on
// the main/UI thread, invoked across a foreign frame (ObjC block / COM
// vtable / GLib trampoline). Release builds use `panic = "abort"`
// (Cargo.toml), so a panic in those bodies is a clean immediate abort —
// not UB — but it IS fatal, and there is no catch_unwind net (which abort
// makes a no-op anyway). So keep every callback body panic-free: no
// `unwrap`/`expect`/unchecked `[i]` indexing; route every fallible step
// through `?` / `ok_or` / `map_err` so it degrades to an `Err`
// ("no screenshot") instead. Heavy fallible work is already deferred to
// the worker thread, which keeps these bodies small and easy to audit.

// Tail shared by the three real capture impls. The catch-all stub doesn't
// use these, so `#[allow(dead_code)]` keeps the unsupported-target build
// quiet. (base64 + std only, so this compiles on every target.)
#[allow(dead_code)]
mod shared {
    use std::sync::mpsc::{Receiver, RecvTimeoutError};
    use std::time::Duration;

    // Generous; a real snapshot is sub-100ms.
    const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5);

    // Block the (worker-thread) command until the main/UI-thread completion
    // handler delivers its payload `T` (raw bytes to be encoded on the
    // worker, or — on Linux — the finished base64). Distinguish a true
    // timeout (handler never fired) from an abort (every sender dropped
    // without sending — e.g. the webview was torn down mid-capture) so the
    // abort isn't misread as a 5s hang when it actually returned at once.
    pub fn recv_capture<T>(rx: Receiver<Result<T, String>>) -> Result<T, String> {
        match rx.recv_timeout(SNAPSHOT_TIMEOUT) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => Err("snapshot timed out".to_string()),
            Err(RecvTimeoutError::Disconnected) => {
                Err("snapshot aborted before completion (webview gone)".to_string())
            }
        }
    }

    // PNG bytes → standard-base64 (no `data:` prefix), the wire format the
    // frontend expects.
    pub fn b64(bytes: &[u8]) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }
}

// NOTE: must be `async`. Synchronous Tauri commands run on the main
// thread; blocking there on the snapshot result would deadlock —
// WKWebView delivers the completion handler on the main thread too, so
// it can't fire until the command returns. An async command runs on a
// worker thread, leaving main free to deliver the completion.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn capture_webview(window: tauri::WebviewWindow) -> Result<String, String> {
    use block2::RcBlock;
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{MainThreadMarker, NSData, NSDictionary, NSError, NSString};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use std::sync::mpsc::channel;

    // Main thread (completion handler): NSImage → TIFF bytes, a plain
    // `Vec<u8>` we can ship to the worker. TIFF is the cheap half; the
    // expensive PNG deflate is deferred to `encode_png` below so it doesn't
    // jank the main thread.
    unsafe fn extract_tiff(image: *mut NSImage, error: *mut NSError) -> Result<Vec<u8>, String> {
        if image.is_null() {
            return Err(if error.is_null() {
                "snapshot returned nil".to_string()
            } else {
                format!("snapshot error: {}", (*error).localizedDescription())
            });
        }
        let image: &NSImage = &*image;
        let tiff = image
            .TIFFRepresentation()
            .ok_or("no TIFF representation")?;
        Ok(tiff.to_vec())
    }

    // Worker thread: TIFF bytes → PNG → base64. Same NSBitmapImageRep
    // pipeline as before (byte-identical output), just off the main thread —
    // NSBitmapImageRep image I/O is thread-safe. The autorelease pool drains
    // the encoder's temporaries (this runs on a long-lived tokio worker).
    fn encode_png(tiff: &[u8]) -> Result<String, String> {
        objc2::rc::autoreleasepool(|_| {
            let data = NSData::with_bytes(tiff);
            let rep = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &data)
                .ok_or("could not build bitmap rep")?;
            let props: objc2::rc::Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> =
                NSDictionary::new();
            let png = unsafe {
                rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props)
            }
            .ok_or("PNG encode failed")?;
            Ok(shared::b64(&png.to_vec()))
        })
    }

    let (tx, rx) = channel::<Result<Vec<u8>, String>>();

    window
        .with_webview(move |pw| {
            // `with_webview`'s closure runs on the main thread — exactly
            // where WKWebView calls must happen.
            let ptr = pw.inner() as *const WKWebView;
            if ptr.is_null() {
                let _ = tx.send(Err("null webview handle".to_string()));
                return;
            }
            let webview: &WKWebView = unsafe { &*ptr };

            // A non-nil config is required: with a nil config,
            // `afterScreenUpdates` defaults to true, which makes the
            // snapshot wait for a pending screen update — on static
            // content that update never arrives and the completion
            // handler never fires (the timeout we saw). Setting it
            // false snapshots the currently-rendered pixels right away.
            // Default rect (CGRectNull) = the whole viewport.
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = tx.send(Err("with_webview ran off the main thread".to_string()));
                return;
            };
            let config = unsafe { WKSnapshotConfiguration::new(mtm) };
            unsafe { config.setAfterScreenUpdates(false) };

            let tx2 = tx.clone();
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let _ = tx2.send(unsafe { extract_tiff(image, error) });
            });
            unsafe {
                webview.takeSnapshotWithConfiguration_completionHandler(
                    Some(&config),
                    &handler,
                );
            }
        })
        .map_err(|e| e.to_string())?;

    // Off the main thread now: do the PNG deflate + base64 here.
    encode_png(&shared::recv_capture(rx)?)
}

// Windows: ICoreWebView2.CapturePreview writes a PNG into an IStream.
// Same async shape as macOS — we kick it off on the UI thread inside
// `with_webview`, and WebView2 delivers the completion handler on that
// same UI thread later (its single-threaded model posts callbacks via
// the message loop). Because this command runs on a worker thread, the
// UI thread's event loop keeps pumping, so the completion fires and
// unblocks the channel without a nested message pump.
#[cfg(windows)]
#[tauri::command]
pub async fn capture_webview(window: tauri::WebviewWindow) -> Result<String, String> {
    use std::sync::mpsc::channel;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    // Drain the IStream CapturePreview filled → PNG bytes. Runs inside the
    // completion handler (UI thread); the drain is a cheap memcpy from the
    // HGLOBAL, and WebView2 already did the PNG deflate off our UI thread, so
    // only the base64 is deferred (to the worker, by the caller). `result`
    // is the capture's own success/error HRESULT.
    unsafe fn read_stream(
        stream: &IStream,
        result: windows::core::Result<()>,
    ) -> Result<Vec<u8>, String> {
        result.map_err(|e| format!("CapturePreview failed: {e}"))?;
        // Rewind: CapturePreview leaves the seek pointer at the end.
        stream
            .Seek(0, STREAM_SEEK_SET, None)
            .map_err(|e| e.to_string())?;
        let mut stat = STATSTG::default();
        stream
            .Stat(&mut stat, STATFLAG_NONAME)
            .map_err(|e| e.to_string())?;
        let size = stat.cbSize as usize;
        let mut buf = vec![0u8; size];
        let mut total = 0usize;
        while total < size {
            let mut read = 0u32;
            // Read returns S_OK / S_FALSE (both success); `.ok()` only
            // errors on real failures. read == 0 means EOF.
            stream
                .Read(
                    buf[total..].as_mut_ptr() as *mut core::ffi::c_void,
                    (size - total) as u32,
                    Some(&mut read as *mut u32),
                )
                .ok()
                .map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            total += read as usize;
        }
        buf.truncate(total);
        Ok(buf)
    }

    let (tx, rx) = channel::<Result<Vec<u8>, String>>();

    window
        .with_webview(move |pw| {
            // Build everything on the UI thread, then fire CapturePreview.
            let setup: Result<(), String> = (|| {
                let controller = pw.controller();
                let core = unsafe { controller.CoreWebView2() }.map_err(|e| e.to_string())?;
                // A fresh auto-freeing in-memory stream for the PNG bytes.
                let stream =
                    unsafe { CreateStreamOnHGlobal(HGLOBAL(std::ptr::null_mut()), true) }
                        .map_err(|e| e.to_string())?;
                // The handler outlives this closure (WebView2 AddRefs it),
                // so it needs its own ref to the stream to read back.
                let stream_read = stream.clone();
                let tx2 = tx.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |res| {
                    let _ = tx2.send(unsafe { read_stream(&stream_read, res) });
                    Ok(())
                }));
                unsafe {
                    core.CapturePreview(
                        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                        &stream,
                        &handler,
                    )
                }
                .map_err(|e| e.to_string())?;
                Ok(())
            })();
            // Any setup failure short-circuits the waiting command.
            if let Err(e) = setup {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;

    // base64 the already-PNG'd bytes here, off the UI thread.
    Ok(shared::b64(&shared::recv_capture(rx)?))
}

// Linux (+ the BSDs): webkit_web_view_get_snapshot is async and hands back
// a cairo surface on the GTK main loop. Same worker-thread + channel shape:
// the closure (main thread) starts the snapshot, the callback (main thread,
// later) serialises the surface to PNG and sends it back. The cfg matches
// tauri's own `PlatformWebview::inner()`, which returns `webkit2gtk::WebView`
// on this whole GTK/WebKit family — not just Linux.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
#[tauri::command]
pub async fn capture_webview(window: tauri::WebviewWindow) -> Result<String, String> {
    use std::sync::mpsc::channel;
    use webkit2gtk::gio;
    use webkit2gtk::glib;
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

    // cairo::Surface → base64 PNG. The `png` feature on cairo-rs gives us
    // write_to_png straight onto an in-memory buffer (no gdk-pixbuf hop).
    //
    // Unlike macOS/Windows, the encode stays on the main loop here: cairo's
    // `Surface` is `!Send`, and cairo 0.18 has no clean `Surface → ImageSurface`
    // downcast to cheaply lift the raw pixels off-thread (you'd need
    // map_to_image + exclusive access). Deferring the deflate isn't worth that
    // fragility on a platform we can't yet build-verify — revisit with a Linux
    // box. write_to_png on a multi-megapixel snapshot is the one main-loop cost.
    fn encode_surface(res: Result<cairo::Surface, glib::Error>) -> Result<String, String> {
        let surface = res.map_err(|e| format!("snapshot error: {e}"))?;
        let mut buf: Vec<u8> = Vec::new();
        surface
            .write_to_png(&mut buf)
            .map_err(|e| format!("PNG encode failed: {e}"))?;
        Ok(shared::b64(&buf))
    }

    let (tx, rx) = channel::<Result<String, String>>();

    window
        .with_webview(move |pw| {
            // `inner()` is the live webkit2gtk::WebView; the closure runs
            // on the GTK main thread, which owns the main context the
            // async snapshot requires.
            let webview = pw.inner();
            let tx2 = tx.clone();
            // Region::Visible = the on-screen viewport (matches the macOS/
            // Windows whole-viewport contract the JS crop assumes).
            webview.snapshot(
                SnapshotRegion::Visible,
                SnapshotOptions::NONE,
                gio::Cancellable::NONE,
                move |res| {
                    let _ = tx2.send(encode_surface(res));
                },
            );
        })
        .map_err(|e| e.to_string())?;

    shared::recv_capture(rx)
}

// Remaining targets (iOS, Android, …): no snapshot path wired up. iOS could
// reuse WKWebView.takeSnapshot but needs a UIKit (not AppKit) encode, so
// it's deliberately left to this stub. Degrades gracefully — the frontend
// treats the error as "no screenshot".
#[cfg(not(any(
    target_os = "macos",
    windows,
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
#[tauri::command]
pub async fn capture_webview(_window: tauri::WebviewWindow) -> Result<String, String> {
    Err("screenshots are not supported on this platform".to_string())
}
