/**
 * canvas-mirror.test.ts
 *
 * S8 frontend (W4.5b): the compact canvas snapshot the frontend pushes to the
 * controller mirror so canvas_read sees reality. Shape, hidden-batch-child
 * exclusion, hasContent flag, boardId from the active board, error swallowing,
 * and single-fire debounce.
 *
 * Plain Node env. The mirror SDK is mocked so the pusher can be asserted /
 * forced to reject without hitting the network.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../lib/api/sdk.gen", () => ({
  postApiV1CanvasMirror: vi.fn(() =>
    Promise.resolve({ data: {}, error: null }),
  ),
}));

import { postApiV1CanvasMirror } from "../lib/api/sdk.gen";
import {
  __resetCanvasAssetsForTests,
  saveNodeAsAsset,
} from "../src/lib/canvas/canvas-assets";
import {
  attachBatchChildren,
  toggleBatchExpanded,
} from "../src/lib/canvas/canvas-batch";
import {
  __resetCanvasMirrorForTests,
  buildCanvasMirror,
  pushCanvasMirror,
  scheduleCanvasMirrorPush,
} from "../src/lib/canvas/canvas-mirror";
import { __setAssetStorageForTests } from "../src/lib/canvas/canvas-persistence";
import {
  __resetCanvasForTests,
  addNode,
  connectNodes,
  setViewport,
} from "../src/lib/canvas/canvas-store";

const mockPush = vi.mocked(postApiV1CanvasMirror);

beforeEach(() => {
  __resetCanvasForTests();
  __resetCanvasMirrorForTests();
  __resetCanvasAssetsForTests();
  __setAssetStorageForTests(null);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("buildCanvasMirror", () => {
  it("maps nodes to the compact shape (position/size flattened + hasContent)", () => {
    addNode({
      type: "text",
      title: "note",
      position: { x: 12, y: 34 },
      size: { width: 100, height: 80 },
      metadata: { content: "some text" },
    });
    addNode({
      type: "image",
      title: "empty",
      position: { x: 0, y: 0 },
      size: { width: 200, height: 150 },
    });

    const mirror = buildCanvasMirror();
    expect(mirror.nodes).toHaveLength(2);

    const withContent = mirror.nodes.find((n) => n.title === "note");
    expect(withContent).toMatchObject({
      type: "text",
      title: "note",
      x: 12,
      y: 34,
      w: 100,
      h: 80,
      hasContent: true,
    });

    const empty = mirror.nodes.find((n) => n.title === "empty");
    expect(empty?.hasContent).toBe(false);
  });

  it("boardId comes from the active board (defaults to sidebar)", () => {
    expect(buildCanvasMirror().boardId).toBe("sidebar");
  });

  it("carries connections, viewport, and selection", () => {
    const a = addNode({ type: "text", title: "A" });
    const b = addNode({ type: "text", title: "B" });
    connectNodes(a.id, b.id);
    setViewport({ x: 7, y: 8, scale: 1.25 });

    const mirror = buildCanvasMirror();
    expect(mirror.connections).toEqual([
      expect.objectContaining({ from: a.id, to: b.id }),
    ]);
    expect(mirror.viewport).toEqual({ x: 7, y: 8, scale: 1.25 });
    // addNode selects the created node — B is the last added.
    expect(mirror.selectedNodeIds).toEqual([b.id]);
  });

  it("includes the saved asset library (id/kind/title only, no content)", async () => {
    // Populate the asset store by saving a node as an asset (in-memory storage).
    const node = addNode({
      type: "text",
      title: "Saved note",
      metadata: { content: "secret asset body" },
    });
    expect(await saveNodeAsAsset(node.id)).toBe(true);

    const mirror = buildCanvasMirror();
    expect(mirror.assets).toHaveLength(1);
    const asset = mirror.assets[0];
    expect(asset).toMatchObject({ kind: "text", title: "Saved note" });
    expect(typeof asset?.id).toBe("string");
    // Content is NEVER leaked into the mirror.
    expect(JSON.stringify(asset)).not.toContain("secret asset body");
    expect(asset).not.toHaveProperty("content");
  });

  it("assets is an empty array when the library is empty", () => {
    expect(buildCanvasMirror().assets).toEqual([]);
  });

  it("excludes hidden batch children (collapsed root)", () => {
    const root = addNode({ type: "image", title: "root" });
    // attachBatchChildren spawns child nodes (titled "root #2", "root #3") from
    // the extra items and marks the group expanded.
    attachBatchChildren(root.id, [
      { url: "data:0" },
      { url: "data:1" },
      { url: "data:2" },
    ]);
    // Expanded → all children visible in the mirror.
    expect(buildCanvasMirror().nodes.length).toBe(3);

    // Collapse the batch so children become hidden batch children.
    toggleBatchExpanded(root.id);
    const mirror = buildCanvasMirror();
    const titles = mirror.nodes.map((n) => n.title);
    expect(titles).toContain("root");
    expect(titles).not.toContain("root #2");
    expect(titles).not.toContain("root #3");
    expect(mirror.nodes).toHaveLength(1);
  });
});

describe("pushCanvasMirror", () => {
  it("calls the mirror SDK with the built snapshot", async () => {
    addNode({ type: "text", title: "n" });
    await pushCanvasMirror();
    expect(mockPush).toHaveBeenCalledTimes(1);
    const body = mockPush.mock.calls[0]?.[0]?.body;
    expect(body?.boardId).toBe("sidebar");
    expect(body?.nodes).toHaveLength(1);
  });

  it("swallows a rejecting SDK call (never throws)", async () => {
    mockPush.mockRejectedValueOnce(new Error("network down"));
    await expect(pushCanvasMirror()).resolves.toBeUndefined();
  });
});

describe("scheduleCanvasMirrorPush", () => {
  it("coalesces a burst into a single trailing push", () => {
    vi.useFakeTimers();
    scheduleCanvasMirrorPush();
    scheduleCanvasMirrorPush();
    scheduleCanvasMirrorPush();
    expect(mockPush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("__resetCanvasMirrorForTests clears a pending timer", () => {
    vi.useFakeTimers();
    scheduleCanvasMirrorPush();
    __resetCanvasMirrorForTests();
    vi.advanceTimersByTime(1000);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
