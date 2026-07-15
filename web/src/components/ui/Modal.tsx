import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Width: "sm" (380px), "md" (480px), "lg" (640px), "xl" (880px). */
  size?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
}

const WIDTHS = {
  sm: "380px",
  md: "480px",
  lg: "640px",
  xl: "min(880px, calc(100vw - 32px))",
} as const;

/**
 * Glass modal built on the native <dialog> element — gets escape-to-close,
 * focus trap, and inert background handling for free. Light/click-outside
 * close added on top.
 */
export function Modal({ open, onClose, title, size = "md", children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Native dialog fires "close" on ESC or .close(); propagate up so parent
  // state stays in sync.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const onCloseNative = () => onClose();
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onCloseNative);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onCloseNative);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, not its content)
        if (e.target === ref.current) onClose();
      }}
      className="
        m-auto p-0 border-0 bg-transparent text-foreground
        backdrop:bg-black/40 backdrop:backdrop-blur-md
        outline-none
      "
      style={{ width: WIDTHS[size] }}
    >
      <div className="glass rounded-2xl overflow-hidden">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="text-sm font-medium tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="
              flex size-7 items-center justify-center rounded-md
              text-foreground/55 hover:bg-white/[0.06] hover:text-foreground
              transition-colors
            "
          >
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </dialog>
  );
}
