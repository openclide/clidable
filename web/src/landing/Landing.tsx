/**
 * Clidable marketing landing page. A real page in the app: it links the same
 * globals.css (tokens, .glass/.surface, the animated background, fonts) so it
 * is the app's design system, not a copy. Served by the Bun server at /home.
 */
import type { CSSProperties, ReactNode } from "react";
import logoUrl from "../../logo.png";
import { AGENTS } from "@/components/welcome/data";
import { AgentIcon } from "@/components/icons/AgentIcon";
import { RewindHero } from "./RewindHero";

const DOWNLOAD = "#download";
const GITHUB = "https://github.com/openclide/clidable";
const RELEASES = `${GITHUB}/releases`;

export function Landing() {
  return (
    <div className="min-h-screen w-full">
      <Nav />
      <main className="mx-auto max-w-6xl px-6">
        <Hero />
        <AgentRail />
        <Features />
        <HowItWorks />
        <Platforms />
        <TrustStrip />
        <OpenSource />
        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}

/* -- shared bits ---------------------------------------------------------- */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-accent">
      {children}
    </span>
  );
}

function BtnPrimary({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/25"
    >
      {children}
    </a>
  );
}

function BtnGhost({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.05] px-5 py-2.5 text-sm text-foreground/85 transition-colors hover:bg-white/[0.1]"
    >
      {children}
    </a>
  );
}

const enter = (delay: number): CSSProperties => ({
  animation: `enter-up 440ms ${delay}ms cubic-bezier(0.2,0.7,0.2,1) both`,
});

/* -- nav ------------------------------------------------------------------ */

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-15 max-w-6xl items-center gap-6 px-6 py-3">
        <a href="#top" className="flex items-center gap-2.5">
          <img src={logoUrl} alt="" className="size-7 select-none" />
          <span className="text-[15px] font-semibold tracking-tight">Clidable</span>
        </a>
        <nav className="ml-2 hidden items-center gap-6 text-sm text-foreground/60 md:flex">
          <a href="#features" className="transition-colors hover:text-foreground">Features</a>
          <a href="#checkpoints" className="transition-colors hover:text-foreground">Checkpoints</a>
          <a href="#open-source" className="transition-colors hover:text-foreground">Open source</a>
          <a href="#docs" className="transition-colors hover:text-foreground">Docs</a>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <a href={GITHUB} className="hidden text-sm text-foreground/60 transition-colors hover:text-foreground sm:block">GitHub</a>
          <BtnPrimary href={DOWNLOAD}>Download</BtnPrimary>
        </div>
      </div>
    </header>
  );
}

/* -- hero ----------------------------------------------------------------- */

function Hero() {
  return (
    <section id="top" className="grid items-center gap-12 py-16 lg:grid-cols-[1fr_1.08fr] lg:py-24">
      <div>
        <div style={enter(0)}>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 text-[12px] text-foreground/70">
            <span className="size-1.5 rounded-full bg-[oklch(0.8_0.15_162)] [animation:pulse-soft_1.6s_ease-in-out_infinite]" />
            <b className="font-semibold text-foreground">v0.1</b> in the works — free &amp; open source
          </span>
        </div>
        <h1
          className="mt-6 text-4xl font-medium leading-[1.04] tracking-tight sm:text-5xl lg:text-[3.5rem]"
          style={enter(70)}
        >
          One window for{" "}
          <span className="bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-transparent">
            every coding agent.
          </span>
        </h1>
        <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-foreground-muted" style={enter(140)}>
          Run Claude Code, Codex, Antigravity and five more as real terminals — with
          checkpoints you can rewind, a live app preview, and one-click MCP,
          skills &amp; plugins. On your desktop, in the browser, or from your phone.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3" style={enter(210)}>
          <BtnPrimary href={DOWNLOAD}>↓ Download for macOS</BtnPrimary>
          <BtnGhost href="/">Open in the browser</BtnGhost>
        </div>
        <p className="mt-5 font-mono text-[12px] text-foreground/40" style={enter(280)}>
          macOS · Windows · Linux · PWA — no sign-up to start
        </p>
      </div>

      <div className="lg:pl-4">
        <RewindHero />
      </div>
    </section>
  );
}

/* -- agent rail ----------------------------------------------------------- */

