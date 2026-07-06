/**
 * split-upscale-math.ts — pure, DOM-free math for grid split and interpolation
 * upscale operations (W3.3+3.6a).
 *
 * All functions are deterministic and testable in plain node env.
 */

// ── gridPieceRects ──────────────────────────────────────────────────────────

export interface PieceRect {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute integer-exact tiling rectangles for an R×C grid split of an image.
 *
 * Tiling strategy:
 *   - Base piece width  = floor(imgW / cols)
 *   - Base piece height = floor(imgH / rows)
 *   - The LAST column absorbs the remaining horizontal pixels.
 *   - The LAST row    absorbs the remaining vertical pixels.
 *
 * This guarantees every pixel is covered exactly once with no gaps or overlap,
 * and all arithmetic stays integer (no floating-point rounding issues).
 *
 * Output is row-major order: row 0 first, within each row col 0 first.
 */
export function gridPieceRects(
  imgW: number,
  imgH: number,
  rows: number,
  cols: number,
): PieceRect[] {
  const baseW = Math.floor(imgW / cols);
  const baseH = Math.floor(imgH / rows);
  const result: PieceRect[] = [];

  let y = 0;
  for (let row = 0; row < rows; row++) {
    const height = row === rows - 1 ? imgH - y : baseH;
    let x = 0;
    for (let col = 0; col < cols; col++) {
      const width = col === cols - 1 ? imgW - x : baseW;
      result.push({ row, col, x, y, width, height });
      x += width;
    }
    y += height;
  }

  return result;
}

// ── splitChildLayout ────────────────────────────────────────────────────────

export interface ChildLayoutItem {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const CHILD_CELL_WIDTH = 180;
const CHILD_CELL_MIN_HEIGHT = 80;
const CHILD_CELL_MAX_HEIGHT = 320;
const CHILD_GAP = 20;

/**
 * Compute canvas node positions for split child nodes.
 *
 * The grid of child nodes starts immediately to the right of the source node
 * (src.x + src.width + 40, src.y). Children are laid out in row-major order
 * with a 20px gap on both axes.
 *
 * Each child node:
 *   - width:  180 (fixed)
 *   - height: clamp(180 / pieceAspect, 80, 320)
 *
 * pieceAspect = piece pixel width / piece pixel height (from gridPieceRects).
 */
export function splitChildLayout(
  src: { x: number; y: number; width: number; height: number },
  rows: number,
  cols: number,
  pieceAspect: number,
): ChildLayoutItem[] {
  const cellH = Math.round(
    Math.min(
      CHILD_CELL_MAX_HEIGHT,
      Math.max(CHILD_CELL_MIN_HEIGHT, CHILD_CELL_WIDTH / pieceAspect),
    ),
  );

  const gridStartX = src.x + src.width + 40;
  const gridStartY = src.y;

  const result: ChildLayoutItem[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      result.push({
        row,
        col,
        x: gridStartX + col * (CHILD_CELL_WIDTH + CHILD_GAP),
        y: gridStartY + row * (cellH + CHILD_GAP),
        width: CHILD_CELL_WIDTH,
        height: cellH,
      });
    }
  }

  return result;
}

// ── upscaleTargetSize ───────────────────────────────────────────────────────

/**
 * Compute the output dimensions for an interpolation upscale operation.
 *
 * Scales the image so its long edge equals `longEdge`, preserving aspect ratio
 * (rounds to nearest integer).
 *
 * Returns null when the image's long edge is ALREADY >= longEdge — this
 * prevents downscaling and no-ops from appearing as valid operations.
 */
export function upscaleTargetSize(
  imgW: number,
  imgH: number,
  longEdge: 1024 | 2048 | 4096,
): { width: number; height: number } | null {
  const currentLongEdge = Math.max(imgW, imgH);
  if (currentLongEdge >= longEdge) return null;

  const scale = longEdge / currentLongEdge;
  return {
    width: Math.round(imgW * scale),
    height: Math.round(imgH * scale),
  };
}
