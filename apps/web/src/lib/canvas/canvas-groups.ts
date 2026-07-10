/**
 * canvas-groups.ts
 *
 * Pure membership math for group container nodes (P3). A group is a node of
 * type "group" (an inert container box); member nodes carry
 * `metadata.groupId = <group id>`. Groups never nest. Kept dependency-free and
 * pure so the drag path and its tests share one source of truth.
 *
 * Concept model mirrors the reference infinite-canvas app's Group node
 * (AGPL — interaction paradigm only, reimplemented from scratch).
 */

import type { CanvasNode } from "./canvas-store";

type GroupRect = {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

/**
 * Which group's rect contains `center`, or `undefined` if none does.
 *
 * Center-inside-rect test, inclusive of edges. When several groups overlap and
 * all contain the point, the LAST match in `groups` wins: callers pass groups
 * in node/render order, and groups render behind everything in that order, so
 * the last match is the topmost group. Deterministic tiebreak.
 */
export function groupIdForPoint(
  center: { x: number; y: number },
  groups: ReadonlyArray<GroupRect>,
): string | undefined {
  let match: string | undefined;
  for (const group of groups) {
    const withinX =
      center.x >= group.position.x &&
      center.x <= group.position.x + group.size.width;
    const withinY =
      center.y >= group.position.y &&
      center.y <= group.position.y + group.size.height;
    if (withinX && withinY) {
      match = group.id;
    }
  }
  return match;
}

/** Ids of every node that is a member of `groupId` (metadata.groupId match). */
export function memberIdsOf(
  groupId: string,
  nodes: ReadonlyArray<CanvasNode>,
): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.metadata.groupId === groupId) ids.push(node.id);
  }
  return ids;
}
