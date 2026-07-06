/**
 * Canvas geometry — pure, DOM-free.
 * All resize math lives here so it is unit-testable in the plain-node env.
 *
 * Semantics: dx/dy are world-coordinate pointer deltas from drag start.
 * The dragged corner moves with the pointer; the OPPOSITE corner stays fixed —
 * even when min-size clamping kicks in (clamping shrinks toward the dragged
 * corner, the opposite stays put).
 *
 * lockRatio: true — width is the driving axis.  Compute clamped width first,
 * then height = max(MIN_HEIGHT, width/ratio).  If height was clamped, recompute
 * width = height * ratio (both axes respect mins while keeping ratio).
 * Position compensation uses the FINAL width/height so the opposite corner
 * stays fixed.
 */

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export const NODE_MIN_WIDTH = 160;
export const NODE_MIN_HEIGHT = 80;

export interface ResizeGeometryInput {
  corner: ResizeCorner;
  origin: { x: number; y: number; width: number; height: number };
  dx: number;
  dy: number;
  lockRatio: boolean;
}

export interface ResizeGeometryResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute new position + size for a node being resized from one corner.
 *
 * Corner semantics:
 *   nw — left+top edge move;  se (right+bottom) corner is fixed.
 *   ne — right+top edge move; sw (left+bottom)  corner is fixed.
 *   sw — left+bottom edge move; ne (right+top)  corner is fixed.
 *   se — right+bottom edge move; nw (left+top)  corner is fixed.
 */
export function computeResizeGeometry(
  input: ResizeGeometryInput,
): ResizeGeometryResult {
  const { corner, origin, dx, dy, lockRatio } = input;

  // --- Step 1: compute raw (unclamped) dimensions based on which corner moves ---

  // For each axis, decide whether a positive delta grows or shrinks the node.
  // The "opposite fixed" rule means:
  //   nw/sw: left edge moves  → width  = origin.width  - dx  (dx>0 shrinks)
  //   ne/se: right edge moves → width  = origin.width  + dx  (dx>0 grows)
  //   nw/ne: top edge moves   → height = origin.height - dy  (dy>0 shrinks)
  //   sw/se: bottom edge moves→ height = origin.height + dy  (dy>0 grows)

  const rawWidth =
    corner === "nw" || corner === "sw" ? origin.width - dx : origin.width + dx;

  const rawHeight =
    corner === "nw" || corner === "ne"
      ? origin.height - dy
      : origin.height + dy;

  // --- Step 2: clamp to minimums (+ ratio logic) ---

  let finalWidth: number;
  let finalHeight: number;

  if (lockRatio) {
    const ratio = origin.height > 0 ? origin.width / origin.height : 1;
    // Width is the driving axis.
    const clampedWidth = Math.max(NODE_MIN_WIDTH, rawWidth);
    const derivedHeight = Math.max(NODE_MIN_HEIGHT, clampedWidth / ratio);
    // If height was clamped, recompute width to keep ratio.
    const recomputedWidth = derivedHeight * ratio;
    finalWidth = Math.max(NODE_MIN_WIDTH, recomputedWidth);
    finalHeight = derivedHeight;
    // Reconcile: if width got re-clamped, height follows again.
    if (finalWidth !== recomputedWidth) {
      finalHeight = Math.max(NODE_MIN_HEIGHT, finalWidth / ratio);
    }
  } else {
    finalWidth = Math.max(NODE_MIN_WIDTH, rawWidth);
    finalHeight = Math.max(NODE_MIN_HEIGHT, rawHeight);
  }

  // --- Step 3: position compensation (opposite corner stays fixed) ---

  // Pre-compute the fixed (opposite) corner's world position.
  // nw dragged → se stays fixed
  // ne dragged → sw stays fixed
  // sw dragged → ne stays fixed
  // se dragged → nw stays fixed

  let finalX: number;
  let finalY: number;

  if (corner === "nw") {
    // Fixed: se corner = (origin.x + origin.width, origin.y + origin.height)
    finalX = origin.x + origin.width - finalWidth;
    finalY = origin.y + origin.height - finalHeight;
  } else if (corner === "ne") {
    // Fixed: sw corner = (origin.x, origin.y + origin.height)
    finalX = origin.x;
    finalY = origin.y + origin.height - finalHeight;
  } else if (corner === "sw") {
    // Fixed: ne corner = (origin.x + origin.width, origin.y)
    finalX = origin.x + origin.width - finalWidth;
    finalY = origin.y;
  } else {
    // se: Fixed: nw corner = (origin.x, origin.y)
    finalX = origin.x;
    finalY = origin.y;
  }

  return { x: finalX, y: finalY, width: finalWidth, height: finalHeight };
}
