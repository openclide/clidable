import { describe, expect, it } from "bun:test";
import { composerHasNothingToSend } from "./composer-send";

describe("composerHasNothingToSend", () => {
  it("empty text, no attachments → nothing to send (forward Enter to TUI)", () => {
    expect(composerHasNothingToSend("", 0)).toBe(true);
  });

  it("whitespace-only text, no attachments → nothing to send", () => {
    expect(composerHasNothingToSend("   \n\t ", 0)).toBe(true);
  });

  it("real text → something to send", () => {
    expect(composerHasNothingToSend("echo hi", 0)).toBe(false);
  });

  it("blank text but an attachment present → send path (not a stray Enter)", () => {
    // Guards the regression: an uploading file with an empty caption must go
    // through sendNow (which blocks on the upload), never forward a bare \r.
    expect(composerHasNothingToSend("", 1)).toBe(false);
  });

  it("whitespace text + attachments → send path", () => {
    expect(composerHasNothingToSend("  ", 2)).toBe(false);
  });
});
