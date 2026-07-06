/**
 * text-node-utils.ts — pure helpers for text canvas nodes (W3.4).
 *
 * Kept side-effect free so every export is directly testable without
 * a DOM or React environment.
 */

import { createConnectedNode } from "./canvas-create";
import { generateImageIntoNode } from "./canvas-generation";
import { getCanvasState } from "./canvas-store";

// ── Font size constants ────────────────────────────────────────

export const TEXT_FONT_MIN = 10;
export const TEXT_FONT_MAX = 48;
export const TEXT_FONT_STEP = 2;

/**
 * Compute the next font size in the given direction, starting from
 * `current` (defaulting to 14 if undefined), stepped by TEXT_FONT_STEP,
 * and clamped to [TEXT_FONT_MIN, TEXT_FONT_MAX].
 */
export function nextFontSize(
  current: number | undefined,
  direction: 1 | -1,
): number {
  const base = current ?? 14;
  const next = base + direction * TEXT_FONT_STEP;
  return Math.min(TEXT_FONT_MAX, Math.max(TEXT_FONT_MIN, next));
}

// ── To-image flow ──────────────────────────────────────────────

/**
 * Convert a text node into a prompt for a connected image generation.
 *
 * 1. Looks up the node by `nodeId`; returns false if missing.
 * 2. Trims content; returns false if empty.
 * 3. Creates a connected image node at the text node's right-edge midpoint + 60px gap.
 * 4. Dispatches generateImageIntoNode (fire-and-forget) with the trimmed text.
 * 5. Returns true on success, false if createConnectedNode returned null.
 *
 * Exported so the hover toolbar button's click handler is directly testable.
 */
export function textNodeToImage(nodeId: string): boolean {
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  if (!node) return false;

  const content = (node.metadata.content ?? "").trim();
  if (!content) return false;

  const at = {
    x: node.position.x + node.size.width + 60,
    y: node.position.y + node.size.height / 2,
  };

  const newNode = createConnectedNode(nodeId, "image", at);
  if (!newNode) return false;

  void generateImageIntoNode(newNode.id, content);
  return true;
}
