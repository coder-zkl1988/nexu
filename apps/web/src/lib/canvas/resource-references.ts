/**
 * resource-references.ts
 *
 * Pull-side semantics for canvas generation inputs (W2.1).
 *
 * An edge INTO a node means "this feeds your generation." When a node generates,
 * everything connected UPSTREAM feeds it:
 *  - text  → prompt context
 *  - image → reference images
 *  - video → reference media
 *  - audio → reference media
 *
 * @see connection-effects.ts for push-on-connect effects (a different concern).
 */

import { getCanvasState } from "./canvas-store";

// ── Types ──────────────────────────────────────────────────────

export type UpstreamResources = {
  prompts: string[];
  images: string[];
  videos: string[];
  audios: string[];
};

// ── Public API ─────────────────────────────────────────────────

/**
 * Collect all resources reachable upstream of `nodeId` via BFS over
 * incoming edges (connections whose `toNodeId` === `nodeId`).
 *
 * Visit order:
 *  - Direct upstream first (level by level).
 *  - Within a level: order connections appear in `state.connections`.
 *  - Dedupe visited node ids; cycle-safe via visited set.
 *  - The starting node itself is NOT included.
 *
 * Per-node type mapping:
 *  - `text`  with non-empty trimmed `metadata.content` → `prompts`
 *  - `image` with non-empty `metadata.content`         → `images`
 *  - `video` with non-empty `metadata.content`         → `videos`
 *  - `audio` with non-empty `metadata.content`         → `audios`
 *  - `a2ui` / `team-step` contribute nothing (but ancestors still traversed)
 */
export function collectUpstream(nodeId: string): UpstreamResources {
  const { nodes, connections } = getCanvasState();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const result: UpstreamResources = {
    prompts: [],
    images: [],
    videos: [],
    audios: [],
  };

  const visited = new Set<string>();
  visited.add(nodeId); // exclude starting node

  // BFS queue — start with direct parents
  const queue: string[] = [];
  for (const conn of connections) {
    if (conn.toNodeId === nodeId && !visited.has(conn.fromNodeId)) {
      visited.add(conn.fromNodeId);
      queue.push(conn.fromNodeId);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const currentId = queue[head++] as string;
    const node = nodeById.get(currentId);
    if (!node) continue;

    // Collect resource from this node
    const content = node.metadata.content ?? "";
    if (node.type === "text") {
      if (content.trim() !== "") {
        result.prompts.push(content);
      }
    } else if (node.type === "image") {
      if (content !== "") {
        result.images.push(content);
      }
    } else if (node.type === "video") {
      if (content !== "") {
        result.videos.push(content);
      }
    } else if (node.type === "audio") {
      if (content !== "") {
        result.audios.push(content);
      }
    }
    // a2ui and team-step: contribute nothing, but their parents are still queued below

    // Enqueue unvisited parents (incoming edges to currentId)
    for (const conn of connections) {
      if (conn.toNodeId === currentId && !visited.has(conn.fromNodeId)) {
        visited.add(conn.fromNodeId);
        queue.push(conn.fromNodeId);
      }
    }
  }

  return result;
}

/**
 * Cheap check: does any connection point INTO `nodeId`?
 * Use this to guard generation before calling `collectUpstream`.
 */
export function hasUpstream(nodeId: string): boolean {
  const { connections } = getCanvasState();
  return connections.some((conn) => conn.toNodeId === nodeId);
}
