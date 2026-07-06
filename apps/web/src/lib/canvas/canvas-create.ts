/**
 * canvas-create.ts
 *
 * Pure store-level helper for creating a new node connected to a source
 * (plan item W1.9: drop connection on empty canvas → create-node menu).
 */

import {
  type CanvasNode,
  NODE_DEFAULT_SIZES,
  addNode,
  connectNodes,
  getCanvasState,
} from "./canvas-store";

type CreatableType = "text" | "image" | "video" | "audio";

const TYPE_TITLES: Record<CreatableType, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
};

/**
 * Create a new node of `type`, positioned so its left-edge midpoint lands at
 * `at`, then connect `fromId` → new node.
 *
 * Returns null without creating anything if `fromId` no longer exists in the
 * store (e.g. was deleted between gesture start and menu close).
 */
export function createConnectedNode(
  fromId: string,
  type: CreatableType,
  at: { x: number; y: number },
): CanvasNode | null {
  const exists = getCanvasState().nodes.some((n) => n.id === fromId);
  if (!exists) return null;

  const { height } = NODE_DEFAULT_SIZES[type];
  const position = {
    x: at.x,
    y: at.y - height / 2,
  };

  const newNode = addNode({
    type,
    title: TYPE_TITLES[type],
    position,
  });

  connectNodes(fromId, newNode.id);

  return newNode;
}
