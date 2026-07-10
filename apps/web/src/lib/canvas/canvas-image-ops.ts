/**
 * canvas-image-ops.ts — headless crop/split/upscale appliers (W6, image-ops A).
 *
 * These run in the browser (real canvas). Each applier is SELF-CONTAINED: it
 * reads the source node from the store by id, loads its own bitmap, draws to an
 * offscreen canvas, and adds the resulting node(s) — no dialog, no component
 * state. This lets both the interactive dialogs AND a headless chat op drive the
 * exact same image operations.
 *
 * The offscreen-draw path is NOT unit-tested in the node env (no canvas) — same
 * convention as the dialogs. Only the pure clampCropRect helper is testable.
 */

import { type CanvasNode, addNode, getCanvasState } from "./canvas-store";
import type { CropBox } from "./crop-geometry";
import { loadImageBitmap } from "./load-image-bitmap";
import {
  type PieceRect,
  cutPieceRects,
  gridPieceRects,
  splitChildLayout,
  upscaleTargetSize,
} from "./split-upscale-math";

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Clamp a crop rect (image px) into `[0,0,width,height]` bitmap bounds.
 * Pure — the only part of this module testable in a node env. A rect already
 * inside bounds passes through unchanged, so the dialog path is a no-op.
 */
export function clampCropRect(rect: CropBox, bounds: CropBox): CropBox {
  const x = Math.min(Math.max(0, rect.x), bounds.width);
  const y = Math.min(Math.max(0, rect.y), bounds.height);
  const width = Math.min(Math.max(0, rect.width), bounds.width - x);
  const height = Math.min(Math.max(0, rect.height), bounds.height - y);
  return { x, y, width, height };
}

function longEdgeLabel(le: 1024 | 2048 | 4096): string {
  if (le === 1024) return "1K";
  if (le === 2048) return "2K";
  return "4K";
}

// ── applyCrop ────────────────────────────────────────────────────────────────

/**
 * Crop the source node's image to `rect` (image px, clamped into bounds) and add
 * a `${title} 裁剪` image node to the right of the source. Returns the new node,
 * or null on missing node/content/canvas-context.
 */
export async function applyCrop(
  nodeId: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<CanvasNode | null> {
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  const content = node?.metadata.content;
  if (!node || !content) return null;

  const { bitmap, objectUrl } = await loadImageBitmap(content);
  try {
    const box = clampCropRect(rect, {
      x: 0,
      y: 0,
      width: bitmap.width,
      height: bitmap.height,
    });
    const offscreen = document.createElement("canvas");
    offscreen.width = Math.round(box.width);
    offscreen.height = Math.round(box.height);
    const ctx = offscreen.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      bitmap,
      Math.round(box.x),
      Math.round(box.y),
      Math.round(box.width),
      Math.round(box.height),
      0,
      0,
      Math.round(box.width),
      Math.round(box.height),
    );
    const dataUrl = offscreen.toDataURL("image/png");
    // Read node live so a title rename between op-issue and apply is reflected.
    const src = getCanvasState().nodes.find((n) => n.id === nodeId);
    const liveTitle = src?.title ?? "图片";
    return addNode({
      type: "image",
      title: `${liveTitle} 裁剪`,
      position: src
        ? { x: src.position.x + src.size.width + 40, y: src.position.y }
        : undefined,
      metadata: { content: dataUrl },
    });
  } finally {
    bitmap.close();
    URL.revokeObjectURL(objectUrl);
  }
}

// ── applySplit ───────────────────────────────────────────────────────────────

/**
 * Shared tail of both split appliers. Given the pre-computed piece rects (from
 * `gridPieceRects` for the uniform path or `cutPieceRects` for the draggable-cut
 * path) plus the grid shape (`rows`/`cols`, for child layout and the `r-c`
 * titles), draw each piece to an offscreen canvas and add a titled child image
 * node. Reads the source node live so a title rename between op-issue and apply
 * is reflected. Returns the created child nodes.
 */
function addSplitPieceNodes(
  nodeId: string,
  bitmap: ImageBitmap,
  pieces: PieceRect[],
  rows: number,
  cols: number,
): CanvasNode[] {
  const pieceAspect =
    pieces[0] && pieces[0].height > 0 ? pieces[0].width / pieces[0].height : 1;

  // Read node live so a title rename between op-issue and apply is reflected.
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

  const created: CanvasNode[] = [];
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
    created.push(
      addNode({
        type: "image",
        title: `${liveTitle} 拆分 ${piece.row + 1}-${piece.col + 1}`,
        position: { x: layout.x, y: layout.y },
        size: { width: layout.width, height: layout.height },
        metadata: { content: dataUrl },
      }),
    );
  }
  return created;
}

