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

type CreatableType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "config"
  | "xhs"
  | "phone";

const TYPE_TITLES: Record<CreatableType, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
  config: "生成配置",
  xhs: "小红书帖子",
  phone: "手机预览",
};

/**
 * Create a new node of `type`, positioned so its left-edge midpoint lands at
 * `at`, then connect it to `fromId`.
 *
 * `handleType` mirrors which connect handle the drag started from: "source"
 * (the default, right-side handle) connects fromId → new node; "target"
 * (left-side handle — dragged out looking for an upstream feed) connects
 * new node → fromId.
 *
 * Returns null without creating anything if `fromId` no longer exists in the
 * store (e.g. was deleted between gesture start and menu close).
 */
export function createConnectedNode(
  fromId: string,
  type: CreatableType,
  at: { x: number; y: number },
  handleType: "source" | "target" = "source",
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
    // Config nodes need a default mode so the UI has a valid state immediately.
    ...(type === "config"
      ? { metadata: { config: { mode: "image" as const } } }
      : type === "xhs"
        ? {
            metadata: {
              xhs: { title: "", content: "", images: [], hashtags: [] },
            },
          }
        : type === "phone"
          ? { metadata: { phone: {} } }
          : {}),
  });

  if (handleType === "source") {
    connectNodes(fromId, newNode.id);
  } else {
    connectNodes(newNode.id, fromId);
  }

  return newNode;
}
