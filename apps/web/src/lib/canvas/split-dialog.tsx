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
import { applySplit } from "./canvas-image-ops";
import { getCanvasState } from "./canvas-store";
import { fitScale } from "./crop-geometry";
import { loadImageBitmap } from "./load-image-bitmap";
import { gridPieceRects } from "./split-upscale-math";

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

  // Confirm: delegate to the headless applier, then toast + close
  const handleConfirm = useCallback(async () => {
    if (!bitmap) return;
    await applySplit(nodeId, rows, cols);
    closeCanvasDialog();
    toast.success(`已拆分为 ${totalPieces} 个节点`);
  }, [bitmap, rows, cols, nodeId, totalPieces]);

  // Grid line overlay divs (positioned using actual cut boundaries from gridPieceRects)
  function renderGridLines() {
    if (!bitmap || !displayW || !displayH) return null;

    const rects = gridPieceRects(bitmap.width, bitmap.height, rows, cols);

    // Collect unique x positions where col > 0 (vertical lines between columns)
    const verticalXs = new Set<number>();
    for (const rect of rects) {
      if (rect.col > 0) {
        verticalXs.add(Math.round(rect.x * scale));
      }
    }

    // Collect unique y positions where row > 0 (horizontal lines between rows)
    const horizontalYs = new Set<number>();
    for (const rect of rects) {
      if (rect.row > 0) {
        horizontalYs.add(Math.round(rect.y * scale));
      }
    }

    const lines: React.ReactNode[] = [];

    // Vertical lines
    let vLineIdx = 0;
    for (const xPx of verticalXs) {
      lines.push(
        <div
          key={`v-${vLineIdx++}`}
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

    // Horizontal lines
    let hLineIdx = 0;
    for (const yPx of horizontalYs) {
      lines.push(
        <div
          key={`h-${hLineIdx++}`}
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
