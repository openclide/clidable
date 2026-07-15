/**
 * Full-screen image viewer. Renders in a portal at <body> so it floats
 * above everything (including the checkpoint popovers, which live in
 * their own z-50 portal — this sits at z-60).
 *
 * Dismisses on backdrop click, the × button, or Escape. Mousedown on the
 * overlay is stopped from propagating so the anchored popover underneath
 * (RewindPopover / SincePicker) doesn't treat the click as "outside" and
 * close itself — closing the lightbox should return you to the still-open
 * list, not dump you back to the composer.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Image URL, or null to render nothing. */
  src: string | null;
  alt?: string;
  open: boolean;
  onClose: () => void;
}

export function ImageLightbox({ src, alt = "", open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !src) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Screenshot"}
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
      className="
        fixed inset-0 z-[60] flex items-center justify-center
        bg-black/70 p-10 backdrop-blur-sm
      "
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="
          max-h-full max-w-full rounded-lg object-contain
          ring-1 ring-white/10
          shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)]
        "
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="
          absolute right-4 top-4 flex size-8 items-center justify-center
          rounded-full bg-white/10 text-foreground/80
          ring-1 ring-white/10 backdrop-blur-md
          transition-colors duration-100
          hover:bg-white/20 hover:text-foreground
          focus:outline-none focus-visible:bg-white/20
        "
      >
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>,
    document.body,
  );
}
