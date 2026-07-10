/**
 * canvas-groups.test.ts
 *
 * P3 group container nodes:
 *  - pure membership math (groupIdForPoint, memberIdsOf),
 *  - the removeNodes group-unbind cascade (members survive with groupId
 *    cleared; the batch cascade stays intact — a separate concept),
 *  - clipboard group+member round-trip (remap) vs. lone member (drop),
 *  - the mirror schema widening (group parses in canvasMirrorNodeSchema but is
 *    still rejected on the agent add_node surface, canvasOpNodeTypeSchema).
 *
 * Plain Node env — no jsdom. Assertions run against canvas-store state directly.
 */

import { canvasMirrorNodeSchema, canvasOpNodeTypeSchema } from "@nexu/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { attachBatchChildren } from "../src/lib/canvas/canvas-batch";
import {
  __resetCanvasClipboardForTests,
  copySelection,
  duplicateNodes,
  pasteClipboard,
} from "../src/lib/canvas/canvas-clipboard";
import { groupIdForPoint, memberIdsOf } from "../src/lib/canvas/canvas-groups";
import {
  __resetCanvasForTests,
  addNode,
  getCanvasState,
  removeNodes,
  selectNodes,
} from "../src/lib/canvas/canvas-store";

// localStorage polyfill — canvas-store reads it at module load.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  __resetCanvasForTests();
  __resetCanvasClipboardForTests();
});

// ── groupIdForPoint ────────────────────────────────────────────

describe("groupIdForPoint", () => {
  const groupA = {
    id: "g-a",
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
  };

  it("returns the group id when the center is inside the rect", () => {
    expect(groupIdForPoint({ x: 50, y: 50 }, [groupA])).toBe("g-a");
  });

  it("returns undefined when the center is outside every rect", () => {
    expect(groupIdForPoint({ x: 150, y: 50 }, [groupA])).toBeUndefined();
    expect(groupIdForPoint({ x: 50, y: -1 }, [groupA])).toBeUndefined();
  });

  it("treats the edge as inside (inclusive test)", () => {
    expect(groupIdForPoint({ x: 0, y: 0 }, [groupA])).toBe("g-a"); // top-left
    expect(groupIdForPoint({ x: 100, y: 100 }, [groupA])).toBe("g-a"); // bottom-right
    expect(groupIdForPoint({ x: 0, y: 50 }, [groupA])).toBe("g-a"); // left edge
  });

  it("returns undefined when there are no groups", () => {
    expect(groupIdForPoint({ x: 50, y: 50 }, [])).toBeUndefined();
  });

  it("picks the topmost (last-in-order) group when rects overlap", () => {
    const back = {
      id: "g-back",
      position: { x: 0, y: 0 },
      size: { width: 200, height: 200 },
    };
    const front = {
      id: "g-front",
      position: { x: 50, y: 50 },
      size: { width: 100, height: 100 },
    };
    // A point inside BOTH rects → the last match (front) wins.
    expect(groupIdForPoint({ x: 100, y: 100 }, [back, front])).toBe("g-front");
    // Order is the tiebreak: swapping makes 'back' the last match.
    expect(groupIdForPoint({ x: 100, y: 100 }, [front, back])).toBe("g-back");
    // A point inside only 'back' → back, regardless of front's presence.
    expect(groupIdForPoint({ x: 10, y: 10 }, [back, front])).toBe("g-back");
  });
});

// ── memberIdsOf ────────────────────────────────────────────────

describe("memberIdsOf", () => {
  it("returns the ids of nodes whose metadata.groupId matches", () => {
    const group = addNode({ type: "group", title: "组" });
    const m1 = addNode({
      type: "text",
      title: "t1",
      metadata: { groupId: group.id },
    });
    const m2 = addNode({
      type: "image",
      title: "i1",
      metadata: { groupId: group.id },
    });
    addNode({ type: "text", title: "loose" }); // no groupId

    const ids = memberIdsOf(group.id, getCanvasState().nodes);
    expect(new Set(ids)).toEqual(new Set([m1.id, m2.id]));
  });

  it("returns [] when a group has no members", () => {
    const group = addNode({ type: "group", title: "组" });
    expect(memberIdsOf(group.id, getCanvasState().nodes)).toEqual([]);
  });
});

// ── removeNodes group unbind ───────────────────────────────────

describe("removeNodes — group unbind", () => {
  it("deleting a group keeps its members and clears their groupId", () => {
    const group = addNode({ type: "group", title: "组" });
    const m1 = addNode({
      type: "text",
      title: "t",
      metadata: { groupId: group.id },
    });
    const m2 = addNode({
      type: "image",
      title: "i",
      metadata: { groupId: group.id },
    });

    removeNodes([group.id]);

    const { nodes } = getCanvasState();
    expect(nodes.find((n) => n.id === group.id)).toBeUndefined();
    const survivor1 = nodes.find((n) => n.id === m1.id);
    const survivor2 = nodes.find((n) => n.id === m2.id);
    expect(survivor1).toBeDefined();
    expect(survivor2).toBeDefined();
    // groupId cleared — the key is removed, not left as undefined.
    expect(survivor1?.metadata.groupId).toBeUndefined();
    expect("groupId" in (survivor1?.metadata ?? {})).toBe(false);
    expect(survivor2?.metadata.groupId).toBeUndefined();
  });

  it("only unbinds members of the removed group (other groups untouched)", () => {
    const g1 = addNode({ type: "group", title: "组1" });
    const g2 = addNode({ type: "group", title: "组2" });
    const m1 = addNode({
      type: "text",
      title: "t1",
      metadata: { groupId: g1.id },
    });
    const m2 = addNode({
      type: "text",
      title: "t2",
      metadata: { groupId: g2.id },
    });

    removeNodes([g1.id]);

    const { nodes } = getCanvasState();
    expect(nodes.find((n) => n.id === m1.id)?.metadata.groupId).toBeUndefined();
    // m2 still belongs to the surviving g2.
    expect(nodes.find((n) => n.id === m2.id)?.metadata.groupId).toBe(g2.id);
    expect(nodes.find((n) => n.id === g2.id)).toBeDefined();
  });

  it("batch cascade still deletes batch children (group unbind rides alongside)", () => {
    const root = addNode({
      type: "image",
      title: "root",
      size: { width: 340, height: 240 },
    });
    attachBatchChildren(root.id, [{ url: "a" }, { url: "b" }, { url: "c" }]);
    expect(getCanvasState().nodes).toHaveLength(3); // root + 2 children

    removeNodes([root.id]);
    // Batch cascade removes the children too — nothing survives.
    expect(getCanvasState().nodes).toHaveLength(0);
  });
});

