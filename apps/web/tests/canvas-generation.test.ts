/**
 * canvas-generation.test.ts
 *
 * Tests for the generation seam (W2.2): canvas-generation.ts module.
 * All tests run in the plain Node env (no jsdom/browser).
 * SDK calls are mocked via vi.mock on the sdk.gen module path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateImageIntoNode,
  retryNodeTask,
} from "../src/lib/canvas/canvas-generation";
import {
  __resetCanvasForTests,
  addNode,
  getCanvasState,
  setNodeTask,
} from "../src/lib/canvas/canvas-store";

// Minimal localStorage polyfill (same as other canvas tests)
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

// Mock the SDK module before import — vi.mock is hoisted to the top of the file.
// Path is relative to the TEST file (apps/web/tests/ → apps/web/lib/api/sdk.gen).
vi.mock("../lib/api/sdk.gen", () => ({
  postApiV1MediaGenerateImage: vi.fn(),
}));

// Import the mocked SDK so tests can configure it per-scenario
import { postApiV1MediaGenerateImage } from "../lib/api/sdk.gen";
const mockGenerateImage = vi.mocked(postApiV1MediaGenerateImage);

beforeEach(() => {
  __resetCanvasForTests();
  vi.clearAllMocks();
});

describe("generateImageIntoNode", () => {
  it("a. success: node gets content + title, task cleared, resolves true", async () => {
    const node = addNode({ type: "image", title: "图片" });

    mockGenerateImage.mockResolvedValueOnce({
      data: { url: "http://localhost/img/abc.png", path: "/img/abc.png" },
      error: undefined,
      response: new Response(),
    } as never);

    const result = await generateImageIntoNode(node.id, "a cat on a mat");
    expect(result).toBe(true);

    const state = getCanvasState();
    const updated = state.nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.content).toBe("http://localhost/img/abc.png");
    expect(updated?.title).toBe("a cat on a mat");
    // task must be cleared (null → key absent)
    expect(updated?.metadata).not.toHaveProperty("task");
  });

  it("a. success: title is truncated to 30 chars", async () => {
    const node = addNode({ type: "image", title: "图片" });
    const longPrompt = "a".repeat(50);

    mockGenerateImage.mockResolvedValueOnce({
      data: { url: "http://localhost/img/xyz.png", path: "/img/xyz.png" },
      error: undefined,
      response: new Response(),
    } as never);

    await generateImageIntoNode(node.id, longPrompt);
    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.title).toHaveLength(30);
  });

  it("b. failure (error response): task = error with retry payload, resolves false", async () => {
    const node = addNode({ type: "image", title: "图片" });

    mockGenerateImage.mockResolvedValueOnce({
      data: undefined,
      error: { message: "timeout" },
      response: new Response(null, { status: 502 }),
    } as never);

    const result = await generateImageIntoNode(node.id, "blue sky");
    expect(result).toBe(false);

    const state = getCanvasState();
    const updated = state.nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.task?.status).toBe("error");
    expect(updated?.metadata.task?.error).toBe("生成失败，请重试");
    expect(updated?.metadata.task?.retry).toEqual({
      kind: "image",
      prompt: "blue sky",
    });
  });

  it("b. failure (thrown exception): task = error with retry payload, resolves false", async () => {
    const node = addNode({ type: "image", title: "图片" });

    mockGenerateImage.mockRejectedValueOnce(new Error("network error"));

    const result = await generateImageIntoNode(node.id, "sunset");
    expect(result).toBe(false);

    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.task?.status).toBe("error");
    expect(updated?.metadata.task?.retry?.prompt).toBe("sunset");
  });

  it("c. retryNodeTask re-invokes generateImageIntoNode with the same prompt", async () => {
    const node = addNode({ type: "image", title: "图片" });
    const prompt = "rainy forest";

    // First call: fail so retry payload is set
    mockGenerateImage.mockResolvedValueOnce({
      data: undefined,
      error: { message: "fail" },
      response: new Response(null, { status: 502 }),
    } as never);

    await generateImageIntoNode(node.id, prompt);

    // Second call (via retryNodeTask): succeed
    mockGenerateImage.mockResolvedValueOnce({
      data: { url: "http://localhost/img/retry.png", path: "/img/retry.png" },
      error: undefined,
      response: new Response(),
    } as never);

    retryNodeTask(node.id);
    // retryNodeTask is fire-and-forget; flush the microtask queue
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // mockGenerateImage was called twice with the same body
    expect(mockGenerateImage).toHaveBeenCalledTimes(2);
    const callArgs = mockGenerateImage.mock.calls.map(
      (call) => (call[0] as { body: { prompt: string } })?.body?.prompt,
    );
    expect(callArgs[0]).toBe(prompt);
    expect(callArgs[1]).toBe(prompt);
  });

  it("d. node deleted mid-flight: no throw, no zombie writes", async () => {
    const node = addNode({ type: "image", title: "图片" });
    const nodeId = node.id;

    // Arrange: SDK resolves after we've deleted the node
    let resolveGenerate!: (v: unknown) => void;
    mockGenerateImage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }) as never,
    );

    const pending = generateImageIntoNode(nodeId, "sunset");

    // Delete the node before the SDK responds
    const { removeNodes } = await import("../src/lib/canvas/canvas-store");
    removeNodes([nodeId]);
    expect(getCanvasState().nodes.find((n) => n.id === nodeId)).toBeUndefined();

    // Now resolve the SDK call
    resolveGenerate({
      data: { url: "http://localhost/img/done.png", path: "/img/done.png" },
      error: undefined,
      response: new Response(),
    });

    await expect(pending).resolves.toBe(false);
    // No zombie node should have been written back
    expect(getCanvasState().nodes.find((n) => n.id === nodeId)).toBeUndefined();
  });

  it("e. setNodeTask(null) removes the task key entirely (no `task` property)", () => {
    const node = addNode({ type: "image", title: "图片" });

    // Set a task first
    setNodeTask(node.id, {
      status: "generating",
      retry: { kind: "image", prompt: "test" },
    });
    const withTask = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(withTask?.metadata).toHaveProperty("task");

    // Clear it
    setNodeTask(node.id, null);
    const cleared = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(cleared?.metadata).not.toHaveProperty("task");
  });
});

describe("retryNodeTask", () => {
  it("is a no-op when there is no retry payload", () => {
    const node = addNode({ type: "image", title: "图片" });
    // No task set → retryNodeTask must not throw and must not call SDK
    retryNodeTask(node.id);
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it("is a no-op for an unknown node id", () => {
    retryNodeTask("ghost-node-id");
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });
});