/**
 * Split the source node's image into a `rows`×`cols` grid (each clamped to
 * [1,12]) of child image nodes titled `${title} 拆分 r-c`. Returns the created
 * child nodes (empty array on missing node/content).
 *
 * This is the uniform-grid path and the agent `split_image` op path — its
 * signature is a contract; do not change it.
 */
export async function applySplit(
  nodeId: string,
  rows: number,
  cols: number,
): Promise<CanvasNode[]> {
  const clampedRows = Math.max(1, Math.min(12, rows));
  const clampedCols = Math.max(1, Math.min(12, cols));

  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  const content = node?.metadata.content;
  if (!node || !content) return [];

  const { bitmap, objectUrl } = await loadImageBitmap(content);
  try {
    const pieces = gridPieceRects(
      bitmap.width,
      bitmap.height,
      clampedRows,
      clampedCols,
    );
    return addSplitPieceNodes(nodeId, bitmap, pieces, clampedRows, clampedCols);
  } finally {
    bitmap.close();
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Split the source node's image at explicit interior cut positions (image px)
 * into non-uniform child image nodes titled `${title} 拆分 r-c`. Derives the grid
 * shape from the cut counts (`rows = yCuts.length + 1`, `cols = xCuts.length + 1`)
 * and delegates tiling to `cutPieceRects`. Returns the created child nodes (empty
 * array on missing node/content).
 *
 * This is the interactive split dialog's draggable-line path. The uniform agent
 * op path stays on {@link applySplit}.
 */
export async function applySplitAtCuts(
  nodeId: string,
  xCuts: number[],
  yCuts: number[],
): Promise<CanvasNode[]> {
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  const content = node?.metadata.content;
  if (!node || !content) return [];

  const { bitmap, objectUrl } = await loadImageBitmap(content);
  try {
    const pieces = cutPieceRects(bitmap.width, bitmap.height, xCuts, yCuts);
    return addSplitPieceNodes(
      nodeId,
      bitmap,
      pieces,
      yCuts.length + 1,
      xCuts.length + 1,
    );
  } finally {
    bitmap.close();
    URL.revokeObjectURL(objectUrl);
  }
}

// ── applyUpscaleInterpolate ──────────────────────────────────────────────────

/**
 * Upscale the source node's image to `targetLongEdge` via single-pass Canvas
 * interpolation (`algorithm` maps smoothing: high→enabled+quality "high";
 * low→enabled+quality "low"; pixel→disabled) and add a `${title} 放大<档位>`
 * node to the right of the source. Returns the new node, or null when the image
 * is already ≥ target (upscaleTargetSize null) or content/context is missing.
 */
export async function applyUpscaleInterpolate(
  nodeId: string,
  targetLongEdge: 1024 | 2048 | 4096,
  algorithm: "high" | "low" | "pixel",
): Promise<CanvasNode | null> {
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  const content = node?.metadata.content;
  if (!node || !content) return null;

  const { bitmap, objectUrl } = await loadImageBitmap(content);
  try {
    const targetSize = upscaleTargetSize(
      bitmap.width,
      bitmap.height,
      targetLongEdge,
    );
    if (!targetSize) return null;

    const { width: outW, height: outH } = targetSize;
    const offscreen = document.createElement("canvas");
    offscreen.width = outW;
    offscreen.height = outH;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return null;

    // Apply smoothing settings
    if (algorithm === "pixel") {
      ctx.imageSmoothingEnabled = false;
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = algorithm === "high" ? "high" : "low";
    }

    ctx.drawImage(bitmap, 0, 0, outW, outH);
    const dataUrl = offscreen.toDataURL("image/png");

    // Read node live so a title rename between op-issue and apply is reflected.
    const src = getCanvasState().nodes.find((n) => n.id === nodeId);
    const liveTitle = src?.title ?? "图片";
    const srcSize = src?.size ?? { width: 340, height: 240 };

    return addNode({
      type: "image",
      title: `${liveTitle} 放大${longEdgeLabel(targetLongEdge)}`,
      position: src
        ? { x: src.position.x + src.size.width + 40, y: src.position.y }
        : undefined,
      size: srcSize,
      metadata: { content: dataUrl },
    });
  } finally {
    bitmap.close();
    URL.revokeObjectURL(objectUrl);
  }
}