// ── clipboard group membership ─────────────────────────────────

describe("clipboard — group membership", () => {
  it("copying a group WITH its members remaps each member's groupId to the new group", () => {
    const group = addNode({
      type: "group",
      title: "组",
      position: { x: 0, y: 0 },
    });
    const m1 = addNode({
      type: "text",
      title: "t",
      position: { x: 20, y: 20 },
      metadata: { groupId: group.id },
    });
    const m2 = addNode({
      type: "image",
      title: "i",
      position: { x: 40, y: 40 },
      metadata: { groupId: group.id },
    });

    selectNodes([group.id, m1.id, m2.id]);
    expect(copySelection()).toBe(3);
    expect(pasteClipboard()).toBe(3);

    const originalIds = new Set([group.id, m1.id, m2.id]);
    const pasted = getCanvasState().nodes.filter((n) => !originalIds.has(n.id));
    expect(pasted).toHaveLength(3);

    const pastedGroup = pasted.find((n) => n.type === "group");
    const pastedMembers = pasted.filter((n) => n.type !== "group");
    expect(pastedGroup).toBeDefined();
    expect(pastedMembers).toHaveLength(2);
    // New group id (not the original).
    expect(pastedGroup?.id).not.toBe(group.id);
    // Each pasted member points at the NEW group id, not the original.
    for (const member of pastedMembers) {
      expect(member.metadata.groupId).toBe(pastedGroup?.id);
      expect(member.metadata.groupId).not.toBe(group.id);
    }
  });

  it("copying a member WITHOUT its group drops groupId (independent node)", () => {
    const group = addNode({ type: "group", title: "组" });
    const member = addNode({
      type: "text",
      title: "t",
      metadata: { groupId: group.id },
    });

    selectNodes([member.id]); // group NOT selected
    expect(copySelection()).toBe(1);
    expect(pasteClipboard()).toBe(1);

    const pasted = getCanvasState().nodes.find(
      (n) => n.id !== group.id && n.id !== member.id,
    );
    expect(pasted).toBeDefined();
    expect(pasted?.metadata.groupId).toBeUndefined();
  });

  it("duplicating a member WITHOUT its group drops groupId", () => {
    const group = addNode({ type: "group", title: "组" });
    const member = addNode({
      type: "image",
      title: "i",
      metadata: { groupId: group.id },
    });

    expect(duplicateNodes([member.id])).toBe(1);

    const dupe = getCanvasState().nodes.find(
      (n) => n.id !== group.id && n.id !== member.id,
    );
    expect(dupe?.metadata.groupId).toBeUndefined();
  });

  it("duplicating a group WITH its members remaps groupId to the new group", () => {
    const group = addNode({ type: "group", title: "组" });
    const member = addNode({
      type: "text",
      title: "t",
      metadata: { groupId: group.id },
    });

    expect(duplicateNodes([group.id, member.id])).toBe(2);

    const originalIds = new Set([group.id, member.id]);
    const dupes = getCanvasState().nodes.filter((n) => !originalIds.has(n.id));
    const dupGroup = dupes.find((n) => n.type === "group");
    const dupMember = dupes.find((n) => n.type !== "group");
    expect(dupGroup).toBeDefined();
    expect(dupMember?.metadata.groupId).toBe(dupGroup?.id);
  });
});

// ── mirror schema widening ─────────────────────────────────────

describe("mirror schema — group widening (mirror-only)", () => {
  const baseNode = {
    id: "n1",
    title: "组",
    x: 0,
    y: 0,
    w: 760,
    h: 480,
    hasContent: false,
  };

  it("canvasMirrorNodeSchema accepts a group node type", () => {
    expect(
      canvasMirrorNodeSchema.safeParse({ ...baseNode, type: "group" }).success,
    ).toBe(true);
  });

  it("canvasMirrorNodeSchema still accepts every existing node type", () => {
    for (const type of [
      "text",
      "image",
      "video",
      "audio",
      "config",
      "a2ui",
      "team-step",
    ]) {
      expect(
        canvasMirrorNodeSchema.safeParse({ ...baseNode, type }).success,
      ).toBe(true);
    }
  });

  it("canvasOpNodeTypeSchema (agent add_node surface) still REJECTS group", () => {
    expect(canvasOpNodeTypeSchema.safeParse("group").success).toBe(false);
    // Sanity: it still accepts a real op node type.
    expect(canvasOpNodeTypeSchema.safeParse("image").success).toBe(true);
  });
});
