/**
 * canvas-mirror.ts
 *
 * S8 "chat drives the canvas" (W4.5b) — the frontend half of the mirror.
 *
 * The agent runs in the OpenClaw runtime and cannot see the canvas directly.
 * The frontend PUSHES a compact snapshot of the active board to the controller
 * mirror; the nexu-canvas plugin's canvas_read reads it back. Without this push
 * the agent's canvas_read would see stale/empty state and target the wrong
 * nodes.
 *
 * Contract: {@link CanvasMirror} in @nexu/shared. This module only reads the
 * store + boards index and calls the mirror SDK. Errors are swallowed — a
 * failed push must NEVER disrupt the canvas.
 */

import type { CanvasMirror } from "@nexu/shared";
import { postApiV1CanvasMirror } from "../../../lib/api/sdk.gen";
import { getCanvasAssets } from "./canvas-assets";
import { isHiddenBatchChild } from "./canvas-batch";
import { getCanvasBoards } from "./canvas-boards";
import { getCanvasState } from "./canvas-store";

/** Trailing debounce for the change-driven pusher (covers drag bursts). */
const PUSH_DEBOUNCE_MS = 800;

/**
 * Build the compact mirror from the live store + active board.
 *
 * Hidden batch children are skipped — they are not visible on the board, so the
 * agent should not see (or target) them. Node position/size are flattened to
 * x/y/w/h; `hasContent` reports whether the node holds renderable content.
 */
export function buildCanvasMirror(): CanvasMirror {
  const state = getCanvasState();
  const boardId = readActiveBoardId();

  const nodes: CanvasMirror["nodes"] = state.nodes
    .filter((node) => !isHiddenBatchChild(node, state.nodes))
    .map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      x: node.position.x,
      y: node.position.y,
      w: node.size.width,
      h: node.size.height,
      hasContent: Boolean(node.metadata.content),
    }));

  return {
    boardId,
    nodes,
    connections: state.connections.map((connection) => ({
      id: connection.id,
      from: connection.fromNodeId,
      to: connection.toNodeId,
    })),
    viewport: {
      x: state.viewport.x,
      y: state.viewport.y,
      scale: state.viewport.scale,
    },
    selectedNodeIds: [...state.selectedNodeIds],
    // Compact asset list (id/kind/title/tags — no content) so the agent can
    // reference saved assets with insert_asset and reuse existing tags.
    assets: getCanvasAssets()
      .assets.slice(0, 2000)
      .map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        title: asset.title,
        ...(asset.tags && asset.tags.length > 0 ? { tags: asset.tags } : {}),
      })),
  };
}

function readActiveBoardId(): string {
  try {
    return getCanvasBoards().activeId;
  } catch {
    return "sidebar";
  }
}

let warnedOnce = false;

/**
 * Push the current mirror to the controller. Fire-and-forget: all failures are
 * swallowed (at most one console.warn per session) so a mirror outage never
 * breaks canvas interaction.
 */
export async function pushCanvasMirror(): Promise<void> {
  try {
    await postApiV1CanvasMirror({ body: buildCanvasMirror() });
  } catch (error) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        "[canvas-mirror] push failed (further errors suppressed)",
        error,
      );
    }
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a trailing-debounced mirror push. Call on nodes/connections/
 * viewport/selection change; a synchronous burst coalesces into one push.
 * Kept OFF the rAF gesture path — the debounce absorbs drag frames.
 */
export function scheduleCanvasMirrorPush(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
  }
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushCanvasMirror();
  }, PUSH_DEBOUNCE_MS);
}

/** Test-only: clear the pending debounce timer. */
export function __resetCanvasMirrorForTests(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  warnedOnce = false;
}
