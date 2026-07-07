import type { CanvasMirror } from "@nexu/shared";

/**
 * In-memory holder for the latest canvas snapshot the web frontend has pushed.
 *
 * S8 "chat drives the canvas": the canvas lives in the frontend; the nexu-canvas
 * runtime plugin's canvas_read reads this mirror over loopback HTTP so the agent
 * can see the current board before emitting ops. Single-user local model — one
 * active board, in-memory only, no persistence (a restart just resets to empty
 * until the frontend pushes again).
 */

function emptyMirror(): CanvasMirror {
  return {
    boardId: "sidebar",
    nodes: [],
    connections: [],
    viewport: { x: 0, y: 0, scale: 1 },
    selectedNodeIds: [],
  };
}

let currentMirror: CanvasMirror = emptyMirror();

/** Replace the current mirror with the latest frontend push (no merge). */
export function setCanvasMirror(mirror: CanvasMirror): void {
  currentMirror = mirror;
}

/** The latest pushed mirror, or the empty default before any push. */
export function getCanvasMirror(): CanvasMirror {
  return currentMirror;
}
