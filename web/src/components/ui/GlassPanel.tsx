import type { HTMLAttributes, ReactNode } from "react";

interface GlassPanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  as?: "section" | "div" | "article";
  title?: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  /** Inner padding. Defaults to `p-4`. */
  padding?: string;
}

/**
 * The single glass surface primitive. Reach for this whenever you want
 * "this thing should feel like a panel of glass floating over the desktop":
 * blurred translucent fill, hairline edge, soft outer shadow, top-edge
 * inset highlight to suggest light catching the surface.
 *
 * Nested content should NOT use .glass — use .surface instead (semi-opaque
 * card without blur). Blurring twice looks muddy.
 */
export function GlassPanel({
  as = "section",
  title,
  subtitle,
  footer,
  padding = "p-4",
  className,
  children,
  ...rest
}: GlassPanelProps) {
  const Tag = as;
  return (
    <Tag
      className={`glass rounded-2xl ${className ?? ""}`}
      {...rest}
    >
      {(title || subtitle) && (
        <header className={`flex items-baseline justify-between gap-3 ${padding} pb-2`}>
          <div>
            {title && (
              <h2 className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-foreground/55">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-foreground/45">{subtitle}</p>
            )}
          </div>
        </header>
      )}
      <div className={title || subtitle ? `${padding} pt-2` : padding}>{children}</div>
      {footer && (
        <footer
          className={`border-t border-white/[0.06] ${padding} pt-3 text-xs text-foreground/60`}
        >
          {footer}
        </footer>
      )}
    </Tag>
  );
}
