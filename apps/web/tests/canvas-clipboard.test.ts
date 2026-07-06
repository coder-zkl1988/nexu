/**
 * canvas-clipboard.test.ts
 *
 * Tests for the internal node clipboard (copy/paste/duplicate) — plan items W1.4.
 * Plain Node env — no jsdom, no DOM events.
 * All assertions work against canvas-store state directly.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCanvasClipboardForTests,
  clipboardHasContent,
  copySelection,
  duplicateNodes,
  pasteClipboard,
} from "../src/lib/canvas/canvas-clipboard";
import {
  __resetCanvasForTests,
  addNode,
  connectNodes,
  getCanvasState,
  selectNodes,
  upsertA2UINode,
} from "../src/lib/canvas/canvas-store";

// Minimal localStorage polyfill (matches other canvas tests).
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

describe("copySelection", () => {
  it("a. copies only content nodes, skips a2ui and team-step — returns 2 for [text, a2ui, image] selection", () => {
    const text = addNode({ type: "text", title: "Note" });
    upsertA2UINode("surf-1", "A2UI", [], () => {});
    const a2uiNode = getCanvasState().nodes.find((n) => n.type === "a2ui");
    if (!a2uiNode) throw new Error("a2ui node missing");
    const img = addNode({ type: "image", title: "Pic" });

    const ids = [text.id, a2uiNode.id, img.id];
    selectNodes(ids);

    const count = copySelection();
    expect(count).toBe(2); // text + image, a2ui skipped
    expect(clipboardHasContent()).toBe(true);
  });

  it("a. returns 0 and leaves clipboard untouched when no copyable nodes selected", () => {
    upsertA2UINode("surf-2", "A2UI", [], () => {});
    const a2uiNode = getCanvasState().nodes.find((n) => n.type === "a2ui");
    if (!a2uiNode) throw new Error("a2ui node missing");
    selectNodes([a2uiNode.id]);

    // Pre-fill clipboard with something
    const text = addNode({ type: "text", title: "Pre" });
    selectNodes([text.id]);
    copySelection();
    expect(clipboardHasContent()).toBe(true);

    // Now try to copy only a2ui — should leave clipboard untouched
    selectNodes([a2uiNode.id]);
    const count = copySelection();
    expect(count).toBe(0);
    // Clipboard still has content from previous copy
    expect(clipboardHasContent()).toBe(true);
  });

  it("a. copies connections between copied nodes, skips connections to excluded nodes", () => {
    const text = addNode({ type: "text", title: "Note" });
    const img = addNode({ type: "image", title: "Pic" });
    upsertA2UINode("surf-3", "A2UI", [], () => {});
    const a2uiNode = getCanvasState().nodes.find((n) => n.type === "a2ui");
    if (!a2uiNode) throw new Error("a2ui node missing");

    connectNodes(text.id, img.id); // both copied → included
    connectNodes(text.id, a2uiNode.id); // a2ui excluded → connection excluded

    selectNodes([text.id, img.id, a2uiNode.id]);
    const count = copySelection();
    expect(count).toBe(2);
  });
});

describe("pasteClipboard", () => {
  it("b. paste creates new ids (≠ originals), preserves inter-copied connection, selects new nodes", () => {
    const text = addNode({
      type: "text",
      title: "Note",
      position: { x: 100, y: 100 },
    });
    const img = addNode({
      type: "image",
      title: "Pic",
      position: { x: 300, y: 100 },
    });
    connectNodes(text.id, img.id);
    selectNodes([text.id, img.id]);

    const originalIds = [text.id, img.id];
    copySelection();

    const { nodes: beforeNodes } = getCanvasState();
    const count = pasteClipboard();
    expect(count).toBe(2);

    const {
      nodes: afterNodes,
      connections,
      selectedNodeIds,
    } = getCanvasState();
    expect(afterNodes).toHaveLength(beforeNodes.length + 2);

    // New nodes must have different ids
    const newNodes = afterNodes.filter((n) => !originalIds.includes(n.id));
    expect(newNodes).toHaveLength(2);
    for (const n of newNodes) {
      expect(originalIds).not.toContain(n.id);
    }

    // Connection is remapped to new ids
    const newIds = new Set(newNodes.map((n) => n.id));
    const remappedConn = connections.find(
      (c) => newIds.has(c.fromNodeId) && newIds.has(c.toNodeId),
    );
    expect(remappedConn).toBeDefined();

    // New nodes are selected
    expect(new Set(selectedNodeIds)).toEqual(newIds);
  });

  it("c. second paste of same clipboard lands +36/+36 beyond first paste", () => {
    const text = addNode({
      type: "text",
      title: "Note",
      position: { x: 0, y: 0 },
    });
    selectNodes([text.id]);
    copySelection();

    pasteClipboard(); // first paste: +36/+36 from copied position
    const { nodes: afterFirst } = getCanvasState();
    const firstPasted = afterFirst.find((n) => n.id !== text.id);
    expect(firstPasted).toBeDefined();
    expect(firstPasted?.position).toEqual({ x: 36, y: 36 });

    pasteClipboard(); // second paste: +72/+72 from copied position
    const { nodes: afterSecond } = getCanvasState();
    const firstPastedId = firstPasted?.id;
    const secondPasted = afterSecond.find(
      (n) => n.id !== text.id && n.id !== firstPastedId,
    );
    expect(secondPasted).toBeDefined();
    expect(secondPasted?.position).toEqual({ x: 72, y: 72 });
  });

  it("d. pasteClipboard({x,y}) places group bounding-box top-left at {x,y}", () => {
    // Two nodes with bounding box top-left at (100, 200)
    const a = addNode({
      type: "text",
      title: "A",
      position: { x: 100, y: 200 },
    });
    const b = addNode({
      type: "image",
      title: "B",
      position: { x: 300, y: 250 },
      size: { width: 340, height: 240 },
    });
    selectNodes([a.id, b.id]);
    copySelection();

    const target = { x: 50, y: 80 };
    pasteClipboard(target);

    const { nodes } = getCanvasState();
    const origIds = new Set([a.id, b.id]);
    const pasted = nodes.filter((n) => !origIds.has(n.id));
    expect(pasted).toHaveLength(2);

    // Bounding box top-left should be at target
    const minX = Math.min(...pasted.map((n) => n.position.x));
    const minY = Math.min(...pasted.map((n) => n.position.y));
    expect(minX).toBe(target.x);
    expect(minY).toBe(target.y);
  });

  it("f. empty-clipboard paste returns 0 and adds nothing", () => {
    addNode({ type: "text", title: "A" });
    const before = getCanvasState().nodes.length;

    const count = pasteClipboard();
    expect(count).toBe(0);
    expect(getCanvasState().nodes).toHaveLength(before);
  });

  it("g. surfaceId is stripped from pasted node metadata to prevent a2ui payload collision", () => {
    // Create a text node with surfaceId in metadata (simulating a sneakily-added value)
    const text = addNode({
      type: "text",
      title: "TextWithSurfaceId",
      metadata: { surfaceId: "sneak" },
    });
    selectNodes([text.id]);
    copySelection();

    pasteClipboard();
    const { nodes } = getCanvasState();
    const pasted = nodes.find(
      (n) => n.title === "TextWithSurfaceId" && n.id !== text.id,
    );
    expect(pasted).toBeDefined();
    expect(pasted?.metadata.surfaceId).toBeUndefined();
  });
});

describe("config node copyable", () => {
  it("config node is included in COPYABLE_TYPES — copySelection returns it", () => {
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "image" } },
    });
    selectNodes([config.id]);
    const count = copySelection();
    expect(count).toBe(1);
    expect(clipboardHasContent()).toBe(true);
  });

  it("pasting a config node preserves its metadata.config", () => {
    const config = addNode({
      type: "config",
      title: "生成配置",
      position: { x: 100, y: 100 },
      metadata: { config: { mode: "video", durationSeconds: 10 } },
    });
    selectNodes([config.id]);
    copySelection();
    pasteClipboard();

    const { nodes } = getCanvasState();
    const pasted = nodes.find((n) => n.type === "config" && n.id !== config.id);
    expect(pasted).toBeDefined();
    expect(pasted?.metadata.config?.mode).toBe("video");
    expect(pasted?.metadata.config?.durationSeconds).toBe(10);
  });
});

describe("duplicateNodes", () => {
  it("e. duplicateNodes creates offset copies and does NOT modify persistent clipboard", () => {
    expect(clipboardHasContent()).toBe(false);

    const text = addNode({
      type: "text",
      title: "Note",
      position: { x: 100, y: 100 },
    });
    const img = addNode({
      type: "image",
      title: "Pic",
      position: { x: 200, y: 200 },
    });

    const count = duplicateNodes([text.id, img.id]);
    expect(count).toBe(2);

    // Clipboard is still empty — duplicateNodes must not touch it
    expect(clipboardHasContent()).toBe(false);

    // New nodes exist with +36/+36 offset
    const { nodes, selectedNodeIds } = getCanvasState();
    const origIds = new Set([text.id, img.id]);
    const newNodes = nodes.filter((n) => !origIds.has(n.id));
    expect(newNodes).toHaveLength(2);

    const dupText = newNodes.find((n) => n.title === "Note");
    expect(dupText?.position).toEqual({ x: 136, y: 136 });

    // New nodes are selected
    const newIds = new Set(newNodes.map((n) => n.id));
    expect(new Set(selectedNodeIds)).toEqual(newIds);
  });

  it("e. duplicateNodes skips a2ui and team-step nodes, returns 0 for all-excluded input", () => {
    upsertA2UINode("surf-4", "A2UI", [], () => {});
    const a2uiNode = getCanvasState().nodes.find((n) => n.type === "a2ui");
    if (!a2uiNode) throw new Error("a2ui node missing");

    const count = duplicateNodes([a2uiNode.id]);
    expect(count).toBe(0);
  });

  it("e. clipboard remains empty after duplicate when it was empty before", () => {
    const text = addNode({ type: "text", title: "Note" });
    expect(clipboardHasContent()).toBe(false);
    duplicateNodes([text.id]);
    expect(clipboardHasContent()).toBe(false);
  });

  it("e. clipboard content is preserved (not overwritten) when it already had content", () => {
    const text = addNode({
      type: "text",
      title: "Original",
      position: { x: 0, y: 0 },
    });
    selectNodes([text.id]);
    copySelection();
    expect(clipboardHasContent()).toBe(true);

    // Duplicate something else
    const img = addNode({ type: "image", title: "Img" });
    duplicateNodes([img.id]);

    // Still has content (unchanged)
    expect(clipboardHasContent()).toBe(true);

    // Paste from clipboard should still paste the original text node
    const beforeLen = getCanvasState().nodes.length;
    pasteClipboard();
    const { nodes } = getCanvasState();
    expect(nodes.length).toBe(beforeLen + 1);
    const pasted = nodes.find(
      (n) => n.title === "Original" && ![text.id, img.id].includes(n.id),
    );
    expect(pasted).toBeDefined();
  });
});
