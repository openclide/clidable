/**
 * Static docs-site generator.
 *
 *   bun run docs:build          # render docs/*.md → docs-site/
 *   bun run docs:serve          # build, then preview at http://127.0.0.1:8788
 *
 * Hand-rolled on purpose (no VitePress/Docusaurus): one Bun script, one npm
 * dep (`marked`), output is plain static HTML deployable anywhere (GitHub
 * Pages, Cloudflare Pages, an nginx folder). Design language mirrors the app:
 * dark, glassy, purple→blue accent.
 *
 * Internal `*.md` links are rewritten to `*.html` and validated — a link to a
 * missing page or anchor fails the build loudly rather than shipping a 404.
 */
import { Marked, type RendererObject, type Tokens } from "marked";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DOCS = join(ROOT, "docs");
const OUT = join(ROOT, "docs-site");

/** Sidebar structure. Order = reading order = prev/next order. */
const NAV: { section: string; pages: { file: string; label: string }[] }[] = [
  {
    section: "Start here",
    pages: [
      { file: "README.md", label: "Overview" },
      { file: "getting-started.md", label: "Getting Started" },
    ],
  },
  {
    section: "Running it",
    pages: [
      { file: "running-clidable.md", label: "Running Clidable" },
      { file: "remote-vps.md", label: "Remote & VPS Setup" },
    ],
  },
  {
    section: "Using it",
    pages: [
      { file: "workspace-guide.md", label: "Workspace Guide" },
      { file: "checkpoints.md", label: "Checkpoints" },
      { file: "agent-toolkit.md", label: "Skills, MCP & AI Team" },
    ],
  },
  {
    section: "Reference",
    pages: [
      { file: "cli-reference.md", label: "CLI Reference" },
      { file: "configuration.md", label: "Configuration" },
      { file: "troubleshooting.md", label: "Troubleshooting & FAQ" },
    ],
  },
];

const PAGES = NAV.flatMap((s) => s.pages);

function outName(mdFile: string): string {
  return mdFile === "README.md" ? "index.html" : mdFile.replace(/\.md$/, ".html");
}

/** GitHub-compatible heading slugs ("Security model — read this first" →
 *  "security-model--read-this-first"), deduped per page. */
