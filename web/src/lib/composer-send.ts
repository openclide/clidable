/**
 * Pure composer-send predicates, kept out of the React/CodeMirror component so
 * they're unit-testable without a DOM.
 */

/**
 * Whether the composer has nothing to SEND — blank text (after trimming) AND no
 * attachments. Drives Enter's boundary fall-through: a composer with content
 * sends the message; an empty one forwards a bare Enter to the TUI. The
 * attachment check matters — a whitespace-only draft with a still-uploading file
 * must route through the normal send path (which blocks on the upload), NOT fire
 * a stray Enter into the terminal.
 */
export function composerHasNothingToSend(
  text: string,
  attachmentCount: number,
): boolean {
  return text.trim().length === 0 && attachmentCount === 0;
}
