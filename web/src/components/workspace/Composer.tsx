import { useEffect, useRef, useState } from "react";
import {
  drawSelection,
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { AGENTS, getAgent, type AgentId, type AgentInfo } from "../welcome/data";
import { AgentIcon } from "../icons/AgentIcon";
import { PositionedPortal } from "../ui/PositionedPortal";
import { terminalClient } from "../../lib/terminal-client";
import { registerComposerFocus } from "../../lib/composer-focus";
import {
  createCheckpoint,
  getCachedMostRecent,
  listCheckpoints,
  subscribeToCheckpointCreates,
} from "../../lib/checkpoints-client";
import { relativeTime } from "../../lib/checkpoints-format";
import { capturePreview } from "../../lib/screenshot";
import { ConfirmationChip } from "./checkpoints/ConfirmationChip";
import { RewindPopover } from "./checkpoints/RewindPopover";
import { ProjectBadge } from "./ProjectBadge";
import { uploadAttachment } from "../../lib/attachments-client";

// Delay between the bracketed-paste write and the submitting Enter, so the
// agent TUI commits the paste before the \r lands (see sendNow). One render
// tick is enough; this stays well below perceptible latency.
const SUBMIT_DELAY_MS = 30;

/** A file attached to the outgoing message. `path` is null while the upload
 *  is in flight (or after it failed — see `error`); `previewUrl` is a local
 *  object URL for image thumbnails. */
interface Attachment {
  id: number;
  name: string;
  path: string | null;
  previewUrl: string | null;
  /** Upload failed. The chip stays (path still null, so send stays blocked)
   *  in an error state until the user removes it — never silently dropped. */
  error?: boolean;
}

interface Props {
  agentId: AgentId;
  /** Session id (PTY) this composer's send writes to. */
  sessionId: string;
  /** Project root — needed to attribute the checkpoint snapshot to a project. */
  projectPath: string;
  /** Project name to surface at the top of the box. The parent passes it only
   *  when 2+ projects are open, so a single-project workspace stays clean. */
  projectName?: string;
  /** Color the project badge (only when its initial collides with another). */
  projectTinted?: boolean;
  /** Tightens the layout when there are multiple composers on screen. */
  compact?: boolean;
  /** Switch this terminal's agent (replaces the session). Omit to render the
   *  agent identity as a static, non-interactive chip. */
  onSelectAgent?: (agentId: AgentId) => void;
}

/**
 * CodeMirror 6 composer. Enter (or Mod-Enter) sends the current buffer to the
 * associated PTY session, wrapped in bracketed paste mode so the agent TUI
 * treats multi-line content as one paste rather than N submits. Pasted/dropped
 * files upload and ride along as absolute paths appended to the message.
 *
 * `@filename` autocomplete comes later (PLAN.md §1).
 */
export function Composer({
  agentId,
  sessionId,
  projectPath,
  projectName,
  projectTinted = false,
  compact = false,
  onSelectAgent,
}: Props) {
  const agent = getAgent(agentId);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // sessionId can change as the user switches active tab in a leaf. The
  // keymap captures references at construction time, so we read from a
  // ref to always reach the current session.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // Same trick for projectPath — when split-views move the active tab
  // across projects, the keymap-captured `sendNow` reads the current
  // value via ref instead of stale closure.
  const projectPathRef = useRef(projectPath);
  projectPathRef.current = projectPath;
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;
  const [isEmpty, setIsEmpty] = useState(true);

  // Attached files (pasted images, dropped files, paperclip picks). Uploaded
  // to the server immediately; on Send their absolute paths are appended to
  // the message so the agent can read them from disk. Read via ref inside
  // sendNow — the keymap captures the first-render closure.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const attachIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: Iterable<File>) => {
    for (const file of files) {
      const id = ++attachIdRef.current;
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null;
      setAttachments((prev) => [
        ...prev,
        { id, name: file.name || "pasted image", path: null, previewUrl },
      ]);
      uploadAttachment(file)
        .then((up) => {
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, path: up.path, name: up.name } : a)),
          );
        })
        .catch((err: Error) => {
          // Keep the chip in an error state (path stays null → send stays
          // blocked) so a message that references the file can't go out
          // without it. The user removes it and re-adds to retry.
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, error: true } : a)),
          );
          flashChip("error", `Attach failed: ${err.message}`);
        });
    }
  };
  // The CM6 paste handler is registered once at editor construction — reach
  // the current addFiles through a ref.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;

  function removeAttachment(id: number): void {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  function clearAttachments(): void {
    setAttachments((prev) => {
      for (const a of prev) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
      return [];
    });
  }

  // Revoke any thumbnail object URLs still alive when the composer unmounts
  // (pane/project closed with chips pending) — they'd otherwise leak for the
  // page lifetime.
  useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
  }, []);

  // One Composer instance is reused across a leaf's tabs (it reads the active
  // session via ref, never remounting). Attachments, though, belong to the tab
  // they were added on — so drop any pending chips when the session changes.
  // Otherwise a file staged in one tab would silently ride the next Send in
  // whatever tab/project is now active. Skips the initial mount (empty anyway).
  const prevSessionRef = useRef(sessionId);
  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      clearAttachments();
    }
    // clearAttachments only touches the stable setter; guarding on sessionId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Checkpoint feedback. A successful snapshot pulses the rewind button
  // (see `saved` below); the chip is reserved for *failures* — a rose
  // flash with the server's message, since a missed safety-net snapshot
  // is the case that actually needs surfacing.
  const [chipVisible, setChipVisible] = useState(false);
  const [chipLabel, setChipLabel] = useState("Checkpointed");
  const [chipTone, setChipTone] = useState<"success" | "error">("success");
  const chipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "Saved" pulse on the rewind button — set when a checkpoint lands for
  // this project, cleared after the pop animation finishes.
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);
  function flashChip(
    tone: "success" | "error",
    label: string,
    durationMs = tone === "success" ? 1500 : 3000,
  ): void {
    setChipTone(tone);
    setChipLabel(label);
    setChipVisible(true);
    if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
    chipTimerRef.current = setTimeout(
      () => setChipVisible(false),
      durationMs,
    );
  }

  // Rewind popover open/close anchor — the rewind icon button on the
  // composer footer.
  const rewindAnchorRef = useRef<HTMLButtonElement>(null);
  const [rewindOpen, setRewindOpen] = useState(false);

  // Most-recent checkpoint timestamp drives the composer chip label
  // ("Checkpoints · 2m ago"). We seed from the in-memory cache so a
  // composer that mounts after a previous Send shows the label
  // immediately; if no cache, we fetch once on mount. Subsequent
  // creates flow through the pub-sub.
  const [lastCheckpointAt, setLastCheckpointAt] = useState<number | null>(
    () => getCachedMostRecent(projectPath)?.createdAt ?? null,
  );
  useEffect(() => {
    let cancelled = false;
    // Refresh on project change. Skip if we already have a cached
    // recent for this project (covers cross-tile remounts).
    const cached = getCachedMostRecent(projectPath);
    if (cached) {
      setLastCheckpointAt(cached.createdAt);
      return;
    }
    listCheckpoints({ projectPath, limit: 1 })
      .then((rows) => {
        if (!cancelled) setLastCheckpointAt(rows[0]?.createdAt ?? null);
      })
      .catch(() => {
        // Silent — the chip just stays empty / shows "no checkpoints".
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);
  // Live updates for the relative time. `relativeTime` is pure, so we
  // re-render every 30s to bump "2m ago" → "3m ago" without an extra
  // server hop. Cheap because we only re-render the composer footer.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (lastCheckpointAt === null) return;
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [lastCheckpointAt]);
  // Subscribe to creates so the label updates the moment a Send fires
  // its checkpoint — including from this composer itself — and pulse the
  // rewind button as the "saved" confirmation. Filter to events for THIS
  // project so other tiles' sends don't bump us.
  useEffect(() => {
    return subscribeToCheckpointCreates((event) => {
      if (event.projectPath !== projectPathRef.current) return;
      setLastCheckpointAt((prev) =>
        prev === null || event.checkpoint.createdAt > prev
          ? event.checkpoint.createdAt
          : prev,
      );
      // Pulse the rewind button + swap its label to "Checkpointed" for a
      // beat. setState/ref are stable, so this closure is safe with the []
      // deps below.
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 1200);
    });
  }, []);

  function sendNow(): boolean {
    const view = viewRef.current;
    if (!view) return false;
    const typed = view.state.doc.toString().trimEnd();

    // Attachments: block send while any upload is still in flight (the send
    // button is disabled too — this guards the Enter key), then append the
    // uploaded paths so the agent can read the files from disk.
    const attached = attachmentsRef.current;
    if (attached.some((a) => a.path === null)) return false;
    const paths = attached.map((a) => a.path as string);
    if (typed.length === 0 && paths.length === 0) return false;
    const text =
      paths.length === 0
        ? typed
        : `${typed}${typed ? "\n\n" : ""}Attached files:\n${paths.join("\n")}`;

    // Snapshot first, then send. Failure to snapshot is logged + shown
    // as an error chip, but the user's keystroke still goes through —
    // the model the user signed up for is "the message I just typed
    // gets sent; checkpoints are a safety net, not a gate."
    //
    // Fire-and-forget; the PTY write below doesn't wait on it. We grab
    // the preview screenshot *before* the create so it reflects the
    // pre-message app state. `capturePreview` is desktop-only and
    // best-effort — null in browser mode or when preview isn't the
    // visible tab — and never throws.
    // On success the rewind button pulses (driven by the create pub-sub
    // subscription above), so there's nothing to do here but surface a
    // failure. The chip is the error channel only.
    void (async () => {
      const screenshot = (await capturePreview()) ?? undefined;
      return createCheckpoint({
        projectPath: projectPathRef.current,
        agentId: agentIdRef.current,
        terminalId: sessionIdRef.current,
        message: text,
        screenshot,
      });
    })().catch((err: Error) => {
      console.error("[composer] checkpoint failed", err);
      flashChip("error", err.message ?? "Checkpoint failed");
    });

    // Bracketed paste, then submit — sent as TWO writes. The paste wrapper
    // (\x1b[200~ … \x1b[201~) makes the TUI treat the whole buffer as one
    // paste so multi-line content keeps its newlines; the Enter (\r) submits.
    //
    // The Enter MUST go in a separate write a beat after the paste. If it's
    // glued to the paste-end in one chunk, Ink-based agent TUIs (Claude,
    // Codex) commit the pasted text on a later render tick and process the \r
    // against still-empty input — so it gets swallowed and the message sits
    // typed-but-unsubmitted (the intermittent bug). Capture the session id so
    // a tab switch during the gap can't redirect the Enter to another session.
    const sid = sessionIdRef.current;
    const enc = new TextEncoder();
    terminalClient.write(sid, enc.encode(`\x1b[200~${text}\x1b[201~`));
    setTimeout(() => terminalClient.write(sid, enc.encode("\r")), SUBMIT_DELAY_MS);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "" },
    });
    setIsEmpty(true);
    clearAttachments();
    return true;
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: "",
        extensions: [
          history(),
          // Draw our own caret/selection instead of relying on the native
          // `caret-color`. The native caret over the translucent composer
          // background fails to paint on the *first* focus (shows only on a
          // later click); the drawn `.cm-cursor` (themed below) renders
          // reliably the moment the view is focused.
          drawSelection(),
          keymap.of([
            // Enter sends; Shift-Enter inserts a newline. Enter always
            // consumes the key (returns true) so an empty composer never
            // leaves a stray blank line. Mod-Enter stays as a send alias.
            {
              key: "Enter",
              run: () => {
                sendNow();
                return true;
              },
              shift: insertNewlineAndIndent,
            },
            // Always consume Mod-Enter too. Returning sendNow()'s false (empty
            // buffer, or an upload in flight) would fall through to
            // defaultKeymap's Mod-Enter → insertBlankLine, splitting the
            // message with a stray blank line.
            {
              key: "Mod-Enter",
              run: () => {
                sendNow();
                return true;
              },
            },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.lineWrapping,
          markdown(),
          // Pasting or dropping files/images onto the editor attaches them
          // (text pastes/drops fall through to CM's default handling). The
          // drop handler stops propagation so the composer root's onDrop
          // doesn't attach the same files a second time.
          EditorView.domEventHandlers({
            paste: (event) => {
              const clip = event.clipboardData;
              const files = clip?.files;
              // Attach files ONLY when there's no text flavor. Rich apps (Excel,
              // Word, Numbers) put both a rendered image AND the real text on the
              // clipboard; preferring the image would silently drop the text the
              // user meant to paste. A pure screenshot/file paste carries no text
              // and still attaches.
              const hasText = !!clip && clip.getData("text/plain").length > 0;
              if (files && files.length > 0 && !hasText) {
                event.preventDefault();
                addFilesRef.current(files);
                return true;
              }
              return false;
            },
            drop: (event) => {
              const files = event.dataTransfer?.files;
              if (files && files.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                addFilesRef.current(files);
                return true;
              }
              return false;
            },
          }),
          cmPlaceholder(`Message ${agent.name}…  ↵ send · ⇧↵ newline`),
          EditorView.contentAttributes.of({ spellcheck: "false" }),
          EditorView.theme(
            {
              "&": {
                fontSize: "12.5px",
                fontFamily:
                  'ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", monospace',
                color: "var(--color-foreground)",
                background: "transparent",
              },
              ".cm-content": {
                padding: "0",
                lineHeight: "1.55",
                caretColor: agent.color,
                minHeight: compact ? "1.7em" : "3.4em",
              },
              ".cm-line": { padding: "0" },
              ".cm-scroller": {
                fontFamily: "inherit",
                maxHeight: "180px",
                overflowY: "auto",
              },
              "&.cm-focused": { outline: "none" },
              ".cm-placeholder": {
                color:
                  "color-mix(in oklch, var(--color-foreground) 30%, transparent)",
                fontStyle: "normal",
              },
              ".cm-cursor": {
                borderLeftColor: agent.color,
                borderLeftWidth: "1.5px",
              },
            },
            { dark: true },
          ),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              setIsEmpty(u.state.doc.length === 0);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once. `sendNow` reads sessionId via ref so we don't need to
    // re-construct the editor when sessionId/agent changes. Agent name/
    // color changes don't currently re-render the placeholder; if that
    // becomes a need we'll add a reconfigure step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Let a dock/roster selection move keyboard focus into this composer. The
  // editor is created in the effect above (declared first, so it runs first),
  // so viewRef is set by the time a pending request is honored here.
  useEffect(() => {
    return registerComposerFocus(sessionId, () => viewRef.current?.focus());
  }, [sessionId]);

  const uploading = attachments.some((a) => a.path === null);
  const canSend = (!isEmpty || attachments.length > 0) && !uploading;

  return (
    <div
      // Dropping files anywhere on the composer attaches them. (Tauri's
      // webview has dragDropEnabled:false so HTML5 drop fires there too.)
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }
      }}
      className="
        group relative flex flex-col gap-1.5
        rounded-2xl border border-white/[0.12] bg-white/[0.05]
        px-3.5 pt-3 pb-2
        transition-[border-color,box-shadow,background-color] duration-200
        focus-within:border-white/[0.2] focus-within:bg-white/[0.07]
        focus-within:shadow-[0_0_0_4px_rgba(255,255,255,0.04)]
      "
      style={{ "--agent": agent.color } as React.CSSProperties}
    >
      {/* Checkpoint failure chip — slides up above the composer only when
          a snapshot fails (success pulses the rewind button instead).
          Mounted at the top edge so the anchor stays stable as the editor
          grows/shrinks. */}
      <ConfirmationChip visible={chipVisible} label={chipLabel} tone={chipTone} />

      {/* Agent stripe on the left edge */}
      <span
        aria-hidden
        className="
          absolute inset-y-2.5 left-0 w-[2px] rounded-full
          bg-[color:var(--agent)]/60
          transition-[background-color,inset-block,box-shadow] duration-200
          group-focus-within:bg-[color:var(--agent)]
          group-focus-within:inset-y-1.5
          group-focus-within:shadow-[0_0_8px_var(--agent)]
        "
      />

      {/* Which project this composer targets — shown only when 2+ projects are
          open (the parent gates on projectName), so split terminals across
          projects are unambiguous. Kept to a thin caption so it doesn't eat
          the writing area in compact split panes. */}
      {projectName && (
        <div className="flex max-w-full items-center gap-1 self-start rounded-md bg-white/[0.04] py-0.5 pl-1 pr-1.5 text-[10px] text-foreground/55">
          <ProjectBadge name={projectName} size={13} tinted={projectTinted} />
          <span className="min-w-0 truncate font-medium">{projectName}</span>
        </div>
      )}

      {/* Attached files — removable chips above the editor (the footer row
          below is already crowded); paths are appended on Send. */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
          ))}
        </div>
      )}

      <div ref={containerRef} />

      <div className="flex items-center gap-2 text-[10.5px] text-foreground/35">
        {/* Agent identity — a selector when the parent allows switching. */}
        <AgentSelector agent={agent} onSelect={onSelectAgent} />

        {/* Hairline divider */}
        <span aria-hidden className="h-3 w-px shrink-0 bg-white/[0.1]" />

        {/* Checkpoints chip — opens RewindPopover. Shows the most
            recent checkpoint's relative time so the user has ambient
            awareness of "yes this is being snapshotted, here's when
            the last one was." */}
        <div className="relative shrink-0">
          <button
            ref={rewindAnchorRef}
            type="button"
            onClick={() => setRewindOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={rewindOpen}
            title="Recent checkpoints"
            className={`
              flex items-center gap-1.5 rounded-md
              px-1.5 py-0.5
              transition-[background-color,color,box-shadow] duration-200
              ${saved ? "animate-[checkpoint-pop_650ms_cubic-bezier(0.2,0.7,0.2,1)]" : ""}
              ${
                saved
                  ? "bg-emerald-400/15 text-emerald-200/90 shadow-[0_0_12px_-2px_rgba(52,211,153,0.55)]"
                  : rewindOpen
                    ? "bg-white/[0.1] text-foreground/85"
                    : "bg-white/[0.04] text-foreground/55 hover:bg-white/[0.08] hover:text-foreground/85"
              }
            `}
          >
            {saved ? <CheckGlyph /> : <ClockGlyph />}
            <span className="tabular-nums">
              {saved
                ? "Checkpointed"
                : lastCheckpointAt !== null
                  ? relativeTime(lastCheckpointAt)
                  : "no checkpoints yet"}
            </span>
          </button>
          <RewindPopover
            anchorRef={rewindAnchorRef}
            open={rewindOpen}
            onClose={() => setRewindOpen(false)}
            terminalId={sessionIdRef.current}
            projectPath={projectPathRef.current}
          />
        </div>

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {/* Hidden picker backing the paperclip. Value reset on click so
              picking the same file twice in a row still fires onChange. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Attach file"
            title="Attach file"
            onClick={() => fileInputRef.current?.click()}
            className="
              flex size-6 items-center justify-center rounded-md
              text-foreground/40 hover:bg-white/[0.06] hover:text-foreground/80
              transition-colors
            "
          >
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a4.5 4.5 0 01-1.32 3.18l-7.78 7.78a6 6 0 01-8.49-8.49l8.49-8.48a3 3 0 014.24 4.24l-7.78 7.78a1.5 1.5 0 01-2.12-2.12l7.78-7.78" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Send (↵)"
            title="Send (↵)"
            onClick={() => sendNow()}
            disabled={!canSend}
            className="
              flex size-7 items-center justify-center rounded-full
              border border-white/[0.08] bg-[color:var(--agent)]/15 text-foreground/85
              transition-[background-color,transform,box-shadow,border-color] duration-150
              hover:bg-[color:var(--agent)]/35 hover:text-foreground
              hover:shadow-[0_0_12px_-2px_var(--agent)]
              active:scale-95
              disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[color:var(--agent)]/15
              disabled:hover:shadow-none
            "
          >
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * Agent identity chip. When `onSelect` is provided it becomes a dropdown that
 * switches this terminal's agent (the parent re-spawns the session for the new
 * agent); otherwise it renders as a static, non-interactive chip. The menu
 * opens upward via PositionedPortal since the composer sits at the pane's
 * bottom edge.
 */
function AgentSelector({
  agent,
  onSelect,
}: {
  agent: AgentInfo;
  onSelect?: (agentId: AgentId) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const interactive = !!onSelect;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={!interactive}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup={interactive ? "menu" : undefined}
        aria-expanded={interactive ? open : undefined}
        title={
          interactive
            ? `Composing for ${agent.name} — click to switch agent`
            : `Composing for ${agent.name}`
        }
        className={`
          flex shrink-0 items-center gap-1.5 rounded-md
          bg-white/[0.04] px-1.5 py-0.5
          transition-colors duration-150
          ${
            interactive
              ? "hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              : "cursor-default"
          }
        `}
      >
        <AgentIcon id={agent.id} size={11} className="opacity-90" />
        <span className="font-medium" style={{ color: agent.color }}>
          {agent.name}
        </span>
      </button>

      {interactive && (
        <PositionedPortal
          anchorRef={anchorRef}
          open={open}
          onClose={() => setOpen(false)}
          width={180}
          placement="top"
          align="left"
          role="menu"
          className="glass flex max-h-[260px] flex-col gap-0.5 overflow-auto rounded-xl p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.4)]"
        >
          {AGENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitemradio"
              aria-checked={a.id === agent.id}
              onClick={() => {
                onSelect?.(a.id);
                setOpen(false);
              }}
              className="
                flex w-full items-center gap-2 rounded-lg
                px-2 py-1.5 text-left
                transition-[background-color] duration-150
                hover:bg-white/[0.06]
                focus:outline-none focus-visible:bg-white/[0.06]
              "
            >
              <AgentIcon id={a.id} size={13} className="shrink-0 opacity-90" />
              <span
                className="min-w-0 flex-1 truncate text-[12px]"
                style={{ color: a.color }}
              >
                {a.name}
              </span>
              {a.id === agent.id && (
                <span className="shrink-0 text-foreground/70">
                  <CheckGlyph />
                </span>
              )}
            </button>
          ))}
        </PositionedPortal>
      )}
    </>
  );
}

