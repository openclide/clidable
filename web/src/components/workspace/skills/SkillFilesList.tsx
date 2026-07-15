import { formatBytes, type SkillFile } from "./data";

interface Props {
  files: SkillFile[];
}

export function SkillFilesList({ files }: Props) {
  return (
    <ul className="flex flex-col gap-1">
      {files.map((f) => (
        <li
          key={f.path}
          className="
            flex items-center gap-3 rounded-lg
            border border-white/[0.04] bg-white/[0.015]
            px-3 py-2
            transition-[background-color,border-color] duration-150
            hover:border-white/[0.1] hover:bg-white/[0.03]
          "
        >
          <FileGlyph path={f.path} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/80">
            {f.path}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-foreground/40">
            {formatBytes(f.size)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FileGlyph({ path }: { path: string }) {
  // Tiny one-off — pick a glyph variant by extension so files don't all
  // look identical. Markdown gets a doc icon, .tsx/.ts gets a code icon,
  // .sql/.json gets a brackets icon.
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const variant: "doc" | "code" | "data" =
    ext === ".md" || ext === ".txt"
      ? "doc"
      : ext === ".sql" || ext === ".json" || ext === ".jsonc"
        ? "data"
        : "code";

  if (variant === "doc") {
    return (
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/45">
        <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    );
  }
  if (variant === "data") {
    return (
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/45">
        <path d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h2M16 4h2a2 2 0 012 2v12a2 2 0 01-2 2h-2" />
        <path d="M9 12h6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/45">
      <path d="M8 4l-5 8 5 8M16 4l5 8-5 8M14 4l-4 16" />
    </svg>
  );
}