function slugify(text: string, seen: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Undo marked's entity escaping — parseInline output is HTML-escaped, but the
 *  title/aria-label/TOC/slug sinks need raw text (each escapes once itself). */
function unescapeHtml(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

interface RenderedPage {
  file: string;
  label: string;
  title: string;
  body: string;
  /** h2 headings for the "On this page" rail. */
  toc: { id: string; text: string }[];
  /** Every heading id on the page, for cross-page anchor validation. */
  ids: Set<string>;
  /** Internal links found on this page: { target html file, hash } */
  links: { from: string; href: string; file: string; hash: string }[];
}

/** Rewrite a markdown href to its html equivalent. Returns null for
 *  external / same-page / non-doc links (left untouched). */
function rewriteInternal(href: string): { file: string; hash: string } | null {
  if (/^(https?:|mailto:|#)/.test(href)) return null;
  const m = href.match(/^\.?\/?([\w-]+\.md)(#.*)?$/);
  if (!m) return null;
  return { file: outName(m[1]!), hash: m[2] ?? "" };
}

function renderMarkdown(mdFile: string, label: string, md: string): RenderedPage {
  const seen = new Map<string, number>();
  const toc: { id: string; text: string }[] = [];
  const ids = new Set<string>();
  const links: RenderedPage["links"] = [];
  let title = label;
  let sawH1 = false;

  const renderer: RendererObject = {
    heading({ tokens, depth }: Tokens.Heading) {
      const html = this.parser!.parseInline(tokens);
      const plain = unescapeHtml(html.replace(/<[^>]+>/g, ""));
      if (depth === 1 && !sawH1) {
        sawH1 = true;
        title = plain;
      }
      const id = slugify(plain, seen);
      ids.add(id);
      if (depth === 2) toc.push({ id, text: plain });
      return `<h${depth} id="${id}">${html}<a class="anchor" href="#${id}" aria-label="Link to ${escapeHtml(plain)}">#</a></h${depth}>\n`;
    },
    link({ href, title: t, tokens }: Tokens.Link) {
      const text = this.parser!.parseInline(tokens);
      const internal = rewriteInternal(href);
      const finalHref = internal ? `./${internal.file}${internal.hash}` : href;
      if (internal) links.push({ from: mdFile, href, file: internal.file, hash: internal.hash });
      const external = /^https?:/.test(href);
      return (
        `<a href="${escapeHtml(finalHref)}"` +
        (external ? ` target="_blank" rel="noreferrer"` : "") +
        (t ? ` title="${escapeHtml(t)}"` : "") +
        `>${text}</a>`
      );
    },
    blockquote({ tokens, raw }: Tokens.Blockquote) {
      const body = this.parser!.parse(tokens);
      const warn = raw.includes("⚠️");
      return `<blockquote${warn ? ` class="warn"` : ""}>${body}</blockquote>\n`;
    },
  };

  const marked = new Marked({ gfm: true });
  marked.use({ renderer });
  const body = marked.parse(md, { async: false });
  return { file: outName(mdFile), label, title, body, toc, ids, links };
}

function sidebarHtml(activeFile: string): string {
  return NAV.map(
    (s) =>
      `<div class="nav-section"><div class="nav-section-title">${escapeHtml(s.section)}</div>` +
      s.pages
        .map((p) => {
          const f = outName(p.file);
          const active = f === activeFile ? ` class="active" aria-current="page"` : "";
          return `<a href="./${f}"${active}>${escapeHtml(p.label)}</a>`;
        })
        .join("") +
      `</div>`,
  ).join("\n");
}

function pageHtml(page: RenderedPage, index: number, all: RenderedPage[]): string {
  const prev = all[index - 1];
  const next = all[index + 1];
  const tocHtml = page.toc.length
    ? `<nav class="toc" aria-label="On this page"><div class="toc-title">On this page</div>${page.toc
        .map((h) => `<a href="#${h.id}">${escapeHtml(h.text)}</a>`)
        .join("")}</nav>`
    : "";
  const pager =
    `<nav class="pager">` +
    (prev ? `<a class="pager-prev" href="./${prev.file}"><span>← Previous</span><strong>${escapeHtml(prev.label)}</strong></a>` : `<span></span>`) +
    (next ? `<a class="pager-next" href="./${next.file}"><span>Next →</span><strong>${escapeHtml(next.label)}</strong></a>` : `<span></span>`) +
    `</nav>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="description" content="Clidable documentation — GUI for CLI coding agents." />
<title>${escapeHtml(page.title)} · Clidable Docs</title>
<link rel="icon" type="image/png" href="./logo.png" />
<link rel="stylesheet" href="./docs.css" />
</head>
<body>
<header class="top">
  <a class="brand" href="./index.html"><img src="./logo.png" alt="" width="22" height="22" /><span>Clidable</span><span class="brand-docs">Docs</span></a>
  <a class="gh" href="https://github.com/openclide/clidable" target="_blank" rel="noreferrer">GitHub ↗</a>
</header>
<div class="shell">
  <aside class="side">
    <details class="side-toggle"><summary>Menu — ${escapeHtml(page.label)}</summary>
      <nav class="nav" aria-label="Documentation">${sidebarHtml(page.file)}</nav>
    </details>
    <nav class="nav nav-static" aria-label="Documentation">${sidebarHtml(page.file)}</nav>
  </aside>
  <main class="content">
    <article>${page.body}</article>
    ${pager}
    <footer class="foot">Clidable — GUI for CLI coding agents.</footer>
  </main>
  ${tocHtml}
</div>
<script>
for (const pre of document.querySelectorAll("pre")) {
  const btn = document.createElement("button");
  btn.className = "copy"; btn.type = "button"; btn.textContent = "Copy";
  btn.addEventListener("click", async () => {
    const code = pre.querySelector("code");
    await navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy"), 1200);
  });
  pre.appendChild(btn);
}
</script>
</body>
</html>
`;
}

const CSS = `
:root {
  --bg: #0b0b0f;
  --panel: rgba(255, 255, 255, 0.035);
  --border: rgba(255, 255, 255, 0.09);
  --text: rgba(235, 236, 244, 0.92);
  --muted: rgba(235, 236, 244, 0.55);
  --accent: #8b7cf7;
  --accent-2: #4f9cf9;
  --code-bg: rgba(255, 255, 255, 0.055);
  --warn: #f5b455;
  --top-h: 52px;
}
* { box-sizing: border-box; }
html { scroll-padding-top: calc(var(--top-h) + 16px); }
body {
  margin: 0;
  background:
    radial-gradient(60rem 40rem at 85% -10%, rgba(99, 91, 255, 0.13), transparent 60%),
    radial-gradient(50rem 35rem at -10% 110%, rgba(59, 130, 246, 0.10), transparent 60%),
    var(--bg);
  color: var(--text);
  font: 15px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent-2); text-decoration: none; }
a:hover { text-decoration: underline; }

.top {
  position: sticky; top: 0; z-index: 10; height: var(--top-h);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px;
  background: rgba(11, 11, 15, 0.72);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 9px; color: var(--text); font-weight: 600; letter-spacing: 0.01em; }
.brand:hover { text-decoration: none; }
.brand img { border-radius: 6px; }
.brand-docs {
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em;
  padding: 2px 8px; border-radius: 999px;
  background: linear-gradient(90deg, rgba(139, 124, 247, 0.22), rgba(79, 156, 249, 0.22));
  border: 1px solid rgba(139, 124, 247, 0.35);
  color: rgba(235, 236, 244, 0.85);
}
.gh { font-size: 13px; color: var(--muted); }
.gh:hover { color: var(--text); text-decoration: none; }

.shell {
  display: grid; grid-template-columns: 230px minmax(0, 1fr) 200px;
  gap: 36px; max-width: 1240px; margin: 0 auto; padding: 28px 20px 80px;
}
.side { position: sticky; top: calc(var(--top-h) + 24px); align-self: start; }
.side-toggle { display: none; }
.nav-section { margin-bottom: 18px; }
.nav-section-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;
  color: var(--muted); margin-bottom: 6px;
}
.nav a {
  display: block; padding: 5px 10px; margin: 1px 0; border-radius: 8px;
  color: var(--muted); font-size: 13.5px; border: 1px solid transparent;
}
.nav a:hover { color: var(--text); background: var(--panel); text-decoration: none; }
.nav a.active {
  color: var(--text);
  background: linear-gradient(90deg, rgba(139, 124, 247, 0.14), rgba(79, 156, 249, 0.10));
  border-color: rgba(139, 124, 247, 0.30);
}

.toc { position: sticky; top: calc(var(--top-h) + 24px); align-self: start; font-size: 12.5px; }
.toc-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 6px; }
.toc a { display: block; padding: 3px 0 3px 10px; color: var(--muted); border-left: 1px solid var(--border); }
.toc a:hover { color: var(--text); border-left-color: var(--accent); text-decoration: none; }

.content { min-width: 0; }
article h1 {
  font-size: 30px; line-height: 1.25; margin: 4px 0 14px; letter-spacing: -0.015em;
  background: linear-gradient(92deg, #fff 30%, rgba(189, 178, 255, 0.9));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
article h2 { font-size: 21px; margin: 38px 0 10px; padding-top: 10px; border-top: 1px solid var(--border); letter-spacing: -0.01em; }
article h3 { font-size: 16.5px; margin: 26px 0 8px; }
article h1 .anchor, article h2 .anchor, article h3 .anchor, article h4 .anchor {
  margin-left: 8px; opacity: 0; font-weight: 400; color: var(--accent);
}
article h1:hover .anchor, article h2:hover .anchor, article h3:hover .anchor, article h4:hover .anchor { opacity: 1; text-decoration: none; }
article p { margin: 10px 0; }
article ul, article ol { padding-left: 24px; }
article li { margin: 4px 0; }
article hr { border: 0; border-top: 1px solid var(--border); margin: 30px 0; }
article img { max-width: 100%; }

article code {
  font: 12.8px/1.6 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  background: var(--code-bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 1.5px 5px;
}
article pre {
  position: relative; overflow-x: auto;
  background: rgba(0, 0, 0, 0.38); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px 16px; margin: 14px 0;
}
article pre code { background: none; border: 0; padding: 0; font-size: 13px; color: rgba(222, 226, 240, 0.92); }
pre .copy {
  position: absolute; top: 8px; right: 8px;
  font: 11px system-ui, sans-serif; color: var(--muted);
  background: rgba(255, 255, 255, 0.06); border: 1px solid var(--border);
  border-radius: 7px; padding: 3px 9px; cursor: pointer; opacity: 0;
  transition: opacity 0.15s;
}
pre:hover .copy { opacity: 1; }
pre .copy:hover { color: var(--text); }

article table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 13.5px; display: block; overflow-x: auto; }
article th, article td { text-align: left; padding: 7px 12px; border: 1px solid var(--border); vertical-align: top; }
article th { background: var(--panel); font-weight: 600; white-space: nowrap; }
article tr:nth-child(2n) td { background: rgba(255, 255, 255, 0.018); }

article blockquote {
  margin: 14px 0; padding: 10px 16px;
  background: var(--panel); border: 1px solid var(--border);
  border-left: 3px solid var(--accent); border-radius: 0 10px 10px 0;
  color: rgba(235, 236, 244, 0.78);
}
article blockquote.warn { border-left-color: var(--warn); background: rgba(245, 180, 85, 0.07); }
article blockquote p { margin: 6px 0; }

.pager { display: flex; justify-content: space-between; gap: 14px; margin-top: 44px; }
.pager a {
  flex: 1; max-width: 48%; padding: 12px 16px; border-radius: 12px;
  background: var(--panel); border: 1px solid var(--border); color: var(--text);
}
.pager a:hover { text-decoration: none; border-color: rgba(139, 124, 247, 0.4); }
.pager a span { display: block; font-size: 11.5px; color: var(--muted); margin-bottom: 2px; }
.pager-next { text-align: right; }
.foot { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--border); font-size: 12.5px; color: var(--muted); }

@media (max-width: 1080px) {
  .shell { grid-template-columns: 220px minmax(0, 1fr); }
  .toc { display: none; }
}
@media (max-width: 760px) {
  .shell { grid-template-columns: 1fr; gap: 16px; padding-top: 16px; }
  .side { position: static; }
  .nav-static { display: none; }
  .side-toggle { display: block; }
  .side-toggle summary {
    cursor: pointer; list-style: none; padding: 10px 14px; border-radius: 10px;
    background: var(--panel); border: 1px solid var(--border); font-size: 13.5px;
  }
  .side-toggle[open] summary { border-radius: 10px 10px 0 0; }
  .side-toggle .nav { padding: 10px 14px; border: 1px solid var(--border); border-top: 0; border-radius: 0 0 10px 10px; background: rgba(11, 11, 15, 0.6); }
  article h1 { font-size: 24px; }
}
`;

function build(): void {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const rendered: RenderedPage[] = [];
  for (const p of PAGES) {
    rendered.push(renderMarkdown(p.file, p.label, readFileSync(join(DOCS, p.file), "utf8")));
  }

  // Validate internal links before writing anything.
  const byFile = new Map(rendered.map((r) => [r.file, r]));
  const problems: string[] = [];
  for (const page of rendered) {
    for (const l of page.links) {
      const target = byFile.get(l.file);
      if (!target) {
        problems.push(`${l.from}: link to unknown page "${l.href}"`);
      } else if (l.hash && !target.ids.has(l.hash.slice(1))) {
        problems.push(`${l.from}: anchor "${l.href}" not found in ${l.file}`);
      }
    }
  }
  if (problems.length) {
    console.error("Broken internal links:");
    for (const p of problems) console.error("  ✗ " + p);
    process.exit(1);
  }

  rendered.forEach((page, i) => {
    Bun.write(join(OUT, page.file), pageHtml(page, i, rendered));
  });
  Bun.write(join(OUT, "docs.css"), CSS.trim() + "\n");
  cpSync(join(ROOT, "logo.png"), join(OUT, "logo.png"));

  console.log(`[docs] built ${rendered.length} pages → ${OUT}`);
}

function serve(port: number): void {
  Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Not found", { status: 404 }); // malformed %-encoding
      }
      if (path.endsWith("/")) path += "index.html";
      const abs = resolve(OUT, "." + path);
      if (!abs.startsWith(OUT + sep)) return new Response("Not found", { status: 404 }); // no escaping docs-site/
      const file = Bun.file(abs);
      if (await file.exists()) return new Response(file);
      return new Response("Not found", { status: 404 });
    },
  });
  console.log(`[docs] preview at http://127.0.0.1:${port}`);
}

build();
if (Bun.argv.includes("--serve")) {
  const i = Bun.argv.indexOf("--port");
  serve(i !== -1 ? Number(Bun.argv[i + 1]) : 8788);
}
