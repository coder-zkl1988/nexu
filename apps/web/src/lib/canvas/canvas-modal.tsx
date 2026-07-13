/**
 * canvas-modal.tsx — shared canvas-scoped modal shell.
 *
 * Replaces the portal-based Radix Dialog for canvas overlay dialogs: the
 * CanvasDialogs mount point lives INSIDE the canvas container, so this
 * absolute inset-0 overlay covers exactly the canvas region (never the whole
 * desktop window).
 *
 * Responsibilities:
 *  - backdrop (click to close) + Escape to close
 *  - pointer stopPropagation so canvas gestures never start under the modal
 *  - `data-canvas-wheel-exempt` so the canvas wheel-zoom handler ignores
 *    wheel events here — native scrolling works inside the modal
 *  - panel layout matching the old shadcn DialogContent (p-6, gap-4) so the
 *    migrated dialog bodies keep their spacing
 */

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

export function CanvasModal({
  title,
  onClose,
  maxWidth = 640,
  scrollable = true,
  dataAttr,
  children,
}: {
  title: string;
  onClose: () => void;
  maxWidth?: number;
  /**
   * Default: the whole panel scrolls when content overflows. Dialogs that
   * manage their own inner scroll region (e.g. the prompt library's card
   * list) pass false and size children with min-h-0/flex-1 themselves.
   */
  scrollable?: boolean;
  /** Optional marker attribute for tests, e.g. data-canvas-prompt-library-dialog. */
  dataAttr?: { name: string; value: string };
  children: ReactNode;
}) {
  // Escape closes (no Radix focus trap in the canvas-scoped shell).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      data-canvas-wheel-exempt="true"
      {...(dataAttr ? { [dataAttr.name]: dataAttr.value } : {})}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/35 p-6 backdrop-blur-[2px]"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-full w-full flex-col gap-4 rounded-2xl border border-border bg-surface-1 p-6 shadow-2xl ${
          scrollable ? "no-scrollbar overflow-y-auto" : "overflow-hidden"
        }`}
        style={{ maxWidth }}
      >
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            aria-label={`关闭${title}`}
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
