/**
 * crop-geometry.ts — pure, DOM-free crop math (W3.2).
 *
 * All coordinates are in IMAGE pixels.
 *
 * Drag semantics mirror canvas-geometry's computeResizeGeometry:
 * - Edge/corner handles: the OPPOSITE edge(s) stay fixed.
 * - move handle: translate, clamped inside bounds.
 * - lockRatio applies to CORNER handles only (width-driven, same discipline
 *   as computeResizeGeometry). Edge handles always ignore lockRatio.
 * - Minimum box size: 16×16 (or minSize if provided).
 * - All results are clamped inside bounds.
 */

export type CropBox = { x: number; y: number; width: number; height: number };

export type CropHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "move";

const CORNER_HANDLES = new Set<CropHandle>(["nw", "ne", "sw", "se"]);

/**
 * Apply a single drag step to a crop box.
 *
 * @param input.handle  - which handle is being dragged
 * @param input.box     - box at drag start (ratio is computed from this)
 * @param input.dx      - world-px delta X (raw, not yet scaled)
 * @param input.dy      - world-px delta Y
 * @param input.bounds  - image dimensions that contain the crop box
 * @param input.lockRatio - lock width/height ratio (corners only)
 * @param input.minSize - minimum side length (default 16)
 */
export function applyCropDrag(input: {
  handle: CropHandle;
  box: CropBox;
  dx: number;
  dy: number;
  bounds: { width: number; height: number };
  lockRatio: boolean;
  minSize?: number;
}): CropBox {
  const { handle, box, dx, dy, bounds, lockRatio, minSize = 16 } = input;
  const { x, y, width, height } = box;

  if (handle === "move") {
    const newX = Math.min(Math.max(0, x + dx), bounds.width - width);
    const newY = Math.min(Math.max(0, y + dy), bounds.height - height);
    return { x: newX, y: newY, width, height };
  }

  // Determine which edges move based on handle
  const movesLeft = handle === "nw" || handle === "sw" || handle === "w";
  const movesRight = handle === "ne" || handle === "se" || handle === "e";
  const movesTop = handle === "nw" || handle === "ne" || handle === "n";
  const movesBottom = handle === "sw" || handle === "se" || handle === "s";

  // Fixed anchor (opposite edge)
  const fixedRight = x + width; // fixed when left edge moves
  const fixedBottom = y + height; // fixed when top edge moves
  const fixedLeft = x; // fixed when right edge moves
  const fixedTop = y; // fixed when bottom edge moves

  // Compute raw new dimensions
  let rawWidth: number;
  let rawHeight: number;
  let newX: number;
  let newY: number;

  if (movesLeft) {
    rawWidth = width - dx;
    newX = fixedRight - rawWidth; // keep right fixed
  } else if (movesRight) {
    rawWidth = width + dx;
    newX = fixedLeft; // keep left fixed
  } else {
    rawWidth = width;
    newX = x;
  }

  if (movesTop) {
    rawHeight = height - dy;
    newY = fixedBottom - rawHeight; // keep bottom fixed
  } else if (movesBottom) {
    rawHeight = height + dy;
    newY = fixedTop; // keep top fixed
  } else {
    rawHeight = height;
    newY = y;
  }

  // Apply lockRatio for corner handles only (width-driven, same as canvas-geometry)
  const isCorner = CORNER_HANDLES.has(handle);
  let finalWidth: number;
  let finalHeight: number;

  if (lockRatio && isCorner) {
    const ratio = height > 0 ? width / height : 1;
    const clampedWidth = Math.max(minSize, rawWidth);
    const derivedHeight = Math.max(minSize, clampedWidth / ratio);
    const recomputedWidth = derivedHeight * ratio;
    finalWidth = Math.max(minSize, recomputedWidth);
    finalHeight = derivedHeight;
  } else {
    finalWidth = Math.max(minSize, rawWidth);
    finalHeight = Math.max(minSize, rawHeight);
  }

  // Recompute position with clamped dimensions (keep opposite edge fixed)
  if (movesLeft) {
    newX = fixedRight - finalWidth;
  } else if (movesRight) {
    newX = fixedLeft;
  }

  if (movesTop) {
    newY = fixedBottom - finalHeight;
  } else if (movesBottom) {
    newY = fixedTop;
  }

  // Clamp box inside bounds
  const clampedX = Math.max(0, Math.min(bounds.width - finalWidth, newX));
  const clampedY = Math.max(0, Math.min(bounds.height - finalHeight, newY));
  const clampedWidth = Math.min(finalWidth, bounds.width - clampedX);
  const clampedHeight = Math.min(finalHeight, bounds.height - clampedY);

  return {
    x: clampedX,
    y: clampedY,
    width: Math.max(minSize, clampedWidth),
    height: Math.max(minSize, clampedHeight),
  };
}

/**
 * Compute the display scale to fit an image into a max bounding box.
 * Never upscales beyond 1.
 */
export function fitScale(
  imgW: number,
  imgH: number,
  maxW: number,
  maxH: number,
): number {
  return Math.min(maxW / imgW, maxH / imgH, 1);
}
