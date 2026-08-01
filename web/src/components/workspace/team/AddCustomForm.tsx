import { useState } from "react";
import { RoleGlyph } from "./RoleGlyph";
import { HandlerPicker } from "./HandlerPicker";
import { LeadAgentCheckboxes } from "./LeadAgentCheckboxes";
import { ROLE_GLYPH_OPTIONS, type Role, type RoleGlyphId } from "./data";
import { AGENTS, type AgentId } from "../../welcome/data";

interface Props {
  onCreate: (role: Omit<Role, "id" | "isCustom">) => void;
}

export function AddCustomForm({ onCreate }: Props) {
  const [name, setName] = useState("");
  const [glyph, setGlyph] = useState<RoleGlyphId>(ROLE_GLYPH_OPTIONS[0]!);
  const [description, setDescription] = useState("");
  const [triggerHint, setTriggerHint] = useState("");
  const [prompt, setPrompt] = useState("");
  const [handler, setHandler] = useState<AgentId>("claude");
  const [leads, setLeads] = useState<AgentId[]>(() => AGENTS.map((a) => a.id));

  const canSubmit =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    triggerHint.trim().length > 0 &&
    leads.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onCreate({
          name: name.trim(),
          description: description.trim(),
          glyph,
          triggerHint: triggerHint.trim(),
          // Delegate-facing: this text is sent TO the teammate ahead of the
          // task, so the fallback addresses it directly. The triggerHint is
          // deliberately not appended — it's third-person prose written for the
          // lead to match against, and reads wrong as an instruction.
          promptTemplate: prompt.trim() || `You are a specialist in ${name.trim()}.`,
          handlerAgent: handler,
          enabledForLeads: leads,
          enabled: true,
        });
      }}
      className="flex flex-col gap-5"
    >
      <Field label="Name" hint="Shown in the card and in agent suggestions.">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Marketer"
          className="
            w-full rounded-xl
            border border-white/[0.08] bg-white/[0.03]
            px-3.5 py-2.5
            text-[12.5px] text-foreground
            placeholder:text-foreground/30
            outline-none
            focus:border-white/[0.2] focus:bg-white/[0.05]
            focus:shadow-[0_0_0_4px_rgba(255,255,255,0.03)]
            transition-[border-color,background-color,box-shadow] duration-150
          "
        />
      </Field>

      <Field label="Icon" hint="Pick a glyph for the role's badge.">
        <div className="flex flex-wrap gap-1.5">
          {ROLE_GLYPH_OPTIONS.map((g) => {
            const on = g === glyph;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGlyph(g)}
                aria-pressed={on}
                title={g}
                className={`
                  flex size-9 items-center justify-center rounded-xl
                  border transition-[background-color,border-color,color] duration-150
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                  ${
                    on
                      ? "border-white/[0.2] bg-white/[0.07] text-foreground"
                      : "border-white/[0.06] bg-white/[0.02] text-foreground/55 hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-foreground/85"
                  }
                `}
              >
                <RoleGlyph id={g} size={16} />
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="Description"
        hint="One sentence shown in the role card."
      >
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Landing copy, positioning, email, headlines."
          className="
            w-full rounded-xl
            border border-white/[0.08] bg-white/[0.03]
            px-3.5 py-2.5
            text-[12.5px] text-foreground
            placeholder:text-foreground/30
            outline-none
            focus:border-white/[0.2] focus:bg-white/[0.05]
            focus:shadow-[0_0_0_4px_rgba(255,255,255,0.03)]
            transition-[border-color,background-color,box-shadow] duration-150
          "
        />
      </Field>

      <Field
        label="Trigger hint"
        hint="When should the lead agent use this specialist?"
      >
        <input
          type="text"
          value={triggerHint}
          onChange={(e) => setTriggerHint(e.target.value)}
          placeholder="Writes marketing copy, landing pages, and product positioning. Use when drafting a launch announcement, rewriting a headline, or when the user asks for the Marketer."
          className="
            w-full rounded-xl
            border border-white/[0.08] bg-white/[0.03]
            px-3.5 py-2.5
            text-[12.5px] text-foreground
            placeholder:text-foreground/30
            outline-none
            focus:border-white/[0.2] focus:bg-white/[0.05]
            focus:shadow-[0_0_0_4px_rgba(255,255,255,0.03)]
            transition-[border-color,background-color,box-shadow] duration-150
          "
        />
      </Field>

      <Field
        label="Prompt template"
        hint="Optional — leave blank for a sensible default."
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="You are an expert SaaS marketer. Match audience and tone. Be punchy and concrete."
          className="
            w-full resize-none rounded-xl
            border border-white/[0.08] bg-white/[0.03]
            px-3.5 py-2.5
            font-mono text-[11.5px] leading-relaxed text-foreground
            placeholder:text-foreground/30
            outline-none
            focus:border-white/[0.2] focus:bg-white/[0.05]
            focus:shadow-[0_0_0_4px_rgba(255,255,255,0.03)]
            transition-[border-color,background-color,box-shadow] duration-150
          "
        />
      </Field>

      <Field label="Handler agent" hint="Which CLI agent handles this role's work.">
        <HandlerPicker value={handler} onChange={setHandler} />
      </Field>

      <Field
        label="Enabled for leads"
        hint="Which lead agents get this specialist's skill installed."
      >
        <LeadAgentCheckboxes selected={leads} onChange={setLeads} />
      </Field>

      <div className="mt-1 flex items-center justify-end gap-3">
        <span className="text-[11px] text-foreground/35">
          Role saves to <code className="font-mono">.clidable/ai-team.json</code>.
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="
            rounded-lg
            border border-white/[0.12] bg-white/[0.06]
            px-4 py-2 text-[12px] font-medium text-foreground
            transition-[background-color,border-color] duration-150
            hover:border-white/[0.22] hover:bg-white/[0.1]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
            disabled:cursor-not-allowed disabled:opacity-50
            disabled:hover:border-white/[0.12] disabled:hover:bg-white/[0.06]
          "
        >
          Create role
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground/55">
          {label}
        </label>
        {hint && <span className="text-[10.5px] text-foreground/35">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
