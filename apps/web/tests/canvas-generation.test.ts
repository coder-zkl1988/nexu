/**
 * canvas-generation.test.ts
 *
 * Tests for the generation seam (W2.2 + W2.4 extension): canvas-generation.ts.
 * All tests run in the plain Node env (no jsdom/browser).
 * SDK calls are mocked via vi.mock on the sdk.gen module path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeImageSource,
  enhanceImageIntoNode,
  generateAudioIntoNode,
  generateImageIntoNode,
  generateVideoIntoNode,
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
  postApiV1MediaGenerateVideo: vi.fn(),
  postApiV1MediaGenerateAudio: vi.fn(),
  postApiV1MediaEnhanceImage: vi.fn(),
  postApiV1MediaDescribeImage: vi.fn(),
}));

// Import the mocked SDK so tests can configure it per-scenario
import {
  postApiV1MediaDescribeImage,
  postApiV1MediaEnhanceImage,
  postApiV1MediaGenerateAudio,
  postApiV1MediaGenerateImage,
  postApiV1MediaGenerateVideo,
} from "../lib/api/sdk.gen";
const mockGenerateImage = vi.mocked(postApiV1MediaGenerateImage);
const mockGenerateVideo = vi.mocked(postApiV1MediaGenerateVideo);
const mockGenerateAudio = vi.mocked(postApiV1MediaGenerateAudio);
const mockEnhanceImage = vi.mocked(postApiV1MediaEnhanceImage);
const mockDescribeImage = vi.mocked(postApiV1MediaDescribeImage);

beforeEach(() => {
  __resetCanvasForTests();
  vi.clearAllMocks();
});

describe("generateImageIntoNode", () => {
  it("a. success: node gets content + title, task cleared, resolves true", async () => {
    const node = addNode({ type: "image", title: "图片" });

    mockGenerateImage.mockResolvedValueOnce({
      data: {
        url: "http://localhost/img/abc.png",
        path: "/img/abc.png",
        items: [{ url: "http://localhost/img/abc.png", path: "/img/abc.png" }],
      },
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
      data: {
        url: "http://localhost/img/xyz.png",
        path: "/img/xyz.png",
        items: [{ url: "http://localhost/img/xyz.png", path: "/img/xyz.png" }],
      },
      error: undefined,
      response: new Response(),
    } as never);

    await generateImageIntoNode(node.id, longPrompt);
    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.title).toHaveLength(30);
  });

  it("forwards referenceImages and count in the SDK body", async () => {
    const node = addNode({ type: "image", title: "图片" });
    mockGenerateImage.mockResolvedValueOnce({
      data: {
        url: "http://localhost/img/r.png",
        path: "/img/r.png",
        items: [{ url: "http://localhost/img/r.png", path: "/img/r.png" }],
      },
      error: undefined,
      response: new Response(),
    } as never);

    await generateImageIntoNode(node.id, "sky", {
      referenceImages: ["/img/ref1.png"],
      count: 2,
    });

    expect(mockGenerateImage).toHaveBeenCalledWith({
      body: {
        prompt: "sky",
        referenceImages: ["/img/ref1.png"],
        count: 2,
      },
    });
  });

  it("retry payload includes referenceImages and count", async () => {
    const node = addNode({ type: "image", title: "图片" });
    mockGenerateImage.mockResolvedValueOnce({
      data: undefined,
      error: { message: "fail" },
      response: new Response(null, { status: 502 }),
    } as never);

    await generateImageIntoNode(node.id, "blue sky", {
      referenceImages: ["/img/x.png"],
      count: 3,
    });

    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.task?.retry).toEqual({
      kind: "image",
      prompt: "blue sky",
      referenceImages: ["/img/x.png"],
      count: 3,
    });
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
      data: {
        url: "http://localhost/img/retry.png",
        path: "/img/retry.png",
        items: [
          { url: "http://localhost/img/retry.png", path: "/img/retry.png" },
        ],
      },
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
      data: {
        url: "http://localhost/img/done.png",
        path: "/img/done.png",
        items: [
          { url: "http://localhost/img/done.png", path: "/img/done.png" },
        ],
      },
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

describe("generateVideoIntoNode", () => {
  it("success: node gets content + title, task cleared, resolves true", async () => {
    const node = addNode({ type: "video", title: "视频" });

    mockGenerateVideo.mockResolvedValueOnce({
      data: {
        url: "http://localhost/vid/abc.mp4",
        path: "/vid/abc.mp4",
        items: [{ url: "http://localhost/vid/abc.mp4", path: "/vid/abc.mp4" }],
      },
      error: undefined,
      response: new Response(),
    } as never);

    const result = await generateVideoIntoNode(node.id, "a sunset video", {
      durationSeconds: 10,
      resolution: "1080p",
    });
    expect(result).toBe(true);

    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.content).toBe("http://localhost/vid/abc.mp4");
    expect(updated?.metadata).not.toHaveProperty("task");
  });

  it("forwards durationSeconds and resolution in SDK body", async () => {
    const node = addNode({ type: "video", title: "视频" });
    mockGenerateVideo.mockResolvedValueOnce({
      data: {
        url: "http://localhost/vid/x.mp4",
        path: "/vid/x.mp4",
        items: [{ url: "http://localhost/vid/x.mp4", path: "/vid/x.mp4" }],
      },
      error: undefined,
      response: new Response(),
    } as never);

    await generateVideoIntoNode(node.id, "forest", {
      durationSeconds: 15,
      resolution: "720p",
    });

    expect(mockGenerateVideo).toHaveBeenCalledWith({
      body: { prompt: "forest", durationSeconds: 15, resolution: "720p" },
    });
  });

  it("error: task=error with retry payload including params, resolves false", async () => {
    const node = addNode({ type: "video", title: "视频" });
    mockGenerateVideo.mockResolvedValueOnce({
      data: undefined,
      error: { message: "fail" },
      response: new Response(null, { status: 502 }),
    } as never);

    const result = await generateVideoIntoNode(node.id, "ocean", {
      durationSeconds: 5,
      resolution: "1080p",
    });
    expect(result).toBe(false);

    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.task?.status).toBe("error");
    expect(updated?.metadata.task?.retry).toEqual({
      kind: "video",
      prompt: "ocean",
      durationSeconds: 5,
      resolution: "1080p",
    });
  });

  it("retryNodeTask re-runs video generation with same params", async () => {
    const node = addNode({ type: "video", title: "视频" });

    // First call fails
    mockGenerateVideo.mockResolvedValueOnce({
      data: undefined,
      error: { message: "fail" },
      response: new Response(null, { status: 502 }),
    } as never);
    await generateVideoIntoNode(node.id, "stars", { durationSeconds: 8 });

    // Second call succeeds
    mockGenerateVideo.mockResolvedValueOnce({
      data: {
        url: "http://localhost/vid/retry.mp4",
        path: "/vid/retry.mp4",
        items: [
          {
            url: "http://localhost/vid/retry.mp4",
            path: "/vid/retry.mp4",
          },
        ],
      },
      error: undefined,
      response: new Response(),
    } as never);

    retryNodeTask(node.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mockGenerateVideo).toHaveBeenCalledTimes(2);
    const body2 = (
      mockGenerateVideo.mock.calls[1]?.[0] as {
        body: { durationSeconds?: number };
      }
    )?.body;
    expect(body2?.durationSeconds).toBe(8);
  });
});

describe("generateAudioIntoNode", () => {
  it("success: node gets content + title, task cleared, resolves true", async () => {
    const node = addNode({ type: "audio", title: "音频" });

    mockGenerateAudio.mockResolvedValueOnce({
      data: {
        url: "http://localhost/aud/abc.mp3",
        path: "/aud/abc.mp3",
        items: [{ url: "http://localhost/aud/abc.mp3", path: "/aud/abc.mp3" }],
      },
      error: undefined,
      response: new Response(),
    } as never);

    const result = await generateAudioIntoNode(node.id, "narrate this", {
      voice: "alloy",
      speed: 1.5,
    });
    expect(result).toBe(true);

    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.content).toBe("http://localhost/aud/abc.mp3");
    expect(updated?.metadata).not.toHaveProperty("task");
  });

  it("forwards voice and speed in SDK body", async () => {
    const node = addNode({ type: "audio", title: "音频" });
    mockGenerateAudio.mockResolvedValueOnce({
      data: {
        url: "http://localhost/aud/x.mp3",
        path: "/aud/x.mp3",
        items: [{ url: "http://localhost/aud/x.mp3", path: "/aud/x.mp3" }],
      },
      error: undefined,
      response: new Response(),
    } as never);

    await generateAudioIntoNode(node.id, "hello", { voice: "nova", speed: 2 });

    expect(mockGenerateAudio).toHaveBeenCalledWith({
      body: { prompt: "hello", voice: "nova", speed: 2 },
    });
  });

  it("error: task=error with retry payload including params, resolves false", async () => {
    const node = addNode({ type: "audio", title: "音频" });
    mockGenerateAudio.mockResolvedValueOnce({
      data: undefined,
      error: { message: "fail" },
      response: new Response(null, { status: 502 }),
    } as never);

    const result = await generateAudioIntoNode(node.id, "hello", {
      voice: "alloy",
      speed: 0.5,
    });
    expect(result).toBe(false);

    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.task?.status).toBe("error");
    expect(updated?.metadata.task?.retry).toEqual({
      kind: "audio",
      prompt: "hello",
      voice: "alloy",
      speed: 0.5,
    });
  });

  it("retryNodeTask re-runs audio generation with same params", async () => {
    const node = addNode({ type: "audio", title: "音频" });

    mockGenerateAudio.mockResolvedValueOnce({
      data: undefined,
      error: { message: "fail" },
      response: new Response(null, { status: 502 }),
    } as never);
    await generateAudioIntoNode(node.id, "hey", { voice: "echo" });

    mockGenerateAudio.mockResolvedValueOnce({
      data: {
        url: "http://localhost/aud/retry.mp3",
        path: "/aud/retry.mp3",
        items: [
          {
            url: "http://localhost/aud/retry.mp3",
            path: "/aud/retry.mp3",
          },
        ],
      },
      error: undefined,
      response: new Response(),
    } as never);

    retryNodeTask(node.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mockGenerateAudio).toHaveBeenCalledTimes(2);
    const body2 = (
      mockGenerateAudio.mock.calls[1]?.[0] as { body: { voice?: string } }
    )?.body;
    expect(body2?.voice).toBe("echo");
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

describe("generateImageIntoNode sourceImage/maskDataUrl extensions", () => {
  it("forwards sourceImage and maskDataUrl in SDK body", async () => {
    const node = addNode({ type: "image", title: "图片" });
    mockGenerateImage.mockResolvedValueOnce({
      data: {
        url: "http://localhost/img/inpaint.png",
        path: "/img/inpaint.png",
        items: [
          { url: "http://localhost/img/inpaint.png", path: "/img/inpaint.png" },
        ],
      },
      error: undefined,
      response: new Response(),
    } as never);

    await generateImageIntoNode(node.id, "a dog", {
      sourceImage: "/path/to/source.png",
      maskDataUrl: "data:image/png;base64,maskdata",
    });

    expect(mockGenerateImage).toHaveBeenCalledWith({
      body: {
        prompt: "a dog",
        sourceImage: "/path/to/source.png",
        maskDataUrl: "data:image/png;base64,maskdata",
      },
    });
  });

  it("retry payload includes sourceImage and maskDataUrl on failure", async () => {
    const node = addNode({ type: "image", title: "图片" });
    mockGenerateImage.mockResolvedValueOnce({
      data: undefined,
      error: { message: "502" },
      response: new Response(null, { status: 502 }),
    } as never);

    await generateImageIntoNode(node.id, "repaint", {
      sourceImage: "/src/img.png",
      maskDataUrl: "data:image/png;base64,mask",
    });

    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.task?.retry).toEqual({
      kind: "image",
      prompt: "repaint",
      sourceImage: "/src/img.png",
      maskDataUrl: "data:image/png;base64,mask",
    });
  });

  it("retryNodeTask re-runs with sourceImage and maskDataUrl preserved", async () => {
    const node = addNode({ type: "image", title: "图片" });

    mockGenerateImage.mockResolvedValueOnce({
      data: undefined,
      error: { message: "fail" },
      response: new Response(null, { status: 502 }),
    } as never);
    await generateImageIntoNode(node.id, "redo", {
      sourceImage: "/img/s.png",
      maskDataUrl: "data:image/png;base64,m",
    });

    mockGenerateImage.mockResolvedValueOnce({
      data: {
        url: "http://localhost/img/retried.png",
        path: "/img/retried.png",
        items: [
          { url: "http://localhost/img/retried.png", path: "/img/retried.png" },
        ],
      },
      error: undefined,
      response: new Response(),
    } as never);

    retryNodeTask(node.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mockGenerateImage).toHaveBeenCalledTimes(2);
    const call2 = (
      mockGenerateImage.mock.calls[1]?.[0] as { body: Record<string, unknown> }
    )?.body;
    expect(call2?.sourceImage).toBe("/img/s.png");
    expect(call2?.maskDataUrl).toBe("data:image/png;base64,m");
  });
});

describe("enhanceImageIntoNode", () => {
  it("success: node gets content, task cleared, resolves true", async () => {
    const node = addNode({ type: "image", title: "图片" });
    mockEnhanceImage.mockResolvedValueOnce({
      data: {
        url: "http://localhost/img/enhanced.png",
        path: "/img/enhanced.png",
        items: [
          {
            url: "http://localhost/img/enhanced.png",
            path: "/img/enhanced.png",
          },
        ],
      },
      error: undefined,
      response: new Response(),
    } as never);

    const result = await enhanceImageIntoNode(node.id, {
      sourceImage: "/path/to/src.png",
      operation: "super-resolve",
      targetLongEdge: 2048,
    });

    expect(result).toBe(true);
    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.content).toBe("http://localhost/img/enhanced.png");
    expect(updated?.metadata).not.toHaveProperty("task");
  });

  it("failure (error response): task=error with enhance retry payload, resolves false", async () => {
    const node = addNode({ type: "image", title: "图片" });
    mockEnhanceImage.mockResolvedValueOnce({
      data: undefined,
      error: { message: "502 unavailable" },
      response: new Response(null, { status: 502 }),
    } as never);

    const result = await enhanceImageIntoNode(node.id, {
      sourceImage: "/path/to/src.png",
      operation: "multi-angle",
      horizontalDeg: 30,
      pitchDeg: -10,
      distance: 5,
      wideAngle: false,
    });

    expect(result).toBe(false);
    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.task?.status).toBe("error");
    expect(updated?.metadata.task?.retry).toEqual({
      kind: "enhance",
      sourceImage: "/path/to/src.png",
      operation: "multi-angle",
      horizontalDeg: 30,
      pitchDeg: -10,
      distance: 5,
      wideAngle: false,
    });
  });

  it("failure (thrown): task=error with retry payload, resolves false", async () => {
    const node = addNode({ type: "image", title: "图片" });
    mockEnhanceImage.mockRejectedValueOnce(new Error("network"));

    const result = await enhanceImageIntoNode(node.id, {
      sourceImage: "/img/x.png",
      operation: "super-resolve",
    });

    expect(result).toBe(false);
    const updated = getCanvasState().nodes.find((n) => n.id === node.id);
    expect(updated?.metadata.task?.status).toBe("error");
    expect(updated?.metadata.task?.retry?.kind).toBe("enhance");
  });

  it("forwards all enhance params in SDK body", async () => {
    const node = addNode({ type: "image", title: "图片" });
    mockEnhanceImage.mockResolvedValueOnce({
      data: {
        url: "http://localhost/img/e.png",
        path: "/img/e.png",
        items: [{ url: "http://localhost/img/e.png", path: "/img/e.png" }],
      },
      error: undefined,
      response: new Response(),
    } as never);

    await enhanceImageIntoNode(node.id, {
      sourceImage: "/img/src.png",
      operation: "multi-angle",
      horizontalDeg: 45,
      pitchDeg: -20,
      distance: 7,
      wideAngle: true,
      prompt: "wide view",
    });

    expect(mockEnhanceImage).toHaveBeenCalledWith({
      body: {
        sourceImage: "/img/src.png",
        operation: "multi-angle",
        horizontalDeg: 45,
        pitchDeg: -20,
        distance: 7,
        wideAngle: true,
        prompt: "wide view",
      },
    });
  });

  it("retryNodeTask dispatches enhanceImageIntoNode for enhance kind", async () => {
    const node = addNode({ type: "image", title: "图片" });

    // First: fail to set retry
    mockEnhanceImage.mockResolvedValueOnce({
      data: undefined,
      error: { message: "fail" },
      response: new Response(null, { status: 502 }),
    } as never);
    await enhanceImageIntoNode(node.id, {
      sourceImage: "/img/r.png",
      operation: "super-resolve",
      targetLongEdge: 4096,
    });

    // Second: succeed via retry
    mockEnhanceImage.mockResolvedValueOnce({
      data: {
        url: "http://localhost/img/retried.png",
        path: "/img/retried.png",
        items: [
          { url: "http://localhost/img/retried.png", path: "/img/retried.png" },
        ],
      },
      error: undefined,
      response: new Response(),
    } as never);

    retryNodeTask(node.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mockEnhanceImage).toHaveBeenCalledTimes(2);
    const call2 = (
      mockEnhanceImage.mock.calls[1]?.[0] as { body: Record<string, unknown> }
    )?.body;
    expect(call2?.targetLongEdge).toBe(4096);
    expect(call2?.operation).toBe("super-resolve");
  });
});

describe("describeImageSource", () => {
  it("success: returns trimmed prompt string", async () => {
    mockDescribeImage.mockResolvedValueOnce({
      data: { prompt: "  a beautiful landscape  " },
      error: undefined,
      response: new Response(),
    } as never);

    const result = await describeImageSource("/img/source.png");
    expect(result).toBe("a beautiful landscape");
  });

  it("failure (error response): returns null", async () => {
    mockDescribeImage.mockResolvedValueOnce({
      data: undefined,
      error: { message: "unavailable" },
      response: new Response(null, { status: 502 }),
    } as never);

    const result = await describeImageSource("/img/source.png");
    expect(result).toBeNull();
  });

  it("failure (thrown): returns null without throwing", async () => {
    mockDescribeImage.mockRejectedValueOnce(new Error("network"));

    const result = await describeImageSource("/img/source.png");
    expect(result).toBeNull();
  });

  it("forwards sourceImage in SDK body", async () => {
    mockDescribeImage.mockResolvedValueOnce({
      data: { prompt: "test" },
      error: undefined,
      response: new Response(),
    } as never);

    await describeImageSource("/img/my-photo.png");
    expect(mockDescribeImage).toHaveBeenCalledWith({
      body: { sourceImage: "/img/my-photo.png" },
    });
  });
});
