/**
 * The landing page's signature: a live Clidable workspace whose checkpoint
 * timeline you can scrub. It auto-plays "agent works → ✓ checkpointed →
 * ↺ rewind", and the terminal + preview visibly revert as you move back —
 * so the one thing the hero demonstrates is the product's core magic.
 *
 * Pure presentation: no app state, no network. Reuses the real agent catalog
 * + colors so it reads as Clidable, not a mockup of it.
 */
import { useEffect, useRef, useState } from "react";
import { getAgent, type AgentId } from "@/components/welcome/data";
import { AgentIcon } from "@/components/icons/AgentIcon";

type Line = { t: string; k: "p" | "ok" | "dim" };

interface Checkpoint {
  label: string;
  agent: AgentId;
  lines: Line[];
  /** How much of the previewed app exists at this point (drives the revert). */
  build: number;
}

const CHECKPOINTS: Checkpoint[] = [
  { label: "Initial state", agent: "claude", build: 1, lines: [
    { t: "opened checkout-flow", k: "dim" },
  ] },
  { label: "scaffold checkout page", agent: "claude", build: 3, lines: [
    { t: "› scaffold a checkout page", k: "p" },
    { t: "created src/checkout.tsx", k: "ok" },
    { t: "created src/api/pay.ts", k: "ok" },
  ] },
  { label: "wire up Stripe", agent: "codex", build: 5, lines: [
    { t: "› wire up Stripe", k: "p" },
    { t: "added @stripe/stripe-js", k: "dim" },
    { t: "POST /api/pay → session ✓", k: "ok" },
  ] },
  { label: "add tests", agent: "codex", build: 6, lines: [
    { t: "› add tests for checkout", k: "p" },
    { t: "running vitest…", k: "dim" },
    { t: "✓ 12 passing", k: "ok" },
  ] },
];

// The auto-play script: run forward to the end, rewind to an earlier point
// (the moment worth showing), carry on, rewind again. `rw` flags the jumps.
const SCRIPT: { i: number; rw?: boolean }[] = [
  { i: 0 }, { i: 1 }, { i: 2 }, { i: 3 },
  { i: 1, rw: true }, { i: 2 }, { i: 3 },
  { i: 0, rw: true },
];

const STEP_MS = 1700;

