/**
 * config-node-logic.test.ts
 *
 * TDD: tests first (RED), then config-node-logic.ts implementation.
 * Plain Node env — no jsdom. vi.mock for canvas-generation seam.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock canvas-generation so we can assert calls without hitting the API.
vi.mock("../src/lib/canvas/canvas-generation", () => ({
  generateImageIntoNode: vi.fn().mockResolvedValue(true),
  generateVideoIntoNode: vi.fn().mockResolvedValue(true),
  generateAudioIntoNode: vi.fn().mockResolvedValue(true),
  retryNodeTask: vi.fn(),
}));

import {
  generateAudioIntoNode,
  generateImageIntoNode,
  generateVideoIntoNode,
} from "../src/lib/canvas/canvas-generation";
import {
  __resetCanvasForTests,
  addNode,
  connectNodes,
  getCanvasState,
} from "../src/lib/canvas/canvas-store";
import {
  buildConfigGenerationPlan,
  runConfigGeneration,
} from "../src/lib/canvas/config-node-logic";

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
  vi.clearAllMocks();
});

describe("buildConfigGenerationPlan", () => {
  it("returns {error: 'no-config'} when config node has no metadata.config", () => {
    const node = addNode({
      type: "config",
      title: "生成配置",
      // no metadata.config
    });
    const result = buildConfigGenerationPlan(node.id);
    expect(result).toEqual({ error: "no-config" });
  });

  it("returns {error: 'no-prompt'} when no upstream text nodes with content", () => {
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "image" } },
    });
    // No upstream connections at all
    const result = buildConfigGenerationPlan(config.id);
    expect(result).toEqual({ error: "no-prompt" });
  });

  it("returns {error: 'no-prompt'} when upstream text node has only whitespace", () => {
    const text = addNode({
      type: "text",
      title: "文本",
      metadata: { content: "   " },
    });
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "image" } },
    });
    connectNodes(text.id, config.id);

    const result = buildConfigGenerationPlan(config.id);
    expect(result).toEqual({ error: "no-prompt" });
  });

  it("image mode: joins multiple upstream prompts with double newline, includes usable reference paths and count", () => {
    const text1 = addNode({
      type: "text",
      title: "文本1",
      metadata: { content: "a cat" },
    });
    const text2 = addNode({
      type: "text",
      title: "文本2",
      metadata: { content: "  portrait style  " },
    });
    const img = addNode({
      type: "image",
      title: "参考图",
      // state-file URL — servablePathFromUrl extracts /abs/path
      metadata: {
        content: "/api/v1/media/state-file?path=%2Fabs%2Fpath%2Fref.png",
      },
    });
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "image", count: 2 } },
      position: { x: 100, y: 100 },
      size: { width: 320, height: 240 },
    });
    connectNodes(text1.id, config.id);
    connectNodes(text2.id, config.id);
    connectNodes(img.id, config.id);

    const result = buildConfigGenerationPlan(config.id);
    expect(result).not.toHaveProperty("error");
    if ("error" in result) throw new Error("expected plan");

    expect(result.kind).toBe("image");
    expect(result.prompt).toBe("a cat\n\nportrait style");
    expect(result.referenceImages).toEqual(["/abs/path/ref.png"]);
    expect(result.count).toBe(2);
  });

  it("image mode: dataURL upstream images are excluded from referenceImages (not usable)", () => {
    const text = addNode({
      type: "text",
      title: "文本",
      metadata: { content: "sky" },
    });
    const img = addNode({
      type: "image",
      title: "data img",
      metadata: { content: "data:image/png;base64,abc123" },
    });
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "image" } },
    });
    connectNodes(text.id, config.id);
    connectNodes(img.id, config.id);

    const result = buildConfigGenerationPlan(config.id);
    if ("error" in result) throw new Error("expected plan");
    expect(result.kind).toBe("image");
    expect(result.referenceImages).toEqual([]);
  });

  it("video mode: passes durationSeconds and resolution from metadata.config", () => {
    const text = addNode({
      type: "text",
      title: "文本",
      metadata: { content: "ocean waves" },
    });
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: {
        config: { mode: "video", durationSeconds: 10, resolution: "1080p" },
      },
    });
    connectNodes(text.id, config.id);

    const result = buildConfigGenerationPlan(config.id);
    if ("error" in result) throw new Error("expected plan");
    expect(result.kind).toBe("video");
    expect(result.prompt).toBe("ocean waves");
    if (result.kind === "video") {
      expect(result.durationSeconds).toBe(10);
      expect(result.resolution).toBe("1080p");
    }
  });

  it("audio mode: passes voice and speed from metadata.config", () => {
    const text = addNode({
      type: "text",
      title: "文本",
      metadata: { content: "hello world" },
    });
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "audio", voice: "en-US", speed: 1.5 } },
    });
    connectNodes(text.id, config.id);

    const result = buildConfigGenerationPlan(config.id);
    if ("error" in result) throw new Error("expected plan");
    expect(result.kind).toBe("audio");
    expect(result.prompt).toBe("hello world");
    if (result.kind === "audio") {
      expect(result.voice).toBe("en-US");
      expect(result.speed).toBe(1.5);
    }
  });
});

describe("runConfigGeneration", () => {
  it("returns null and creates no node when no-prompt error", async () => {
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "image" } },
    });

    const result = await runConfigGeneration(config.id);
    expect(result).toBeNull();

    const { nodes } = getCanvasState();
    // Only the config node — no result node created
    expect(nodes).toHaveLength(1);
    expect(generateImageIntoNode).not.toHaveBeenCalled();
  });

  it("image plan: creates a result image node, connects config→result, calls generateImageIntoNode with plan args", async () => {
    const text = addNode({
      type: "text",
      title: "文本",
      metadata: { content: "a sunny day" },
    });
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "image", count: 3 } },
      position: { x: 200, y: 100 },
      size: { width: 320, height: 240 },
    });
    connectNodes(text.id, config.id);

    const result = await runConfigGeneration(config.id);
    expect(result).not.toBeNull();

    const { nodes, connections } = getCanvasState();

    // A new result node should exist (type=image, title=生成结果)
    const resultNode = nodes.find(
      (n) => n.type === "image" && n.title === "生成结果",
    );
    expect(resultNode).toBeDefined();
    if (!resultNode) throw new Error("result node missing");

    // Result node positioned at config.x + config.width + 60
    expect(resultNode.position.x).toBe(200 + 320 + 60);
    expect(resultNode.position.y).toBe(100);

    // Connection: config → resultNode
    const conn = connections.find(
      (c) => c.fromNodeId === config.id && c.toNodeId === resultNode.id,
    );
    expect(conn).toBeDefined();

    // generateImageIntoNode called with result node id, prompt, {count}
    expect(generateImageIntoNode).toHaveBeenCalledWith(
      resultNode.id,
      "a sunny day",
      { referenceImages: [], count: 3 },
    );
  });

  it("video plan: creates result video node and calls generateVideoIntoNode", async () => {
    const text = addNode({
      type: "text",
      title: "文本",
      metadata: { content: "rain forest" },
    });
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: {
        config: { mode: "video", durationSeconds: 5, resolution: "720p" },
      },
      position: { x: 0, y: 0 },
      size: { width: 320, height: 240 },
    });
    connectNodes(text.id, config.id);

    await runConfigGeneration(config.id);

    const { nodes } = getCanvasState();
    const resultNode = nodes.find(
      (n) => n.type === "video" && n.title === "生成结果",
    );
    expect(resultNode).toBeDefined();

    expect(generateVideoIntoNode).toHaveBeenCalledWith(
      resultNode?.id,
      "rain forest",
      { durationSeconds: 5, resolution: "720p" },
    );
  });

  it("audio plan: creates result audio node and calls generateAudioIntoNode", async () => {
    const text = addNode({
      type: "text",
      title: "文本",
      metadata: { content: "good morning" },
    });
    const config = addNode({
      type: "config",
      title: "生成配置",
      metadata: { config: { mode: "audio", voice: "zh-CN", speed: 1.0 } },
      position: { x: 0, y: 0 },
      size: { width: 320, height: 240 },
    });
    connectNodes(text.id, config.id);

    await runConfigGeneration(config.id);

    const { nodes } = getCanvasState();
    const resultNode = nodes.find(
      (n) => n.type === "audio" && n.title === "生成结果",
    );
    expect(resultNode).toBeDefined();

    expect(generateAudioIntoNode).toHaveBeenCalledWith(
      resultNode?.id,
      "good morning",
      { voice: "zh-CN", speed: 1.0 },
    );
  });

  it("no-config error: returns null, no node created, no seam called", async () => {
    // Config node with no metadata.config
    const config = addNode({
      type: "config",
      title: "生成配置",
    });

    const result = await runConfigGeneration(config.id);
    expect(result).toBeNull();
    expect(getCanvasState().nodes).toHaveLength(1);
    expect(generateImageIntoNode).not.toHaveBeenCalled();
    expect(generateVideoIntoNode).not.toHaveBeenCalled();
    expect(generateAudioIntoNode).not.toHaveBeenCalled();
  });
});
