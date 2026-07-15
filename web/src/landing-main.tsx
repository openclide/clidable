import React from "react";
import ReactDOM from "react-dom/client";
import { Landing } from "./landing/Landing";

// The landing page is dark-only and always renders in the "browser" shell
// (set on <html> in landing.html) so it gets globals.css's animated mesh
// background for free — no shell detection needed here.
const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Landing />
  </React.StrictMode>,
);
