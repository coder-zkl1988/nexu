/**
 * minimap-math.ts — Pure math utilities for the canvas minimap (W4.1).
 *
 * World-to-mini mapping: mini = (world - offset) * scale
 * Inverse: world = mini / scale + offset
 */

export type MinimapLayout = {
  /** world→mini scale factor */
  scale: number;
  /** world X that maps to mini x=0 */
  offsetX: number;
  /** world Y that maps to mini y=0 */
  offsetY: number;
};

/**
 * Compute a MinimapLayout that fits `worldBounds` into the `mini` box,
 * preserving aspect ratio and centering the content. Padding shrinks the
 * available area on all sides.
 *
 * Degenerate bounds (zero width or height) → scale clamped to max 1, no NaN.
 */
export function minimapLayout(
  worldBounds: { minX: number; minY: number; maxX: number; maxY: number },
  mini: { width: number; height: number },
  padding = 8,
): MinimapLayout {
  const worldW = worldBounds.maxX - worldBounds.minX;
  const worldH = worldBounds.maxY - worldBounds.minY;

  const availW = Math.max(1, mini.width - padding * 2);
  const availH = Math.max(1, mini.height - padding * 2);

  // Compute fit scale — clamp to 1 max for degenerate zero-size inputs.
  let scale: number;
  if (worldW <= 0 || worldH <= 0) {
    scale = Math.min(1, availW, availH);
  } else {
    scale = Math.min(availW / worldW, availH / worldH);
  }

  // Size of the world content in mini pixels
  const scaledW = worldW <= 0 ? 0 : worldW * scale;
  const scaledH = worldH <= 0 ? 0 : worldH * scale;

  // Center the content in the available box, then add padding offset
  const contentLeft = padding + (availW - scaledW) / 2;
  const contentTop = padding + (availH - scaledH) / 2;

  // offsetX: the world X value that should appear at mini x=0
  //   mini_x = (world_x - offsetX) * scale
  //   at world_x = worldBounds.minX, mini_x = contentLeft
  //   → contentLeft = (worldBounds.minX - offsetX) * scale
  //   → offsetX = worldBounds.minX - contentLeft / scale
  const offsetX = worldBounds.minX - contentLeft / scale;
  const offsetY = worldBounds.minY - contentTop / scale;

  return { scale, offsetX, offsetY };
}

/**
 * Union of all node rectangles and (optionally) a viewport rect.
 * Returns null when there are no inputs at all.
 */
export function worldBoundsOf(
  nodes: ReadonlyArray<{
    position: { x: number; y: number };
    size: { width: number; height: number };
  }>,
  viewportRect: { x: number; y: number; width: number; height: number } | null,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.size.width);
    maxY = Math.max(maxY, node.position.y + node.size.height);
  }

  if (viewportRect !== null) {
    minX = Math.min(minX, viewportRect.x);
    minY = Math.min(minY, viewportRect.y);
    maxX = Math.max(maxX, viewportRect.x + viewportRect.width);
    maxY = Math.max(maxY, viewportRect.y + viewportRect.height);
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Inverse of the world→mini mapping. Given a point in mini coordinates,
 * returns the corresponding world coordinates.
 *
 *   world = mini / scale + offset
 */
export function minimapPointToWorld(
  point: { x: number; y: number },
  layout: MinimapLayout,
): { x: number; y: number } {
  return {
    x: point.x / layout.scale + layout.offsetX,
    y: point.y / layout.scale + layout.offsetY,
  };
}
