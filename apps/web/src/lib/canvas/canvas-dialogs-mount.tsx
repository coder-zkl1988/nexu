/**
 * canvas-dialogs-mount.tsx — CanvasDialogs single mount point (W4.0).
 *
 * Mount once inside CanvasSurface (screen-space, after menus).
 * Switches on useCanvasDialog().kind to render the appropriate dialog.
 * Moved verbatim from crop-dialog.tsx so crop-dialog.tsx keeps only its own dialog.
 */

import { AngleDialog } from "./angle-dialog";
import { useCanvasDialog } from "./canvas-dialogs";
import { CropDialog } from "./crop-dialog";
import { MaskDialog } from "./mask-dialog";
import { SplitDialog } from "./split-dialog";
import { UpscaleDialog } from "./upscale-dialog";

/** Mount once inside CanvasSurface. Switches on dialog kind. */
export function CanvasDialogs() {
  const dialog = useCanvasDialog();
  if (!dialog) return null;
  if (dialog.kind === "crop") return <CropDialog state={dialog} />;
  if (dialog.kind === "split") return <SplitDialog state={dialog} />;
  if (dialog.kind === "upscale") return <UpscaleDialog state={dialog} />;
  if (dialog.kind === "mask") return <MaskDialog state={dialog} />;
  if (dialog.kind === "angle") return <AngleDialog state={dialog} />;
  return null;
}
