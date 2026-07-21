/**
 * Shared CodeMirror 6 extensions for every editor surface (main editor +
 * diff panes). Ported from terax-ai with two adjustments:
 *
 *   1. Near-transparent background — Clidable's panes float over OS blur, not
 *      a solid app chrome, so the editor shows the glass behind it. Not *fully*
 *      transparent: the scroller keeps a scrim (see `.cm-scroller` below) so a
 *      light desktop behind the window can't wash the code out.
 *   2. Tokens come from globals.css (`--color-foreground`, etc.) instead
 *      of terax's `--foreground` shadcn vars.
 *   3. A dark syntax theme of our own — without one, `basicSetup` falls back to
 *      CodeMirror's light-page default (see `clidableHighlightStyle`).
 *
 * Compartments are kept exported so `EditorPane` can reconfigure the
 * language at runtime without rebuilding state — switching files would
 * otherwise blow away undo history and viewport.
 */
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { search } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const languageCompartment = new Compartment();
export const readOnlyCompartment = new Compartment();
export const wrapCompartment = new Compartment();

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * Syntax colours for Clidable's dark glass.
 *
 * Without this, `basicSetup` falls back to CodeMirror's default highlight
 * style, which is built for a white page — near-black navy keywords and dark
 * red strings. On a translucent dark pane those tokens are the *darkest* thing
 * on screen, and they get worse, not better, as a lighter desktop shows
 * through the blur.
 *
 * So every token here sits in the light half of the scale (L ≥ 0.62, most
 * ≥ 0.78) and carries its hue in chroma rather than darkness: contrast against
 * the pane never depends on what's behind the glass. Hues follow the app's own
 * accents — violet keywords, blue functions — with the conventional green /
 * amber / teal for strings, numbers and types so the code still reads like
 * code. Comments are the one deliberately quiet token, and they stay above the
 * dim-foreground token so they never fall out of legibility.
 */
const clidableHighlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "oklch(0.63 0.02 285)", fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: "oklch(0.78 0.15 300)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "oklch(0.84 0.13 150)" },
  { tag: [t.escape, t.character], color: "oklch(0.85 0.11 60)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.literal, t.self, t.constant(t.variableName)], color: "oklch(0.84 0.12 75)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "oklch(0.82 0.12 245)" },
  { tag: [t.typeName, t.className, t.namespace, t.annotation], color: "oklch(0.85 0.1 195)" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: "oklch(0.9 0.05 265)" },
  { tag: [t.variableName, t.propertyName, t.labelName], color: "oklch(0.9 0.02 285)" },
  { tag: [t.tagName, t.angleBracket], color: "oklch(0.8 0.13 20)" },
  { tag: [t.attributeName], color: "oklch(0.86 0.1 90)" },
  { tag: [t.attributeValue], color: "oklch(0.84 0.13 150)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator], color: "oklch(0.76 0.02 285)" },
  { tag: [t.meta, t.processingInstruction, t.documentMeta], color: "oklch(0.7 0.03 285)" },
  { tag: [t.heading], color: "oklch(0.82 0.16 295)", fontWeight: "600" },
  { tag: [t.link, t.url], color: "oklch(0.8 0.12 245)", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.inserted, t.contentSeparator], color: "oklch(0.82 0.14 150)" },
  { tag: t.deleted, color: "oklch(0.75 0.16 20)" },
  { tag: t.invalid, color: "oklch(0.72 0.2 25)", textDecoration: "underline wavy" },
]);

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
    syntaxHighlighting(clidableHighlightStyle),
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
        // Not fully transparent: the pane floats over OS blur, so a light
        // desktop behind it can wash the code out. This scrim is the floor on
        // contrast — still glassy, but the text never has to compete with
        // whatever happens to be on the screen behind the window.
        backgroundColor:
          "color-mix(in oklch, var(--color-background) 45%, transparent) !important",
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
      // Autocomplete rides on CodeMirror's built-in tooltip styles, which have
      // separate light/dark variants — `dark: true` below is what picks the
      // dark one. Only the selected-row accent is ours.
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor:
          "color-mix(in srgb, var(--color-accent) 30%, transparent)",
        color: "var(--color-foreground)",
      },
    },
    // Declares this a dark theme, so every default CodeMirror surface we don't
    // style by hand (autocomplete, matching-bracket, panel buttons) picks its
    // dark variant instead of the light one.
    { dark: true }),
  ];
}
