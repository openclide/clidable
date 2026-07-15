/**
 * Shared CodeMirror 6 extensions for every editor surface (main editor +
 * diff panes). Ported from terax-ai with two adjustments:
 *
 *   1. Transparent background — Clidable's panes float over OS blur, not a
 *      solid app chrome. The editor must show whatever glass is behind it.
 *   2. Tokens come from globals.css (`--color-foreground`, etc.) instead
 *      of terax's `--foreground` shadcn vars.
 *
 * Compartments are kept exported so `EditorPane` can reconfigure the
 * language at runtime without rebuilding state — switching files would
 * otherwise blow away undo history and viewport.
 */
import { indentUnit } from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { search } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const languageCompartment = new Compartment();
export const readOnlyCompartment = new Compartment();
export const wrapCompartment = new Compartment();

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * Everything `basicSetup` doesn't already cover. basicSetup gives us
 * line numbers, fold gutter, history, indentOnInput, bracketMatching,
 * closeBrackets, autocompletion, highlightActiveLine,
 * highlightSelectionMatches and the search keymap — adding any of
 * those here duplicates extensions and breaks them.
 */
export function buildSharedExtensions(): Extension[] {
  return [
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    search({ top: true }),
    lintGutter(),
    EditorView.theme({
      "&, &.cm-editor, &.cm-editor.cm-focused": {
        backgroundColor: "transparent !important",
        color: "var(--color-foreground)",
        outline: "none",
        padding: "8px 0",
      },
      ".cm-scroller": {
        fontFamily: MONO_FONT,
        fontSize: "12.5px",
        lineHeight: "1.6",
        backgroundColor: "transparent !important",
      },
      ".cm-content": {
        caretColor: "var(--color-foreground)",
        backgroundColor: "transparent !important",
        padding: "0 12px",
      },
      ".cm-gutters": {
        backgroundColor: "transparent !important",
        border: "none",
        color: "var(--color-foreground-dim)",
      },
      ".cm-gutter": { backgroundColor: "transparent !important" },
      ".cm-gutter-lint": { width: "0px" },
      ".cm-lineNumbers .cm-gutterElement": {
        opacity: "0.55",
        padding: "0 6px 0 8px",
        minWidth: "24px",
      },
      ".cm-foldGutter": { width: "10px" },
      ".cm-foldGutter .cm-gutterElement": {
        color: "var(--color-foreground-dim)",
        opacity: "0.5",
      },
      ".cm-activeLine": {
        borderTopRightRadius: "4px",
        borderBottomRightRadius: "4px",
        backgroundColor:
          "color-mix(in srgb, var(--color-foreground) 5%, transparent)",
      },
      ".cm-lineNumbers .cm-activeLineGutter": {
        borderTopLeftRadius: "4px",
        borderBottomLeftRadius: "4px",
        backgroundColor:
          "color-mix(in srgb, var(--color-foreground) 6%, transparent)",
        color: "var(--color-foreground)",
        userSelect: "none",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--color-foreground)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
        {
          backgroundColor:
            "color-mix(in srgb, var(--color-foreground) 18%, transparent) !important",
        },
      ".cm-panels": {
        backgroundColor:
          "color-mix(in oklch, var(--color-background) 80%, transparent)",
        color: "var(--color-foreground)",
        backdropFilter: "blur(16px)",
        borderColor: "var(--color-glass-edge)",
      },
      ".cm-panel.cm-search": {
        padding: "6px 8px",
      },
      ".cm-tooltip": {
        backgroundColor:
          "color-mix(in oklch, var(--color-background) 85%, transparent)",
        backdropFilter: "blur(16px)",
        border: "1px solid var(--color-glass-edge)",
        borderRadius: "8px",
        color: "var(--color-foreground)",
      },
    }),
  ];
}
