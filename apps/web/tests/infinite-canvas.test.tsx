import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __flushCanvasHistoryForTests,
  __resetCanvasForTests,
  addNode,
  connectNodes,
  exportCanvas,
  getCanvasState,
  importCanvas,
  redo,
  removeNodes,
  undo,
  upsertA2UINode,
} from "../src/lib/canvas/canvas-store";
import {
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  CanvasSurface,
  clampScale,
  connectionPath,
  fitViewport,
  zoomAtPoint,
} from "../src/lib/canvas/infinite-canvas";

// Plain-Node test env: minimal localStorage so the store's geometry
// persistence paths run instead of throwing.
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

describe("viewport math", () => {
  it("zoomAtPoint keeps the point under the pointer fixed", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const pointer = { x: 100, y: 50 };
    const next = zoomAtPoint(viewport, pointer, 2);
    expect(100 * next.scale + next.x).toBeCloseTo(pointer.x);
    expect(50 * next.scale + next.y).toBeCloseTo(pointer.y);
  });

  it("clamps scale", () => {
    expect(
      zoomAtPoint({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 99).scale,
    ).toBe(CANVAS_MAX_SCALE);
    expect(clampScale(0.001)).toBe(CANVAS_MIN_SCALE);
  });

  it("fitViewport uses real node sizes", () => {
    const nodes = [
      { position: { x: 0, y: 0 }, size: { width: 380, height: 300 } },
      { position: { x: 900, y: 700 }, size: { width: 380, height: 300 } },
    ];
    const fitted = fitViewport(nodes, { width: 400, height: 500 });
    expect(fitted.scale).toBeLessThan(1);
    expect(fitted.scale).toBeGreaterThanOrEqual(CANVAS_MIN_SCALE);
  });

  it("connectionPath bends between anchors", () => {
    const path = connectionPath({ x: 0, y: 0 }, { x: 200, y: 100 });
    expect(path).toMatch(/^M 0 0 C /);
    expect(path).toContain("200 100");
  });
});

describe("canvas store", () => {
  it("adds nodes, connects them, and rejects self/duplicate edges", () => {
    const a = addNode({ type: "text", title: "A" });
    const b = addNode({ type: "text", title: "B" });
    expect(connectNodes(a.id, a.id)).toBeNull();
    const edge = connectNodes(a.id, b.id);
    expect(edge).not.toBeNull();
    expect(connectNodes(a.id, b.id)).toBeNull(); // duplicate
    expect(getCanvasState().connections).toHaveLength(1);
  });

  it("removing a node cascades its connections", () => {
    const a = addNode({ type: "text", title: "A" });
    const b = addNode({ type: "text", title: "B" });
    connectNodes(a.id, b.id);
    removeNodes([a.id]);
    const state = getCanvasState();
    expect(state.nodes.map((n) => n.id)).toEqual([b.id]);
    expect(state.connections).toHaveLength(0);
  });

  it("undo/redo restores node and connection snapshots", () => {
    const a = addNode({ type: "text", title: "A" });
    __flushCanvasHistoryForTests();
    const b = addNode({ type: "text", title: "B" });
    connectNodes(a.id, b.id);
    __flushCanvasHistoryForTests();

    undo(); // back to just A
    expect(getCanvasState().nodes).toHaveLength(1);
    expect(getCanvasState().connections).toHaveLength(0);

    redo();
    expect(getCanvasState().nodes).toHaveLength(2);
    expect(getCanvasState().connections).toHaveLength(1);
  });

  it("export skips a2ui nodes and import round-trips portable ones", () => {
    upsertA2UINode("sidebar:run-1", "运行", [], () => {});
    const t = addNode({
      type: "text",
      title: "note",
      metadata: { content: "hello" },
    });
    const img = addNode({
      type: "image",
      title: "pic",
      metadata: { content: "data:image/png;base64,x" },
    });
    connectNodes(t.id, img.id);
    // Connection touching the a2ui node must not be exported either.
    const a2uiNode = getCanvasState().nodes.find((n) => n.type === "a2ui");
    if (a2uiNode) connectNodes(a2uiNode.id, t.id);

    const file = exportCanvas();
    expect(file.app).toBe("nexu-canvas");
    expect(file.nodes.map((n) => n.type).sort()).toEqual(["image", "text"]);
    expect(file.connections).toHaveLength(1);

    __resetCanvasForTests();
    importCanvas(file);
    const state = getCanvasState();
    expect(state.nodes).toHaveLength(2);
    expect(state.connections).toHaveLength(1);
    expect(state.nodes[0]?.metadata.content).toBe("hello");
  });

  it("upsertA2UINode refreshes in place instead of duplicating", () => {
    upsertA2UINode("sidebar:run-1", "运行", [], () => {});
    upsertA2UINode("sidebar:run-1", "运行", [], () => {});
    expect(
      getCanvasState().nodes.filter(
        (n) => n.metadata.surfaceId === "sidebar:run-1",
      ),
    ).toHaveLength(1);
  });
});

describe("CanvasSurface", () => {
  it("renders nodes, edges, toolbar and selection state from the store", () => {
    const a = addNode({
      type: "text",
      title: "初稿",
      position: { x: 0, y: 0 },
    });
    const b = addNode({
      type: "image",
      title: "配图",
      position: { x: 500, y: 100 },
    });
    connectNodes(a.id, b.id);

    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain('data-infinite-canvas="true"');
    expect(markup).toContain(`data-canvas-node="${a.id}"`);
    expect(markup).toContain(`data-canvas-node="${b.id}"`);
    expect(markup).toContain("data-canvas-edge=");
    expect(markup).toContain('data-canvas-toolbar="true"');
    // addNode selects the newest node.
    expect(markup).toContain("data-canvas-node-selected");
    expect(markup).toContain("初稿");
    expect(markup).toContain("配图");
  });

  it("renders the expired placeholder for an a2ui node without payload", () => {
    addNode({
      type: "a2ui",
      title: "旧运行",
      metadata: { surfaceId: "sidebar:gone" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain("内容已过期");
  });
});

describe("connection effects", () => {
  it("image → XHS editor connection feeds the post's image list", async () => {
    const { applyConnectionEffects } = await import(
      "../src/lib/canvas/connection-effects"
    );
    const { seedBatch, getBatch } = await import(
      "../src/lib/a2ui/custom-components/xhs-batch-store"
    );
    __resetCanvasForTests();
    seedBatch("batch-1", [
      {
        id: "post-1",
        title: "t",
        content: "c",
        images: [],
        hashtags: [],
        deviceId: "",
      },
    ]);
    upsertA2UINode(
      "sidebar:xhs-editor-batch-1-post-1",
      "xhs",
      [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "sidebar:xhs-editor-batch-1-post-1",
            components: [
              {
                id: "xhs-editor",
                type: "XHSEditor",
                batchId: "batch-1",
                postId: "post-1",
              } as never,
            ],
          },
        },
      ],
      () => {},
    );
    const img = addNode({
      type: "image",
      title: "cover",
      metadata: { content: "data:image/png;base64,COVER" },
    });
    const editorNode = getCanvasState().nodes.find((n) => n.type === "a2ui");
    if (!editorNode) throw new Error("editor node missing");

    applyConnectionEffects(img, editorNode);
    applyConnectionEffects(img, editorNode); // dedupe

    expect(getBatch("batch-1").posts[0]?.images).toEqual([
      "data:image/png;base64,COVER",
    ]);
  });
});
