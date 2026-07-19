/**
 * Disk-backed scrollback — the durable mirror of a session's output.
 *
 * NOT currently wired into Session: agent-native resume (`claude --resume …`)
 * restores the agent's context and redraws its own screen, making raw scrollback
 * redundant for resumable agents. Kept as ready infrastructure for a future
 * dormant-preview (show a terminal's last screen before its resume completes,
 * or history for agents with no resume support).
 *
 * A rolling in-memory buffer (capped) is flushed to `<file>` on a debounce via
 * write-tmp-then-rename (atomic — a crash never leaves a half file). herdr does
 * the same (whole-buffer debounced atomic save); this is an independent Bun impl.
 */
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { projectDataDir } from "../paths";

const DEFAULT_CAP_BYTES = 2_000_000; // ~2 MB/terminal
const DEFAULT_DEBOUNCE_MS = 3000;

/** Absolute path of a terminal's scrollback file. */
export function scrollbackPath(projectUuid: string, terminalId: string): string {
  return join(projectDataDir(projectUuid), "terminals", `${terminalId}.scroll`);
}

/** Read a scrollback file's bytes for replay; empty if it doesn't exist. */
export async function readScrollback(path: string): Promise<Uint8Array> {
  const file = Bun.file(path);
  if (!(await file.exists())) return new Uint8Array(0);
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * A single terminal's rolling scrollback, buffered in memory and flushed to
 * disk on a debounce. Call `append` for each output chunk and `close` on exit.
 */
export class Scrollback {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly path: string,
    private readonly capBytes: number = DEFAULT_CAP_BYTES,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  /** Append an output chunk, trimming from the front past the cap. */
  append(chunk: Uint8Array): void {
    // Copy — callers may reuse the underlying allocation after we return.
    this.chunks.push(new Uint8Array(chunk));
    this.bytes += chunk.byteLength;
    while (this.bytes > this.capBytes && this.chunks.length > 1) {
      this.bytes -= this.chunks.shift()!.byteLength;
    }
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) return;
    const t = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
    // Never keep the process alive just to flush scrollback.
    (t as { unref?: () => void }).unref?.();
    this.timer = t;
  }

  /** The current buffer as one contiguous byte array. */
  private concat(): Uint8Array {
    const out = new Uint8Array(this.bytes);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }

  /** Write the current buffer to disk atomically (tmp + rename). No-op if
   *  nothing changed since the last flush. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const data = this.concat();
    const tmp = `${this.path}.tmp`;
    // Bun.write creates parent directories as needed.
    await Bun.write(tmp, data);
    await rename(tmp, this.path);
  }

  /** Cancel the pending timer and flush any remaining bytes. */
  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
