/**
 * Client for the composer attachment upload (POST /api/attachments).
 *
 * Uploads raw file bytes and returns the absolute server-side path — the
 * string the composer appends to the outgoing message so the agent can read
 * the file from disk. Works identically whether the server is local (Tauri /
 * localhost) or remote: the file always lands where the agent runs.
 */
import { jsonOrThrow } from "./http";
import { MAX_ATTACHMENT_BYTES, type AttachmentUploadResponse } from "@shared/types";

export interface UploadedAttachment {
  /** Absolute path on the server machine. */
  path: string;
  /** Sanitized display name. */
  name: string;
}

export async function uploadAttachment(file: File): Promise<UploadedAttachment> {
  // Reject oversize here so we never spend the whole upload just to get a 413,
  // and so the user sees a clear message: a body over Bun.serve's own request
  // limit never reaches the route, which would otherwise surface as a cryptic
  // JSON-parse / network error instead of "too big".
  if (file.size > MAX_ATTACHMENT_BYTES) {
    const mb = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024));
    throw new Error(`file is larger than the ${mb} MB attachment limit`);
  }
  const res = await fetch(
    `/api/attachments?name=${encodeURIComponent(file.name || "pasted")}`,
    { method: "POST", body: file },
  );
  const body = await jsonOrThrow<AttachmentUploadResponse>(res, "attachment upload failed");
  return { path: body.path, name: body.name };
}
