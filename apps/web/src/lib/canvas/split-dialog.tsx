/**
 * split-dialog.tsx — grid split dialog (W3.3).
 *
 * Splits an image into an R×C grid of child image nodes using the pure-canvas
 * API (offscreen canvas drawImage 9-arg form → PNG dataURL per piece).
 *
 * Follows crop-dialog.tsx precedent exactly:
 *   - Uses the same radix Dialog component from @/components/ui/dialog
 *   - Uses loadImageBitmap (extracted shared helper, not local fetch)
 *   - Adds child nodes via addNode + toast.success / toast.error
 *   - data-canvas-split-dialog attribute on the content container
 *   - data-canvas-split-confirm on the confirm button
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Grid3x3 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { CanvasDialogState } from "./canvas-dialogs";
import { closeCanvasDialog } from "./canvas-dialogs";
import { addNode, getCanvasState } from "./canvas-store";
import { fitScale } from "./crop-geometry";
import { loadImageBitmap } from "./load-image-bitmap";
import { gridPieceRects, splitChildLayout } from "./split-upscale-math";

// ── Constants ──────────────────────────────────────────────────────────────

const PREVIEW_MAX_W = 600;
const PREVIEW_MAX_H = 380;
const DEFAULT_ROWS = 2;
const DEFAULT_COLS = 2;
const MIN_GRID = 1;
const MAX_GRID = 12;

// ── SplitDialog ─────────────────────────────────────────────────────────────

export function SplitDialog({
  state,
}: {
  state: NonNullable<CanvasDialogState> & { kind: "split" };
}) {
  const { nodeId } = state;
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [cols, setCols] = useState(DEFAULT_COLS);

  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  const srcUrl = node?.metadata.content as string | undefined;
  const srcTitle = node?.title ?? "图片";

  useEffect(() => {
    if (!srcUrl) {
      toast.error("图片加载失败");
      closeCanvasDialog();
      return;
    }

    let cancelled = false;
    let loaded: { bitmap: ImageBitmap; objectUrl: string } | null = null;

    (async () => {
      try {
        const result = await loadImageBitmap(srcUrl);
        if (cancelled) {
          result.bitmap.close();
          URL.revokeObjectURL(result.objectUrl);
          return;
        }
        loaded = result;
        setBitmap(result.bitmap);
        setObjUrl(result.objectUrl);
      } catch {
        if (cancelled) return;
        toast.error("图片加载失败");
        closeCanvasDialog();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (loaded) {
        loaded.bitmap.close();
        URL.revokeObjectURL(loaded.objectUrl);
      }
    };
  }, [srcUrl]);

  useEffect(() => {
    return () => {
      bitmap?.close();
    };
  }, [bitmap]);

  // Derived values
  const scale = bitmap
    ? fitScale(bitmap.width, bitmap.height, PREVIEW_MAX_W, PREVIEW_MAX_H)
    : 1;
  const displayW = bitmap ? Math.round(bitmap.width * scale) : 0;
  const displayH = bitmap ? Math.round(bitmap.height * scale) : 0;

  const pieceRects = bitmap
    ? gridPieceRects(bitmap.width, bitmap.height, rows, cols)
    : [];
  const totalPieces = rows * cols;

  // Piece size readout using first piece as representative
  const firstPiece = pieceRects[0];
  const pieceW = firstPiece?.width ?? 0;
  const pieceH = firstPiece?.height ?? 0;

  // Confirm: draw each piece, create child nodes
  const handleConfirm = useCallback(() => {
    if (!bitmap) return;

    const pieces = gridPieceRects(bitmap.width, bitmap.height, rows, cols);
    const pieceAspect =
      pieces[0] && pieces[0].height > 0
        ? pieces[0].width / pieces[0].height
        : 1;

    // Read node live so a title rename between dialog-open and confirm is reflected
    const src = getCanvasState().nodes.find((n) => n.id === nodeId);
    const liveTitle = src?.title ?? "图片";
    const srcPos = src
      ? {
          x: src.position.x,
          y: src.position.y,
          width: src.size.width,
          height: src.size.height,
        }
      : { x: 0, y: 0, width: 0, height: 0 };

    const layouts = splitChildLayout(srcPos, rows, cols, pieceAspect);

    for (const piece of pieces) {
      const offscreen = document.createElement("canvas");
      offscreen.width = piece.width;
      offscreen.height = piece.height;
      const ctx = offscreen.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(
        bitmap,
        piece.x,
        piece.y,
        piece.width,
        piece.height,
        0,
        0,
        piece.width,
        piece.height,
      );
      const dataUrl = offscreen.toDataURL("image/png");
      const layout = layouts[piece.row * cols + piece.col];
      if (!layout) continue;
      addNode({
        type: "image",
        title: `${liveTitle} 拆分 ${piece.row + 1}-${piece.col + 1}`,
        position: { x: layout.x, y: layout.y },
        size: { width: layout.width, height: layout.height },
        metadata: { content: dataUrl },
      });
    }

    closeCanvasDialog();
    toast.success(`已拆分为 ${totalPieces} 个节点`);
  }, [bitmap, rows, cols, nodeId, totalPieces]);

  // Grid line overlay divs (positioned using scaled coordinates)
  function renderGridLines() {
    if (!bitmap || !displayW || !displayH) return null;

    const lines: React.ReactNode[] = [];
    const baseW = Math.floor(bitmap.width / cols);
    const baseH = Math.floor(bitmap.height / rows);

    // Vertical lines (between columns)
    let xAcc = 0;
    for (let c = 0; c < cols - 1; c++) {
      xAcc += baseW;
      const xPx = Math.round(xAcc * scale);
      lines.push(
        <div
          key={`v-${c}`}
          style={{
            position: "absolute",
            left: xPx,
            top: 0,
            width: 1,
            height: displayH,
            background: "rgba(255,255,255,0.7)",
            pointerEvents: "none",
          }}
        />,
      );
    }

    // Horizontal lines (between rows)
    let yAcc = 0;
    for (let r = 0; r < rows - 1; r++) {
      yAcc += baseH;
      const yPx = Math.round(yAcc * scale);
      lines.push(
        <div
          key={`h-${r}`}
          style={{
            position: "absolute",
            left: 0,
            top: yPx,
            width: displayW,
            height: 1,
            background: "rgba(255,255,255,0.7)",
            pointerEvents: "none",
          }}
        />,
      );
    }

    return lines;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeCanvasDialog();
      }}
    >
      <DialogContent className="max-w-[760px] w-full" style={{ maxWidth: 760 }}>
        <DialogHeader>
          <DialogTitle>拆分图片</DialogTitle>
        </DialogHeader>
        <div data-canvas-split-dialog="true" className="px-6 pb-6">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-text-secondary">
              加载中…
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Preview area with grid overlay */}
              <div
                className="relative mx-auto overflow-hidden rounded-lg bg-surface-2"
                style={{ width: displayW, height: displayH }}
              >
                {objUrl ? (
                  <img
                    src={objUrl}
                    alt={srcTitle}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: displayW,
                      height: displayH,
                      userSelect: "none",
                      pointerEvents: "none",
                    }}
                    draggable={false}
                  />
                ) : null}
                {renderGridLines()}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-6 text-sm">
                <label className="flex items-center gap-2 text-text-primary">
                  行数
                  <input
                    type="number"
                    min={MIN_GRID}
                    max={MAX_GRID}
                    value={rows}
                    onChange={(e) => {
                      const v = Math.max(
                        MIN_GRID,
                        Math.min(
                          MAX_GRID,
                          Number.parseInt(e.target.value, 10) || 1,
                        ),
                      );
                      setRows(v);
                    }}
                    className="w-14 rounded border border-border bg-surface-1 px-2 py-1 text-center text-text-primary"
                  />
                </label>
                <label className="flex items-center gap-2 text-text-primary">
                  列数
                  <input
                    type="number"
                    min={MIN_GRID}
                    max={MAX_GRID}
                    value={cols}
                    onChange={(e) => {
                      const v = Math.max(
                        MIN_GRID,
                        Math.min(
                          MAX_GRID,
                          Number.parseInt(e.target.value, 10) || 1,
                        ),
                      );
                      setCols(v);
                    }}
                    className="w-14 rounded border border-border bg-surface-1 px-2 py-1 text-center text-text-primary"
                  />
                </label>
                <span className="text-text-secondary">
                  每块约 {pieceW} × {pieceH} px
                </span>

                <button
                  type="button"
                  data-canvas-split-confirm="true"
                  disabled={totalPieces === 1}
                  onClick={handleConfirm}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Grid3x3 size={14} />
                  拆分为 {totalPieces} 个节点
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
