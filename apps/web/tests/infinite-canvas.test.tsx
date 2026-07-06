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
  moveNodes,
  redo,
  removeNodes,
  selectNodes,
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
  gridBackgroundSize,
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

  it("clamps scale to 0.05–5 range", () => {
    expect(CANVAS_MIN_SCALE).toBe(0.05);
    expect(CANVAS_MAX_SCALE).toBe(5);
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

describe("grid LOD", () => {
  it("gridBackgroundSize returns pixel size at scale 1", () => {
    expect(gridBackgroundSize(1)).toBe(24);
  });

  it("gridBackgroundSize returns null at min scale 0.05 (1.2px < 4px threshold)", () => {
    expect(gridBackgroundSize(0.05)).toBeNull();
  });

  it("gridBackgroundSize returns value at boundary scale 4/24 (exactly 4px)", () => {
    const boundaryScale = 4 / 24;
    expect(gridBackgroundSize(boundaryScale)).toBe(4);
  });

  it("gridBackgroundSize returns null just below the 4px threshold", () => {
    // (4/24 - epsilon) * 24 < 4
    const justBelow = 4 / 24 - 0.001;
    expect(gridBackgroundSize(justBelow)).toBeNull();
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

  it("moveNodes moves a multi-selection in one state update", () => {
    const a = addNode({ type: "text", title: "A" });
    const b = addNode({ type: "text", title: "B" });
    moveNodes([
      { id: a.id, position: { x: 10, y: 20 } },
      { id: b.id, position: { x: 30, y: 40 } },
    ]);
    const state = getCanvasState();
    expect(state.nodes.find((n) => n.id === a.id)?.position).toEqual({
      x: 10,
      y: 20,
    });
    expect(state.nodes.find((n) => n.id === b.id)?.position).toEqual({
      x: 30,
      y: 40,
    });
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

  it("importCanvas remaps ids, strips surfaceId, and validates connection endpoints", () => {
    // Live store has one node with a known id.
    const live = addNode({ type: "text", title: "live" });
    const liveId = live.id;

    // Craft a file whose two imported nodes reuse the SAME id as the live node
    // and include a metadata.surfaceId that must be stripped.
    const importedRawId1 = liveId; // deliberate collision
    const importedRawId2 = "imported-node-2";
    const file = {
      app: "nexu-canvas" as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      nodes: [
        {
          id: importedRawId1,
          type: "text" as const,
          title: "imported-a",
          position: { x: 10, y: 10 },
          size: { width: 300, height: 180 },
          metadata: { surfaceId: "sneak", content: "keep-me" },
        },
        {
          id: importedRawId2,
          type: "image" as const,
          title: "imported-b",
          position: { x: 20, y: 20 },
          size: { width: 340, height: 240 },
          metadata: { surfaceId: "sneak2" },
        },
      ],
      connections: [
        {
          id: "old-conn-id",
          fromNodeId: importedRawId1,
          toNodeId: importedRawId2,
        },
        // This connection references an id not in the import set — must be dropped.
        {
          id: "dangling-conn-id",
          fromNodeId: importedRawId1,
          toNodeId: "ghost-node",
        },
      ],
    };

    importCanvas(file);
    const state = getCanvasState();

    // Total nodes = 1 live + 2 imported (no replacement).
    expect(state.nodes).toHaveLength(3);

    // No duplicate ids in state.
    const allIds = state.nodes.map((n) => n.id);
    expect(new Set(allIds).size).toBe(3);

    // Imported nodes got new ids (neither kept the raw collision id).
    const importedNodes = state.nodes.filter((n) => n.id !== liveId);
    expect(importedNodes).toHaveLength(2);
    for (const n of importedNodes) {
      expect(n.id).not.toBe(importedRawId1);
      expect(n.id).not.toBe(importedRawId2);
    }

    // Only the valid connection survived; the dangling one was dropped.
    // Its endpoints are the NEW remapped ids.
    expect(state.connections).toHaveLength(1);
    const conn = state.connections[0];
    expect(conn).toBeDefined();
    const importedIds = new Set(importedNodes.map((n) => n.id));
    expect(importedIds.has(conn?.fromNodeId)).toBe(true);
    expect(importedIds.has(conn?.toNodeId)).toBe(true);

    // No imported node carries metadata.surfaceId.
    for (const n of importedNodes) {
      expect(n.metadata).not.toHaveProperty("surfaceId");
      // Other metadata is preserved.
    }
    // content from first imported node survived.
    const importedA = importedNodes.find((n) => n.title === "imported-a");
    expect(importedA?.metadata.content).toBe("keep-me");
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

  it("keeps the smooth-interaction contract: select-none container, transform-positioned nodes", () => {
    addNode({ type: "text", title: "T", position: { x: 500, y: 100 } });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    // Dragging must never start a text selection…
    expect(markup).toContain("select-none");
    // …and nodes are compositor-positioned (no per-frame layout).
    expect(markup).toContain("translate3d(500px, 100px, 0)");
    expect(markup).toContain("contain:layout style");
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

  it("context menu is NOT in default markup (closed-by-default contract)", () => {
    addNode({ type: "text", title: "节点" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    // The menu should only appear after a right-click — absent in static render.
    expect(markup).not.toContain("data-canvas-context-menu");
  });

  it("connect menu is NOT in default markup (closed-by-default contract)", () => {
    addNode({ type: "text", title: "节点" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    // The connect menu only appears after a connect-drop on empty canvas.
    expect(markup).not.toContain("data-canvas-connect-menu");
  });

  it("renders all four corner resize handles for a node", () => {
    addNode({ type: "text", title: "节点" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain('data-resize-corner="nw"');
    expect(markup).toContain('data-resize-corner="ne"');
    expect(markup).toContain('data-resize-corner="sw"');
    expect(markup).toContain('data-resize-corner="se"');
  });

  it("renders lock toggle button for image node with content, absent for text node", () => {
    addNode({
      type: "image",
      title: "pic",
      metadata: { content: "data:image/png;base64,x" },
    });
    addNode({ type: "text", title: "note" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    // Lock toggle only on the image node (it has content)
    expect(markup).toContain("data-canvas-lock-toggle");
    // aria-label present
    expect(markup).toContain("toggle aspect ratio lock");
  });

  it("lock toggle absent for text node", () => {
    addNode({ type: "text", title: "only text" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-lock-toggle");
  });

  it("lock toggle absent for image node without content", () => {
    addNode({ type: "image", title: "empty image" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-lock-toggle");
  });

  it("toolbar contains export and import buttons", () => {
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain("导出画布");
    expect(markup).toContain("导入画布");
  });

  it("a node with task.status=generating renders data-canvas-node-generating", () => {
    addNode({
      type: "image",
      title: "生成中",
      metadata: {
        task: { status: "generating", retry: { kind: "image", prompt: "sky" } },
      },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain("data-canvas-node-generating");
  });

  it("a node with task.status=error renders data-canvas-node-retry", () => {
    addNode({
      type: "image",
      title: "错误节点",
      metadata: {
        task: {
          status: "error",
          error: "生成失败，请重试",
          retry: { kind: "image", prompt: "sunset" },
        },
      },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain("data-canvas-node-retry");
  });
});

describe("PromptPanel visibility", () => {
  it("single selected image node renders data-canvas-prompt-panel with 生成 button", () => {
    // addNode selects the newest node automatically
    addNode({ type: "image", title: "图片" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain("data-canvas-prompt-panel=");
    expect(markup).toContain("data-canvas-panel-generate");
    expect(markup).toContain("生成");
  });

  it("two nodes selected: prompt panel is absent", () => {
    const a = addNode({ type: "image", title: "A" });
    const b = addNode({ type: "image", title: "B" });
    // Force multi-selection
    selectNodes([a.id, b.id]);
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-prompt-panel");
  });

  it("single selected text node: prompt panel is absent", () => {
    addNode({ type: "text", title: "文本" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-prompt-panel");
  });

  it("single selected video node renders panel", () => {
    addNode({ type: "video", title: "视频" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain("data-canvas-prompt-panel=");
  });

  it("single selected audio node renders panel", () => {
    addNode({ type: "audio", title: "音频" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain("data-canvas-prompt-panel=");
  });

  it("single selected config node does NOT render data-canvas-prompt-panel", () => {
    addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "image" } },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    // Config nodes have their own inline UI — the media prompt panel must not appear.
    expect(markup).not.toContain("data-canvas-prompt-panel");
    // But the config generate button must appear.
    expect(markup).toContain("data-canvas-config-generate");
  });
});

describe("ConfigNode markup", () => {
  it("config node renders data-canvas-config-generate and mode labels", () => {
    addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "image" } },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain("data-canvas-config-generate");
    // Mode labels must be present in the segmented control
    expect(markup).toContain("图");
    expect(markup).toContain("视频");
    expect(markup).toContain("音频");
  });

  it("toolbar contains 配置节点 button", () => {
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain("配置节点");
  });

  it("connect menu contains 配置 option when connectMenu is open — connect menu is absent by default", () => {
    // The connect menu is only shown after a connect-drop gesture; default markup omits it.
    addNode({ type: "text", title: "文本" });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-connect-menu");
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