function AgentRail() {
  return (
    <section className="border-t border-white/[0.06] py-14 text-center">
      <Eyebrow>One window · every agent</Eyebrow>
      <div className="mt-8 flex flex-wrap items-start justify-center gap-x-7 gap-y-6">
        {AGENTS.map((a) => (
          <div
            key={a.id}
            className="group flex w-16 flex-col items-center gap-2"
            style={{ ["--agent"]: a.color } as CSSProperties}
          >
            <div className="flex size-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-[color:var(--agent)]/40 group-hover:bg-[color:var(--agent)]/[0.09] group-hover:shadow-[0_6px_26px_-8px_var(--agent)]">
              <AgentIcon id={a.id} size={22} />
            </div>
            <span className="text-center font-mono text-[10px] leading-tight text-foreground/45">{a.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -- features ------------------------------------------------------------- */

interface Feature { title: string; body: string; icon: ReactNode; anchor?: string }

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

const FEATURES: Feature[] = [
  { title: "Agents in real terminals", body: "Every agent runs in its true TUI over a PTY — colors, spinners, slash commands, all of it. Never headless, never a JSON stream.", icon: svg(<><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M7 10l2.5 2L7 14" /><path d="M12.5 14H16" /></>) },
  { title: "Checkpoints you can rewind", body: "A snapshot before every message, in a private shadow-git repo. Rewind the whole project to any point in a click — your real .git is never touched.", icon: svg(<><path d="M3 12a9 9 0 109-9" /><path d="M3 4v5h5" /></>), anchor: "checkpoints" },
  { title: "Live preview, right there", body: "Clidable catches your dev-server URL the moment it boots and renders your app beside the terminal. Desktop, tablet and phone viewports.", icon: svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /><circle cx="6" cy="7" r=".6" fill="currentColor" /></>) },
  { title: "Split panes, many agents", body: "Run Claude in one pane and Codex in the next. Tab between sessions, split any pane, and drag work across projects.", icon: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>) },
  { title: "MCP, skills & plugins", body: "Install once and Clidable projects it into every agent that can use it — with one shared AGENTS.md kept in sync. No editing five config files.", icon: svg(<><path d="M9 7V3M15 7V3" /><path d="M6 7h12v4a6 6 0 01-12 0z" /><path d="M12 17v4" /></>) },
  { title: "AI Team & remote access", body: "Let a lead agent delegate to specialist roles. It's one port — reach it from your phone or over Tailscale, or install it as a PWA.", icon: svg(<><circle cx="8" cy="8.5" r="2.6" /><path d="M2.5 19a5.5 5.5 0 0111 0" /><path d="M16 6.5a2.6 2.6 0 010 5.2" /><path d="M21.5 19a5.5 5.5 0 00-5-5.5" /></>) },
];

function Features() {
  return (
    <section id="features" className="border-t border-white/[0.06] py-20">
      <div className="max-w-xl">
        <Eyebrow>Why Clidable</Eyebrow>
        <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-[2.4rem]">
          The IDE your terminal agents never had.
        </h2>
        <p className="mt-4 text-[16px] leading-relaxed text-foreground-muted">
          Agents are brilliant on the command line and painful to live in.
          Clidable keeps the real TUI and wraps it in a workspace built for
          actually shipping.
        </p>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            id={f.anchor}
            className="scroll-mt-24 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04]"
          >
            <div className="flex size-10 items-center justify-center rounded-xl border border-white/[0.08] bg-accent/[0.1] text-accent">
              {f.icon}
            </div>
            <h3 className="mt-4 text-[16px] font-semibold tracking-tight">{f.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-foreground/55">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -- how it works --------------------------------------------------------- */

const STEPS = [
  { n: "01", t: "Open a project", d: "Point Clidable at any folder, or scaffold a fresh one from a template. Your recents are one click away." },
  { n: "02", t: "Pick an agent", d: "Choose Claude Code, Codex, Antigravity or any installed agent. It launches into its own real terminal." },
  { n: "03", t: "Start building", d: "Checkpoints, live preview, and your MCP servers & skills are already on. Just start typing." },
];

function HowItWorks() {
  return (
    <section className="border-t border-white/[0.06] py-20">
      <Eyebrow>How it works</Eyebrow>
      <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-[2.4rem]">Three steps to your first agent.</h2>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6">
            <span className="font-mono text-[13px] font-semibold text-accent">{s.n}</span>
            <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{s.t}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-foreground/55">{s.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -- platforms ------------------------------------------------------------ */

const PLATFORMS = [
  { icon: "🖥️", t: "Native desktop", d: "A ~50-line Tauri shell with real OS window vibrancy. macOS, Windows & Linux." },
  { icon: "🌐", t: "Any browser", d: "One process, one port. Dev is prod. Nothing to configure." },
  { icon: "📱", t: "PWA on mobile", d: "Install to your home screen and drive your agents from the couch." },
];

function Platforms() {
  return (
    <section className="border-t border-white/[0.06] py-20">
      <div className="grid gap-4 md:grid-cols-3">
        {PLATFORMS.map((p) => (
          <div key={p.t} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6">
            <div className="text-2xl">{p.icon}</div>
            <h3 className="mt-3 text-[16px] font-semibold tracking-tight">{p.t}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-foreground/55">{p.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -- trust strip (real facts, not fake quotes) ---------------------------- */

const FACTS = ["PTY-first", "Shadow-git checkpoints", "One Bun binary", "8 agents", "Apache-2.0 open source"];

function TrustStrip() {
  return (
    <section className="border-t border-white/[0.06] py-12">
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {FACTS.map((f) => (
          <span key={f} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 font-mono text-[12px] text-foreground/60">
            {f}
          </span>
        ))}
      </div>
    </section>
  );
}

/* -- open source ---------------------------------------------------------- */

function OpenSource() {
  return (
    <section id="open-source" className="border-t border-white/[0.06] py-20">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <Eyebrow>Open source</Eyebrow>
          <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-[2.4rem]">
            Free, forever. Yours to fork.
          </h2>
          <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-foreground-muted">
            Clidable is Apache-2.0-licensed and self-hosted — no accounts, no
            telemetry, nothing held behind a paywall. Run it, read it, fork it,
            ship it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <BtnPrimary href={GITHUB}>★ Star on GitHub</BtnPrimary>
            <BtnGhost href={GITHUB}>Read the code</BtnGhost>
          </div>
          <p className="mt-5 font-mono text-[12px] text-foreground/40">
            Apache-2.0 licensed · no telemetry · no account
          </p>
        </div>

        {/* install card — the honest CTA for an OSS tool: here's how to run it */}
        <div className="glass rounded-2xl p-1.5">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className="flex gap-1.5">
              <i className="size-2.5 rounded-full bg-[#ff5f57]" />
              <i className="size-2.5 rounded-full bg-[#febc2e]" />
              <i className="size-2.5 rounded-full bg-[#28c840]" />
            </span>
            <span className="ml-1 font-mono text-[11px] text-foreground/45">install</span>
          </div>
          <div className="surface rounded-xl px-4 py-4 font-mono text-[12.5px] leading-loose">
            <div className="text-foreground/40"># run from source today</div>
            <div><span className="text-accent">$</span> git clone {GITHUB.replace("https://", "")}</div>
            <div><span className="text-accent">$</span> cd clidable &amp;&amp; bun install &amp;&amp; bun run dev</div>
            <div className="text-foreground/45">&nbsp;&nbsp;↳ serving on localhost:7878</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -- cta ------------------------------------------------------------------ */

function CtaBand() {
  return (
    <section id="download" className="py-20">
      <div className="glass relative overflow-hidden rounded-2xl px-8 py-14 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-1/2 h-full opacity-70 blur-3xl" style={{ background: "radial-gradient(50% 60% at 50% 100%, color-mix(in oklch, var(--color-accent) 35%, transparent), transparent 70%)" }} />
        <h2 className="relative text-3xl font-medium tracking-tight sm:text-[2.6rem]">Bring your agents home.</h2>
        <p className="relative mx-auto mt-4 max-w-md text-[16px] text-foreground-muted">
          Download the desktop app, or spin up the server and open it anywhere. Free to start, no account required.
        </p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <BtnPrimary href={RELEASES}>↓ Download for macOS</BtnPrimary>
          <BtnGhost href={RELEASES}>Windows &amp; Linux</BtnGhost>
        </div>
        <p className="relative mt-5 font-mono text-[12px] text-foreground/40">binaries &amp; checksums on GitHub Releases</p>
      </div>
    </section>
  );
}

/* -- footer --------------------------------------------------------------- */

const FOOT = [
  {
    h: "Product",
    links: [
      { l: "Features", href: "#features" },
      { l: "Open source", href: "#open-source" },
      { l: "Download", href: "#download" },
      { l: "Changelog", href: RELEASES },
    ],
  },
  {
    h: "Docs",
    links: [
      { l: "Getting started", href: `${GITHUB}/blob/main/docs/getting-started.md` },
      { l: "Agents", href: `${GITHUB}/blob/main/docs/agent-toolkit.md` },
      { l: "Checkpoints", href: `${GITHUB}/blob/main/docs/checkpoints.md` },
      { l: "CLI reference", href: `${GITHUB}/blob/main/docs/cli-reference.md` },
    ],
  },
  {
    h: "Project",
    links: [
      { l: "GitHub", href: GITHUB },
      { l: "Issues", href: `${GITHUB}/issues` },
      { l: "Releases", href: RELEASES },
    ],
  },
];

function Footer() {
  return (
    <footer id="docs" className="mt-10 border-t border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <a href="#top" className="flex items-center gap-2.5">
              <img src={logoUrl} alt="" className="size-7" />
              <span className="text-[15px] font-semibold tracking-tight">Clidable</span>
            </a>
            <p className="mt-4 max-w-[34ch] text-[14px] leading-relaxed text-foreground/50">
              The beautiful GUI for CLI coding agents. Real terminals, checkpoints, preview, and cross-agent tooling — everywhere you work.
            </p>
          </div>
          {FOOT.map((c) => (
            <div key={c.h}>
              <h4 className="font-mono text-[11px] uppercase tracking-[0.12em] text-foreground/40">{c.h}</h4>
              <div className="mt-4 flex flex-col gap-2.5">
                {c.links.map(({ l, href }) => (
                  <a key={l} href={href} className="text-[14px] text-foreground/55 transition-colors hover:text-accent">{l}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-6 text-[13px] text-foreground/40">
          <span>© 2026 Clidable · Apache-2.0 licensed</span>
          <span className="font-mono">Built with Bun · React · Tauri</span>
        </div>
      </div>
    </footer>
  );
}
