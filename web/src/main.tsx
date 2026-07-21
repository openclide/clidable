import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { backdropMode, detectShell } from "./lib/shell";

// Tag both <html> and <body> with the shell. No stylesheet reads this any more
// (the backdrop moved to `data-backdrop` below, which asks a different
// question) — it stays as a debugging marker, so "which shell is this?" is
// answerable from a screenshot of the inspector.
const shell = detectShell();
document.documentElement.dataset.shell = shell;
document.body.dataset.shell = shell;

// Whether the window is see-through (the OS paints behind it) or paints its own
// backdrop. NOT the same question as which shell we're in: the Linux desktop app
// is Tauri but must still paint, because no Linux blur API exists. See
// `backdropMode`.
document.documentElement.dataset.backdrop = backdropMode();

// A file dropped outside a drop target would otherwise NAVIGATE the page to
// that file, replacing the whole app (in the Tauri shell too — native drop
// interception is off so HTML5 drop reaches the composer). Real drop targets
// (the composer) handle the event during bubble before these fire.
//
// Guard ONLY file drags: an unconditional preventDefault also cancels the
// browser's default text-drop action, silently breaking dragging selected
// text into any native <input>/<textarea> (context modal, MCP/team forms, …).
const isFileDrag = (e: DragEvent) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
document.addEventListener("dragover", (e) => {
  if (isFileDrag(e)) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  if (isFileDrag(e)) e.preventDefault();
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
