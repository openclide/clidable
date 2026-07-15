/** Dev-server terminal glyph — shared by the three controls that toggle the
 *  terminal sheet (SidePane Code-mode toolbar, preview ports menu, top-bar
 *  layout menu) so they stay visually in sync. */
export function TerminalGlyph({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M7 10l2.5 2L7 14" />
      <path d="M12.5 14.5h4" />
    </svg>
  );
}
