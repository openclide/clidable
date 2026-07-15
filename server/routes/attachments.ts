/**
 * Composer attachment upload.
 *
 *   POST /api/attachments?name=<filename>    body = raw file bytes
 *
 * Saves the file under <dataDir>/attachments/ with a unique prefix and
 * returns its absolute path. The composer appends that path to the message
 * text, so the agent (running on this machine) can read the file directly —
 * which is why the file must land server-side, not stay in the browser.
 *
 * No project scoping: the path is referenced from exactly one message; a
 * flat dir keeps it trivial. Retention/pruning can join checkpoints' M6
 * sweep later.
 */
import { join } from "node:path";
import { paths } from "../paths";
import { jsonError } from "../http";
import {
  MAX_ATTACHMENT_BYTES,
  type AttachmentUploadResponse,
} from "../../shared/types";

/** Strip path separators, whitespace (agents often treat whitespace as a
 *  path boundary) and control chars, and cap length, keeping the extension
 *  readable. Never returns an empty string. */
function sanitizeName(raw: string): string {
  const cleaned = raw
    .replace(/[/\\:*?"<>|\s\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "_"); // no dotfiles / traversal-looking names
  const capped = cleaned.length > 80 ? cleaned.slice(-80) : cleaned;
  return capped.length > 0 ? capped : "file";
}

export async function attachmentUploadHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const name = sanitizeName(url.searchParams.get("name") ?? "");

  // Require a declared size and reject oversize BEFORE buffering the body:
  // arrayBuffer() would otherwise hold the whole upload in memory, and without
  // a Content-Length (chunked) the only bound would be Bun.serve's 128 MiB
  // default, not our 25 MiB cap. A browser fetch of a File always sets it.
  const header = req.headers.get("content-length");
  const declared = header === null ? NaN : Number(header);
  if (!Number.isFinite(declared)) {
    return jsonError(411, "content-length required");
  }
  if (declared > MAX_ATTACHMENT_BYTES) {
    return jsonError(413, `attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await req.arrayBuffer();
  } catch (err) {
    return jsonError(400, `unreadable body: ${(err as Error).message}`);
  }
  if (bytes.byteLength === 0) return jsonError(400, "empty attachment");
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return jsonError(413, `attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
  }

  // Unique prefix so same-named uploads never collide; keep the original
  // name visible so the path is self-describing in the agent transcript.
  const unique = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const abs = join(paths.attachments, `${unique}-${name}`);

  try {
    await Bun.write(abs, bytes);
  } catch (err) {
    return jsonError(500, `write failed: ${(err as Error).message}`, "[attachments]");
  }

  return Response.json({ ok: true, path: abs, name } satisfies AttachmentUploadResponse);
}
