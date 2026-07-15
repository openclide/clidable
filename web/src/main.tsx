import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { detectShell } from "./lib/shell";

// Tag both <html> and <body> so CSS can target Tauri vs browser shell.
// The root-level background lives on <html> (so it always paints the full
// document — putting it on <body> leaves a "gray strip" wherever body's
// height-100% is shorter than the actual scrolling document).
const shell = detectShell();
document.documentElement.dataset.shell = shell;
document.body.dataset.shell = shell;

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
