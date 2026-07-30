/**
 * canvas-clipboard.ts
 *
 * Internal node clipboard for copy/paste/duplicate — plan items W1.4.
 * Module singleton (same style as canvas-store). No OS clipboard access.
 *
 * Copy filter: content nodes only ("text" | "image" | "video" | "audio").
 * a2ui nodes are excluded because removeNodes deletes the a2ui payload by
 * surfaceId — two nodes sharing one surfaceId would break each other on delete.
 * team-step nodes are excluded because they reference live board state.
 */

import {
  type CanvasConnection,
  type CanvasNode,
  type CanvasNodeMetadata,
  addNode,
  connectNodes,
  genId,
  getCanvasState,
  selectNodes,
} from "./canvas-store";

// ── Types ──────────────────────────────────────────────────────

/** Node types that are safe to copy (deep-copy of data, no runtime references). */
const COPYABLE_TYPES = new Set<CanvasNode["type"]>([
  "text",
  "image",
  "video",
  "audio",
  "config",
  "xhs",
  "phone",
  "group",
]);

type ClipboardEntry = {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  /** Paste count since this copy — used for the +36*n offset. */
  pasteCount: number;
};

// ── Singleton state ────────────────────────────────────────────

let clipboard: ClipboardEntry | null = null;

// ── Helpers ────────────────────────────────────────────────────

function deepCopyNode(node: CanvasNode): CanvasNode {
  // Omit surfaceId to prevent two nodes sharing the same a2ui payload
  // (a2ui payloads are keyed by surfaceId and deleted on node removal).
  // Omit batch so copied nodes become independent images (no batch linkage).
  // groupId is KEPT here — the paste path decides per-node whether to remap it
  // (group copied too) or drop it (lone member), like importCanvas does.
  const {
    surfaceId: _omitted,
    batch: _batchOmitted,
    ...metadata
  } = node.metadata;
  return {
    ...node,
    position: { ...node.position },
    size: { ...node.size },
    metadata: { ...metadata },
  };
}

/**
 * Remap a copied node's `groupId` through the paste id map:
 *  - the group was copied too (its old id is in the map) → point at the new
 *    group id (group + members round-trip as a unit);
 *  - the group was NOT copied (a lone member) → drop groupId (independent node).
 * Group nodes carry no groupId, so they pass through untouched.
 */
function remapGroupId(
  metadata: CanvasNodeMetadata,
  idMap: ReadonlyMap<string, string>,
): CanvasNodeMetadata {
  const { groupId } = metadata;
  if (groupId === undefined) return { ...metadata };
  const mapped = idMap.get(groupId);
  const { groupId: _dropped, ...rest } = metadata;
  return mapped ? { ...rest, groupId: mapped } : { ...rest };
}

/**
 * Compute bounding-box top-left of a set of nodes.
 * Nodes are assumed non-empty.
 */
function boundingTopLeft(nodes: CanvasNode[]): { x: number; y: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (node.position.x < minX) minX = node.position.x;
    if (node.position.y < minY) minY = node.position.y;
  }
  return { x: minX, y: minY };
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Copy the selected nodes (content types only) plus the connections BETWEEN
 * them into the internal clipboard. Returns the number of nodes copied.
 * Returns 0 if no copyable nodes are selected — clipboard is left untouched.
 */
export function copySelection(): number {
  const state = getCanvasState();
  const selectedSet = new Set(state.selectedNodeIds);
  const copyable = state.nodes.filter(
    (n) => selectedSet.has(n.id) && COPYABLE_TYPES.has(n.type),
  );
  if (copyable.length === 0) return 0;

  const copyableIds = new Set(copyable.map((n) => n.id));
  const copiedConnections = state.connections.filter(
    (c) => copyableIds.has(c.fromNodeId) && copyableIds.has(c.toNodeId),
  );

  clipboard = {
    nodes: copyable.map(deepCopyNode),
    connections: copiedConnections.map((c) => ({ ...c })),
    pasteCount: 0,
  };
  return copyable.length;
}

