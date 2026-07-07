/**
 * canvas-minimap.tsx — Minimap overlay for the canvas sidebar (W4.1).
 *
 * Adaptation note: the reference minimap is 240×160 on a full-page canvas.
 * Our sidebar canvas is narrower, so we use 200×132.
 *
 * Rendered from CanvasSurface as screen-space chrome inside the container
 * root (same mount point as the toolbar). Subscribes to canvas-store and
 * canvas-ui-prefs; no per-frame listeners. stopPropagation on all pointer
 * events so minimap clicks never start canvas gestures.
 *
 * Click behavior: maps the click point to world coordinates and calls
 * setViewport to center that world point at the current zoom.
 */

import { isHiddenBatchChild } from "./canvas-batch";
import { getCanvasState, setViewport, useCanvas } from "./canvas-store";
import { useCanvasUiPrefs } from "./canvas-ui-prefs";
import {
  minimapLayout,
  minimapPointToWorld,
  worldBoundsOf,
} from "./minimap-math";

const MINI_W = 200;
const MINI_H = 132;

/** Color of each node type in the minimap (Tailwind JIT-safe class literals). */
function nodeRectClass(type: string): string {
  switch (type) {
    case "image":
      return "bg-sky-400/70";
    case "text":
      return "bg-amber-400/70";
    case "video":
      return "bg-emerald-400/70";
    case "audio":
      return "bg-teal-400/70";
    case "config":
      return "bg-violet-400/70";
    case "a2ui":
      return "bg-slate-400/70";
    case "team-step":
      return "bg-rose-400/70";
    default:
      return "bg-slate-400/70";
  }
}

export function CanvasMinimap({
  getContainerSize,
}: {
  getContainerSize: () => { width: number; height: number };
}) {
  const { nodes, viewport } = useCanvas();
  const { minimapVisible } = useCanvasUiPrefs();

  // Only render visible nodes (skip hidden batch children)
  const visibleNodes = nodes.filter((n) => !isHiddenBatchChild(n, nodes));

  if (!minimapVisible || visibleNodes.length === 0) {
    return null;
  }

  const { width: containerW, height: containerH } = getContainerSize();

  // Viewport rect expressed in world coordinates
  const viewportRect = {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    width: containerW / viewport.scale,
    height: containerH / viewport.scale,
  };

  const bounds = worldBoundsOf(visibleNodes, viewportRect);
  if (!bounds) return null;

  const layout = minimapLayout(bounds, { width: MINI_W, height: MINI_H });

  // Map a node rect to mini px coords
  function toMini(
    worldX: number,
    worldY: number,
    worldW: number,
    worldH: number,
  ) {
    const left = (worldX - layout.offsetX) * layout.scale;
    const top = (worldY - layout.offsetY) * layout.scale;
    const width = Math.max(2, worldW * layout.scale);
    const height = Math.max(2, worldH * layout.scale);
    return { left, top, width, height };
  }

  // Viewport outline in mini coords
  const vp = toMini(
    viewportRect.x,
    viewportRect.y,
    viewportRect.width,
    viewportRect.height,
  );

  function navigateToMiniPoint(
    clientX: number,
    clientY: number,
    currentTarget: Element,
  ) {
    const rect = currentTarget.getBoundingClientRect();
    const miniX = clientX - rect.left;
    const miniY = clientY - rect.top;
    const world = minimapPointToWorld({ x: miniX, y: miniY }, layout);
    const { width: cw, height: ch } = getContainerSize();
    const live = getCanvasState().viewport;
    setViewport({
      scale: live.scale,
      x: cw / 2 - world.x * live.scale,
      y: ch / 2 - world.y * live.scale,
    });
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: minimap is a screen-space navigation aid; keyboard navigation uses toolbar Fit button instead
    <div
      data-canvas-minimap="true"
      className="absolute bottom-3 left-3 z-30 overflow-hidden rounded-lg border border-border bg-surface-1/90 shadow-md"
      style={{ width: MINI_W, height: MINI_H }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) =>
        navigateToMiniPoint(event.clientX, event.clientY, event.currentTarget)
      }
    >
      {/* Node rectangles */}
      {visibleNodes.map((node) => {
        const { left, top, width, height } = toMini(
          node.position.x,
          node.position.y,
          node.size.width,
          node.size.height,
        );
        return (
          <div
            key={node.id}
            data-canvas-minimap-node={node.id}
            className={`absolute rounded-[1px] ${nodeRectClass(node.type)}`}
            style={{ left, top, width, height }}
          />
        );
      })}

      {/* Viewport outline */}
      <div
        data-canvas-minimap-viewport="true"
        className="pointer-events-none absolute rounded-[2px] border border-sky-400 bg-sky-400/10"
        style={{
          left: vp.left,
          top: vp.top,
          width: vp.width,
          height: vp.height,
        }}
      />
    </div>
  );
}
