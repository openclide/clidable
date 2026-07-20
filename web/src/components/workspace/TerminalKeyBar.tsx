import { terminalClient } from "../../lib/terminal-client";

/**
 * Touch key-bar — the special keys an on-screen keyboard hides (arrows, Tab,
 * Esc, Ctrl-C, Enter) for driving a shell TUI from a phone/tablet. Rendered as a
 * sibling ABOVE the composer box (not inside it). Mobile only (`md:hidden`):
 * desktop has real keys plus the composer's arrow/Esc-to-TUI routing. Writes raw
 * byte sequences straight to the session's PTY, so it works whether or not the
 * composer is focused. Scrolls horizontally if it overflows.
 */
export function TerminalKeyBar({ sessionId }: { sessionId: string }) {
  const send = (seq: string) => terminalClient.writeText(sessionId, seq);
  return (
    <div className="mb-1.5 -mx-1 flex items-center gap-1 overflow-x-auto px-1 md:hidden">
      <KeyCap label="←" seq={"\x1b[D"} onKey={send} />
      <KeyCap label="↑" seq={"\x1b[A"} onKey={send} />
      <KeyCap label="↓" seq={"\x1b[B"} onKey={send} />
      <KeyCap label="→" seq={"\x1b[C"} onKey={send} />
      <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-white/[0.1]" />
      <KeyCap label="Tab" seq={"\t"} onKey={send} />
      <KeyCap label="Esc" seq={"\x1b"} onKey={send} />
      <KeyCap label="^C" seq={"\x03"} onKey={send} tone="danger" />
      <KeyCap label="↵" seq={"\r"} onKey={send} />
    </div>
  );
}

/**
 * A single key on the touch key-bar. onPointerDown + preventDefault fires the tap
 * immediately AND stops the button from stealing focus, so a focused composer
 * keeps its caret and you can keep typing between key presses.
 */
function KeyCap({
  label,
  seq,
  onKey,
  tone,
}: {
  label: string;
  seq: string;
  onKey: (seq: string) => void;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      title={label}
      onPointerDown={(e) => {
        e.preventDefault();
        onKey(seq);
      }}
      className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium leading-none transition-colors ${
        tone === "danger"
          ? "border-rose-400/20 bg-rose-500/10 text-rose-200/80 hover:bg-rose-500/20"
          : "border-white/[0.1] bg-white/[0.05] text-foreground/65 hover:border-white/[0.2] hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