/** Returns true if the clipboard has content. */
export function clipboardHasContent(): boolean {
  return clipboard !== null && clipboard.nodes.length > 0;
}

/**
 * Paste the clipboard content as new nodes.
 * - If `at` is given, the group bounding-box top-left is placed at `at`.
 * - Otherwise, nodes are offset by +36*(pasteCount) from their copied positions.
 * Returns the number of nodes created, or 0 if clipboard is empty.
 */
export function pasteClipboard(at?: { x: number; y: number }): number {
  if (!clipboard || clipboard.nodes.length === 0) return 0;

  const { nodes: srcNodes, connections: srcConns } = clipboard;
  clipboard.pasteCount += 1;
  const shift = clipboard.pasteCount * 36;

  // Compute position offset
  let dx: number;
  let dy: number;
  if (at) {
    const topLeft = boundingTopLeft(srcNodes);
    dx = at.x - topLeft.x;
    dy = at.y - topLeft.y;
  } else {
    dx = shift;
    dy = shift;
  }

  // Pre-assign fresh ids for every copied node so groupId remap sees the full
  // map even when a member is created before its group in the loop below.
  const idMap = new Map<string, string>();
  for (const src of srcNodes) idMap.set(src.id, genId(src.type));

  const newNodes: CanvasNode[] = [];
  for (const src of srcNodes) {
    const newId = idMap.get(src.id) as string;
    const newNode = addNode({
      id: newId,
      type: src.type,
      title: src.title,
      position: { x: src.position.x + dx, y: src.position.y + dy },
      size: { ...src.size },
      metadata: remapGroupId(src.metadata, idMap),
    });
    newNodes.push(newNode);
  }

  // Remap connections to new ids
  for (const conn of srcConns) {
    const fromId = idMap.get(conn.fromNodeId);
    const toId = idMap.get(conn.toNodeId);
    if (fromId && toId) {
      connectNodes(fromId, toId);
    }
  }

  // Select exactly the new nodes
  selectNodes(newNodes.map((n) => n.id));
  return newNodes.length;
}

/**
 * One-shot copy+paste of the given node ids (same type filter, +36/+36 offset,
 * selects the new nodes) WITHOUT touching the persistent clipboard.
 * Returns the number of nodes created.
 */
export function duplicateNodes(ids: readonly string[]): number {
  const state = getCanvasState();
  const idSet = new Set(ids);
  const srcNodes = state.nodes.filter(
    (n) => idSet.has(n.id) && COPYABLE_TYPES.has(n.type),
  );
  if (srcNodes.length === 0) return 0;

  const srcIds = new Set(srcNodes.map((n) => n.id));
  const srcConns = state.connections.filter(
    (c) => srcIds.has(c.fromNodeId) && srcIds.has(c.toNodeId),
  );

  // Pre-assign fresh ids so groupId remap sees the full map regardless of the
  // order group vs. members are created in the loop below.
  const idMap = new Map<string, string>();
  for (const src of srcNodes) idMap.set(src.id, genId(src.type));

  const newNodes: CanvasNode[] = [];
  for (const src of srcNodes) {
    const newId = idMap.get(src.id) as string;
    // Strip surfaceId and batch so duplicates become independent nodes; remap
    // (or drop) groupId depending on whether the group was duplicated too.
    const { surfaceId: _s, batch: _b, ...cleanMeta } = src.metadata;
    const newNode = addNode({
      id: newId,
      type: src.type,
      title: src.title,
      position: { x: src.position.x + 36, y: src.position.y + 36 },
      size: { ...src.size },
      metadata: remapGroupId(cleanMeta, idMap),
    });
    newNodes.push(newNode);
  }

  for (const conn of srcConns) {
    const fromId = idMap.get(conn.fromNodeId);
    const toId = idMap.get(conn.toNodeId);
    if (fromId && toId) {
      connectNodes(fromId, toId);
    }
  }

  selectNodes(newNodes.map((n) => n.id));
  return newNodes.length;
}

/** Reset clipboard state (tests only). */
export function __resetCanvasClipboardForTests(): void {
  clipboard = null;
}
