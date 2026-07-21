/**
 * preview-dialog.tsx — full-size image preview (lightbox).
 *
 * Follows crop-dialog.tsx / upscale-dialog.tsx precedent: shared CanvasModal
 * shell, node resolved live from the store by id. No image processing here —
 * just a large, centered <img>, so no bitmap loading is needed.
 */

import { useEffect } from "react";
import { toast } from "sonner";
import { type CanvasDialogState, closeCanvasDialog } from "./canvas-dialogs";
import { CanvasModal } from "./canvas-modal";
import { getCanvasState } from "./canvas-store";

export function PreviewDialog({
  state,
}: {
  state: NonNullable<CanvasDialogState> & { kind: "preview" };
}) {
  const { nodeId } = state;
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  const src = node?.metadata.content as string | undefined;

  useEffect(() => {
    if (!src) {
      toast.error("图片加载失败");
      closeCanvasDialog();
    }
  }, [src]);

  if (!src) return null;

  return (
    <CanvasModal
      title={node?.title || "预览图片"}
      maxWidth={1080}
      scrollable={false}
      onClose={closeCanvasDialog}
      dataAttr={{ name: "data-canvas-preview-dialog", value: "true" }}
    >
      <div className="flex items-center justify-center overflow-hidden px-6 pb-6">
        <img
          src={src}
          alt={node?.title ?? ""}
          className="max-h-[75vh] max-w-full rounded-lg object-contain"
          draggable={false}
        />
      </div>
    </CanvasModal>
  );
}
