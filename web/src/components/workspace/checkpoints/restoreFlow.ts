/**
 * Confirm + restore helper used by both the composer popover and the
 * Changes-panel "Since" picker. Keeps the user-facing copy in one
 * place — both surfaces fire `window.confirm` with the same message
 * and the same dirty-buffer warning.
 *
 * v1 uses the native confirm dialog. A custom modal could land later;
 * the shape of this helper doesn't change.
 */
import type { Checkpoint } from "@shared/types";
import { restoreCheckpoint } from "../../../lib/checkpoints-client";
import { previewMessage, relativeTime } from "../../../lib/checkpoints-format";

export type RestoreResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string };

export async function confirmAndRestore(
  checkpoint: Checkpoint,
  projectPath: string,
): Promise<RestoreResult> {
  const target = checkpoint.isInitial
    ? "the initial state"
    : `"${previewMessage(checkpoint.message, 50)}" (${relativeTime(checkpoint.createdAt)})`;
  const proceed = window.confirm(
    [
      `Restore working tree to ${target}?`,
      "",
      "This overwrites every file in the project to match the snapshot.",
      "Any unsaved editor changes will be lost.",
      "Work done after this checkpoint will become unreachable.",
    ].join("\n"),
  );
  if (!proceed) return { ok: false, cancelled: true };

  try {
    await restoreCheckpoint({
      projectPath,
      checkpointId: checkpoint.id,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? "Restore failed",
    };
  }
}

/**
 * confirmAndRestore + the shared success/error UX: on success call
 * `onDone` (the surfaces use it to close their popover); on failure
 * surface the message; on cancel do nothing. Both the composer popover
 * and the Since picker route their row's restore action through this.
 */
export async function confirmRestoreWithFeedback(
  checkpoint: Checkpoint,
  projectPath: string,
  onDone: () => void,
): Promise<void> {
  const result = await confirmAndRestore(checkpoint, projectPath);
  if (result.ok) {
    onDone();
  } else if ("error" in result && result.error) {
    window.alert(`Restore failed: ${result.error}`);
  }
}
