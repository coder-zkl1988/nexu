/**
 * text-node-utils.test.ts — TDD for nextFontSize and textNodeToImage (W3.4)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── nextFontSize ───────────────────────────────────────────────

import {
  TEXT_FONT_MAX,
  TEXT_FONT_MIN,
  TEXT_FONT_STEP,
  nextFontSize,
} from "../src/lib/canvas/text-node-utils";

describe("nextFontSize", () => {
  it("constants are correct", () => {
    expect(TEXT_FONT_MIN).toBe(10);
    expect(TEXT_FONT_MAX).toBe(48);
    expect(TEXT_FONT_STEP).toBe(2);
  });

  it("undefined current uses base 14, +1 → 16", () => {
    expect(nextFontSize(undefined, 1)).toBe(16);
  });

  it("undefined current uses base 14, -1 → 12", () => {
    expect(nextFontSize(undefined, -1)).toBe(12);
  });

  it("increments by 2", () => {
    expect(nextFontSize(14, 1)).toBe(16);
    expect(nextFontSize(20, 1)).toBe(22);
  });

  it("decrements by 2", () => {
    expect(nextFontSize(14, -1)).toBe(12);
    expect(nextFontSize(20, -1)).toBe(18);
  });

  it("clamps at minimum 10 (no-op when already at min)", () => {
    expect(nextFontSize(10, -1)).toBe(10);
    expect(nextFontSize(11, -1)).toBe(10); // rounds down via clamp
  });

  it("clamps at maximum 48 (no-op when already at max)", () => {
    expect(nextFontSize(48, 1)).toBe(48);
    expect(nextFontSize(47, 1)).toBe(48); // would be 49, clamped to 48
  });
});

// ── textNodeToImage ────────────────────────────────────────────

// Mock canvas-create and canvas-generation BEFORE importing the module under test.
vi.mock("../src/lib/canvas/canvas-create", () => ({
  createConnectedNode: vi.fn(),
}));
vi.mock("../src/lib/canvas/canvas-generation", () => ({
  generateImageIntoNode: vi.fn(),
}));

import { createConnectedNode } from "../src/lib/canvas/canvas-create";
import { generateImageIntoNode } from "../src/lib/canvas/canvas-generation";
import { textNodeToImage } from "../src/lib/canvas/text-node-utils";

const mockCreateConnectedNode = vi.mocked(createConnectedNode);
const mockGenerateImageIntoNode = vi.mocked(generateImageIntoNode);

// Minimal localStorage polyfill (canvas-store needs it)
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

import { __resetCanvasForTests, addNode } from "../src/lib/canvas/canvas-store";

beforeEach(() => {
  __resetCanvasForTests();
  vi.clearAllMocks();
});

describe("textNodeToImage", () => {
  it("returns false when node does not exist", () => {
    expect(textNodeToImage("ghost-id")).toBe(false);
    expect(mockCreateConnectedNode).not.toHaveBeenCalled();
  });

  it("returns false when node content is empty (trimmed)", () => {
    const node = addNode({
      type: "text",
      title: "note",
      metadata: { content: "   " },
    });
    expect(textNodeToImage(node.id)).toBe(false);
    expect(mockCreateConnectedNode).not.toHaveBeenCalled();
  });

  it("returns false when node has no content", () => {
    const node = addNode({ type: "text", title: "note", metadata: {} });
    expect(textNodeToImage(node.id)).toBe(false);
    expect(mockCreateConnectedNode).not.toHaveBeenCalled();
  });

  it("creates connected image node at right-edge midpoint + 60px gap", () => {
    const node = addNode({
      type: "text",
      title: "note",
      metadata: { content: "hello world" },
    });

    const fakeImageNode = { id: "img-1", type: "image" } as never;
    mockCreateConnectedNode.mockReturnValue(fakeImageNode);
    mockGenerateImageIntoNode.mockResolvedValue(true);

    const result = textNodeToImage(node.id);

    expect(result).toBe(true);
    expect(mockCreateConnectedNode).toHaveBeenCalledWith(
      node.id,
      "image",
      expect.objectContaining({
        x: node.position.x + node.size.width + 60,
        y: node.position.y + node.size.height / 2,
      }),
    );
  });

  it("dispatches generateImageIntoNode with trimmed content", () => {
    const node = addNode({
      type: "text",
      title: "note",
      metadata: { content: "  generate me  " },
    });

    const fakeImageNode = { id: "img-2", type: "image" } as never;
    mockCreateConnectedNode.mockReturnValue(fakeImageNode);
    mockGenerateImageIntoNode.mockResolvedValue(true);

    textNodeToImage(node.id);

    expect(mockGenerateImageIntoNode).toHaveBeenCalledWith(
      "img-2",
      "generate me",
    );
  });

  it("returns false when createConnectedNode returns null", () => {
    const node = addNode({
      type: "text",
      title: "note",
      metadata: { content: "hello" },
    });
    mockCreateConnectedNode.mockReturnValue(null);

    const result = textNodeToImage(node.id);

    expect(result).toBe(false);
    expect(mockGenerateImageIntoNode).not.toHaveBeenCalled();
  });
});