/** One attached file: image thumbnail (or file glyph) + name + remove ×.
 *  A spinner shows while uploading; a failed upload turns the chip rose with
 *  an alert glyph (and blocks Send) until it's removed. */
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const uploading = attachment.path === null && !attachment.error;
  return (
    <span
      title={
        attachment.error
          ? "Upload failed — remove and try again"
          : (attachment.path ?? "Uploading…")
      }
      className={`
        flex max-w-[180px] items-center gap-1.5 rounded-md
        py-0.5 pl-1 pr-0.5 text-[10.5px]
        ${attachment.error ? "bg-rose-500/10 text-rose-200/80" : "bg-white/[0.04] text-foreground/65"}
      `}
    >
      {attachment.error ? (
        <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-rose-300/80">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      ) : uploading ? (
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-white/35 border-t-transparent" />
      ) : attachment.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt=""
          className="size-3.5 shrink-0 rounded-[3px] object-cover"
        />
      ) : (
        <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/45">
          <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      )}
      <span className="min-w-0 truncate">{attachment.name}</span>
      <button
        type="button"
        aria-label={`Remove ${attachment.name}`}
        onClick={onRemove}
        className="
          flex size-4 shrink-0 items-center justify-center rounded
          text-foreground/35 transition-colors
          hover:bg-white/[0.08] hover:text-foreground/80
        "
      >
        <svg viewBox="0 0 24 24" width={8} height={8} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      </button>
    </span>
  );
}

function ClockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={10}
      height={10}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={10}
      height={10}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
