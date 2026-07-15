/**
 * Desktop-only preview-pane capture for checkpoint screenshots.
 *
 * In the Tauri shell we can take an OS-level screenshot of the preview
 * pane (see src-tauri/src/capture.rs for why that sidesteps the
 * cross-origin canvas restriction). In plain-browser / PWA mode there's
 * no equivalent, so every entry point here no-ops to `null` and the
 * checkpoint simply has no screenshot.
 *
 * The preview pane tags itself with `data-screenshot-target` (only when
 * it's actually visible — see SidePane), so capture is a DOM lookup +
 * rect measurement away. Anything that goes wrong (not desktop, pane
 * not visible, capture permission denied) resolves to `null`; callers
 * treat the screenshot as best-effort and never block on it.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

export const SCREENSHOT_TARGET_ATTR = "data-screenshot-target";

/** True only inside the Tauri desktop shell. */
export function isDesktop(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Capture the current preview pane as a base64 PNG (no `data:` prefix),
 * or `null` when capture isn't possible. Never throws.
 *
 * The Rust side snapshots the whole webview viewport (permission-free
 * WKWebView.takeSnapshot); we crop to the preview pane here, where the
 * coordinate mapping is unambiguous: the snapshot covers the CSS
 * viewport, so `snapshotImagePx / window.innerWidth` is the scale from
 * `getBoundingClientRect()` CSS px to image px. Cropping in a canvas is
 * safe — the source is our own same-origin data URL, not a tainted
 * cross-origin frame.
 */
export async function capturePreview(): Promise<string | null> {
  if (!isDesktop()) return null;

  const el = document.querySelector<HTMLElement>(
    `[${SCREENSHOT_TARGET_ATTR}]`,
  );
  if (!el) return null;

  const r = el.getBoundingClientRect();
  // Skip when the pane isn't laid out / is collapsed (preview hidden or
  // mid-transition) — capturing a zero-size region is pointless.
  if (r.width < 4 || r.height < 4) return null;

  let fullPng: string;
  try {
    fullPng = await invoke<string>("capture_webview");
  } catch (e) {
    console.warn("[screenshot] webview snapshot failed:", e);
    return null;
  }
  if (!fullPng) return null;

  try {
    const cropped = await cropToBase64(fullPng, r);
    return cropped || null;
  } catch (e) {
    console.warn("[screenshot] crop failed:", e);
    return null;
  }
}

/** Crop a full-viewport PNG (base64) to `rect` (CSS px), return base64 PNG. */
async function cropToBase64(
  pngBase64: string,
  rect: DOMRect,
): Promise<string> {
  const img = await loadImage(`data:image/png;base64,${pngBase64}`);
  // The snapshot spans the CSS viewport at device scale; derive the
  // CSS-px → image-px factor from the actual decoded dimensions rather
  // than assuming devicePixelRatio (more robust across HiDPI quirks).
  const scaleX = img.naturalWidth / window.innerWidth;
  const scaleY = img.naturalHeight / window.innerHeight;

  const sx = Math.max(0, Math.round(rect.left * scaleX));
  const sy = Math.max(0, Math.round(rect.top * scaleY));
  const sw = Math.max(1, Math.round(rect.width * scaleX));
  const sh = Math.max(1, Math.round(rect.height * scaleY));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas context");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  // data URL → strip the "data:image/png;base64," prefix.
  const dataUrl = canvas.toDataURL("image/png");
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? "" : dataUrl.slice(comma + 1);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("snapshot image failed to load"));
    img.src = src;
  });
}