export function RewindHero() {
  const reduce =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [active, setActive] = useState(reduce ? 3 : 0);
  const [rewound, setRewound] = useState(false);
  const cursor = useRef(0);
  const pausedUntil = useRef(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      cursor.current = (cursor.current + 1) % SCRIPT.length;
      const step = SCRIPT[cursor.current]!;
      setActive(step.i);
      setRewound(!!step.rw);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [reduce]);

  // Manual scrub: jump there, mark it a rewind if we went backward, and hold
  // auto-play for a beat so the click isn't immediately overwritten.
  function scrubTo(i: number) {
    setRewound(i < active);
    setActive(i);
    pausedUntil.current = Date.now() + 6000;
    const c = SCRIPT.findIndex((s) => s.i === i);
    if (c >= 0) cursor.current = c;
  }

  const cp = CHECKPOINTS[active]!;
  const agent = getAgent(cp.agent);

  return (
    <div
      className="glass relative rounded-2xl p-2.5 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)]"
      style={{ animation: reduce ? undefined : "enter-up 520ms 120ms cubic-bezier(0.2,0.7,0.2,1) both" }}
    >
      {/* accent bloom behind the panel */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2rem] opacity-60 blur-3xl"
        style={{ background: "radial-gradient(60% 55% at 60% 20%, color-mix(in oklch, var(--color-accent) 40%, transparent), transparent 70%)" }}
      />

      {/* window chrome */}
      <div className="flex items-center gap-2 px-1.5 py-1.5">
        <span className="flex gap-1.5">
          <i className="size-2.5 rounded-full bg-[#ff5f57]" />
          <i className="size-2.5 rounded-full bg-[#febc2e]" />
          <i className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="ml-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-foreground/55">
          checkout-flow
        </span>
      </div>

      {/* terminal + preview */}
      <div className="grid grid-cols-[1.35fr_1fr] gap-2">
        {/* terminal */}
        <div className="surface flex min-h-[236px] flex-col overflow-hidden rounded-xl">
          <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-2">
            <span
              className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-foreground/85"
              style={{ background: "color-mix(in oklch, " + agent.color + " 14%, transparent)" }}
            >
              <AgentIcon id={agent.id} size={11} />
              {agent.name}
            </span>
          </div>
          <div className="flex-1 space-y-1 px-3 py-3 font-mono text-[12px] leading-relaxed">
            <div className="text-foreground/45">
              <span className="text-accent">➜</span> ~/checkout-flow
            </div>
            {cp.lines.map((l, i) => (
              <div
                key={active + "-" + i}
                className={
                  l.k === "p" ? "text-accent"
                  : l.k === "ok" ? "text-[oklch(0.8_0.15_162)]"
                  : "text-foreground/45"
                }
                style={{ animation: reduce ? undefined : `enter-up 260ms ${i * 70}ms cubic-bezier(0.2,0.7,0.2,1) both` }}
              >
                {l.t}
              </div>
            ))}
            {!reduce && <span className="inline-block h-3.5 w-1.5 translate-y-[2px] bg-accent/80 [animation:pulse-soft_1.1s_steps(1)_infinite]" />}
          </div>
        </div>

        {/* preview — content builds up / reverts with the active checkpoint */}
        <div className="surface flex min-h-[236px] flex-col overflow-hidden rounded-xl">
          <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-2 font-mono text-[10.5px] text-foreground/50">
            <span className="size-1.5 rounded-full bg-[oklch(0.8_0.15_162)]" />
            localhost:3000
          </div>
          <div className="flex flex-1 flex-col gap-2 p-3">
            <div className="h-5 w-2/3 rounded bg-gradient-to-r from-accent to-accent-2 opacity-90 transition-all duration-500" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-2.5 rounded bg-white/[0.07] transition-all duration-500"
                style={{
                  width: [82, 68, 90, 74][i % 4] + "%",
                  opacity: i < cp.build - 1 ? 1 : 0,
                  transform: i < cp.build - 1 ? "none" : "translateY(-4px)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* checkpoint timeline — the scrubbable part */}
      <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">
            Checkpoints — click to rewind
          </span>
          <span
            key={active + (rewound ? "r" : "c")}
            className={"flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[10.5px] " + (rewound ? "text-accent" : "text-[oklch(0.8_0.15_162)]")}
            style={{ background: rewound ? "color-mix(in oklch, var(--color-accent) 16%, transparent)" : "color-mix(in oklch, oklch(0.8 0.15 162) 14%, transparent)", animation: reduce ? undefined : "checkpoint-pop 650ms cubic-bezier(0.2,0.7,0.2,1)" }}
          >
            {rewound ? "↺ Rewound here" : "✓ Checkpointed"}
          </span>
        </div>
        <div className="relative flex items-stretch gap-1.5">
          {CHECKPOINTS.map((c, i) => {
            const on = i === active;
            const done = i < active;
            const a = getAgent(c.agent);
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => scrubTo(i)}
                title={`Rewind to “${c.label}”`}
                className={
                  "group flex flex-1 flex-col gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors " +
                  (on
                    ? "border-accent/50 bg-accent/[0.12]"
                    : done
                      ? "border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.06]"
                      : "border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.04]")
                }
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full transition-transform group-active:scale-90"
                    style={{ background: on || done ? a.color : "color-mix(in oklch, white 18%, transparent)" }}
                  />
                  <span className={"truncate font-mono text-[10px] " + (on ? "text-foreground/90" : "text-foreground/50")}>
                    {i === 0 ? "start" : c.label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
