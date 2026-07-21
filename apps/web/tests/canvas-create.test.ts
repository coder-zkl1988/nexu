/**
 * canvas-create.test.ts
 *
 * Tests for createConnectedNode — plan item W1.9.
 * Plain Node env — no jsdom, no DOM events.
 * All assertions work against canvas-store state directly.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createConnectedNode } from "../src/lib/canvas/canvas-create";
import {
  NODE_DEFAULT_SIZES,
  __resetCanvasForTests,
  addNode,
  getCanvasState,
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
});

describe("createConnectedNode", () => {
  it("a. creates node at correct position and connects from source", () => {
    const source = addNode({ type: "text", title: "Source" });
    const at = { x: 400, y: 300 };
    const defaultHeight = NODE_DEFAULT_SIZES.image.height;

    const created = createConnectedNode(source.id, "image", at);

    expect(created).not.toBeNull();
    expect(created?.position).toEqual({
      x: 400,
      y: 300 - defaultHeight / 2,
    });

    const state = getCanvasState();
    const conn = state.connections.find(
      (c) => c.fromNodeId === source.id && c.toNodeId === created?.id,
    );
    expect(conn).toBeDefined();
  });

  it("handleType 'target' reverses the connection: new node → fromId", () => {
    const origin = addNode({ type: "text", title: "Origin" });
    const created = createConnectedNode(
      origin.id,
      "image",
      { x: 400, y: 300 },
      "target",
    );

    const state = getCanvasState();
    const conn = state.connections.find(
      (c) => c.fromNodeId === created?.id && c.toNodeId === origin.id,
    );
    expect(conn).toBeDefined();
    expect(
      state.connections.some(
        (c) => c.fromNodeId === origin.id && c.toNodeId === created?.id,
      ),
    ).toBe(false);
  });

  it("a. new node is selected after creation", () => {
    const source = addNode({ type: "text", title: "Source" });
    const created = createConnectedNode(source.id, "image", { x: 400, y: 300 });

    const { selectedNodeIds } = getCanvasState();
    expect(selectedNodeIds).toContain(created?.id);
  });

  it("b. unknown fromId returns null and no node/connection added", () => {
    const beforeState = getCanvasState();
    const nodesBefore = beforeState.nodes.length;
    const connsBefore = beforeState.connections.length;

    const result = createConnectedNode("non-existent-id", "text", {
      x: 100,
      y: 100,
    });

    expect(result).toBeNull();
    const afterState = getCanvasState();
    expect(afterState.nodes).toHaveLength(nodesBefore);
    expect(afterState.connections).toHaveLength(connsBefore);
  });

  it("c. text type produces '文本' title and text type node", () => {
    const source = addNode({ type: "text", title: "Src" });
    const created = createConnectedNode(source.id, "text", { x: 0, y: 0 });

    expect(created).not.toBeNull();
    expect(created?.type).toBe("text");
    expect(created?.title).toBe("文本");
  });

  it("c. image type produces '图片' title and image type node", () => {
    const source = addNode({ type: "text", title: "Src" });
    const created = createConnectedNode(source.id, "image", { x: 0, y: 0 });

    expect(created).not.toBeNull();
    expect(created?.type).toBe("image");
    expect(created?.title).toBe("图片");
  });

  it("c. video type produces '视频' title and video type node", () => {
    const source = addNode({ type: "text", title: "Src" });
    const created = createConnectedNode(source.id, "video", { x: 0, y: 0 });

    expect(created).not.toBeNull();
    expect(created?.type).toBe("video");
    expect(created?.title).toBe("视频");
  });

  it("c. audio type produces '音频' title and audio type node", () => {
    const source = addNode({ type: "text", title: "Src" });
    const created = createConnectedNode(source.id, "audio", { x: 0, y: 0 });

    expect(created).not.toBeNull();
    expect(created?.type).toBe("audio");
    expect(created?.title).toBe("音频");
  });

  it("d. config type creates with default config metadata {mode: 'image'}", () => {
    const source = addNode({ type: "text", title: "Src" });
    const created = createConnectedNode(source.id, "config", { x: 0, y: 0 });

    expect(created).not.toBeNull();
    expect(created?.type).toBe("config");
    expect(created?.title).toBe("生成配置");
    expect(created?.metadata.config).toEqual({ mode: "image" });
  });

  it("c. position math: new node left-edge midpoint lands at drop point", () => {
    const source = addNode({ type: "text", title: "Src" });
    const at = { x: 500, y: 200 };
    const created = createConnectedNode(source.id, "video", at);

    expect(created).not.toBeNull();
    // position.x === at.x (left edge)
    expect(created?.position.x).toBe(at.x);
    // position.y + height/2 === at.y (midpoint)
    const height = NODE_DEFAULT_SIZES.video.height;
    expect(created?.position.y).toBe(at.y - height / 2);
  });
});
