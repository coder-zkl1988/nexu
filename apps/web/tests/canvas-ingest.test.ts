/**
 * canvas-ingest.test.ts
 *
 * Tests for the pure canvas ingestion helpers (W1.2 + W1.3).
 * Plain Node env — no jsdom, no FileReader, no DragEvent/ClipboardEvent.
 * We test the pure layer (mediaTypeForMime, ingestFilesAsNodes, ingestTextAsNode)
 * by inspecting canvas-store state directly.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  ingestFilesAsNodes,
  ingestTextAsNode,
  mediaTypeForMime,
} from "../src/lib/canvas/canvas-ingest";
import {
  __resetCanvasForTests,
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

describe("mediaTypeForMime", () => {
  it("a. image/png → image", () => {
    expect(mediaTypeForMime("image/png")).toBe("image");
  });

  it("a. video/mp4 → video", () => {
    expect(mediaTypeForMime("video/mp4")).toBe("video");
  });

  it("a. audio/mpeg → audio", () => {
    expect(mediaTypeForMime("audio/mpeg")).toBe("audio");
  });

  it("a. application/pdf → null", () => {
    expect(mediaTypeForMime("application/pdf")).toBeNull();
  });
});

describe("ingestFilesAsNodes", () => {
  it("b. 2 files at {x:100,y:50} → 2 nodes with correct offsets, types, titles, metadata; returns 2", () => {
    const files = [
      {
        name: "photo.png",
        type: "image/png",
        dataUrl: "data:image/png;base64,A",
      },
      {
        name: "clip.mp4",
        type: "video/mp4",
        dataUrl: "data:video/mp4;base64,B",
      },
    ];
    const count = ingestFilesAsNodes(files, { x: 100, y: 50 });
    expect(count).toBe(2);

    const { nodes } = getCanvasState();
    expect(nodes).toHaveLength(2);

    const img = nodes[0];
    expect(img?.type).toBe("image");
    expect(img?.title).toBe("photo.png");
    expect(img?.position).toEqual({ x: 100, y: 50 });
    expect(img?.metadata.content).toBe("data:image/png;base64,A");
    expect(img?.metadata.mimeType).toBe("image/png");

    const vid = nodes[1];
    expect(vid?.type).toBe("video");
    expect(vid?.title).toBe("clip.mp4");
    expect(vid?.position).toEqual({ x: 124, y: 74 });
    expect(vid?.metadata.content).toBe("data:video/mp4;base64,B");
    expect(vid?.metadata.mimeType).toBe("video/mp4");
  });

  it("c. unknown MIME skipped — returns count without it, no node added", () => {
    const files = [
      {
        name: "doc.pdf",
        type: "application/pdf",
        dataUrl: "data:application/pdf;base64,X",
      },
      {
        name: "song.mp3",
        type: "audio/mpeg",
        dataUrl: "data:audio/mpeg;base64,Y",
      },
    ];
    const count = ingestFilesAsNodes(files, { x: 0, y: 0 });
    expect(count).toBe(1); // only the audio file

    const { nodes } = getCanvasState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.title).toBe("song.mp3");
  });

  it("c. stagger offset uses CREATED count, not input index (skip.pdf=skipped, images=contiguous)", () => {
    const files = [
      {
        name: "skip.pdf",
        type: "application/pdf",
        dataUrl: "data:application/pdf;base64,D",
      },
      {
        name: "a.png",
        type: "image/png",
        dataUrl: "data:image/png;base64,D1",
      },
      {
        name: "b.png",
        type: "image/png",
        dataUrl: "data:image/png;base64,D2",
      },
    ];
    const count = ingestFilesAsNodes(files, { x: 10, y: 20 });
    expect(count).toBe(2); // only the two images

    const { nodes } = getCanvasState();
    expect(nodes).toHaveLength(2);

    // First image at (10, 20) — created index 0
    expect(nodes[0]?.title).toBe("a.png");
    expect(nodes[0]?.position).toEqual({ x: 10, y: 20 });

    // Second image at (34, 44) — created index 1, no gap for the skipped pdf
    expect(nodes[1]?.title).toBe("b.png");
    expect(nodes[1]?.position).toEqual({ x: 34, y: 44 });
  });
});

describe("ingestTextAsNode", () => {
  it("d. creates a text node with full content and 20-char title", () => {
    const longText = "The quick brown fox jumps over the lazy dog";
    ingestTextAsNode(longText, { x: 50, y: 50 });

    const { nodes } = getCanvasState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("text");
    expect(nodes[0]?.title).toBe("The quick brown fox ");
    expect(nodes[0]?.metadata.content).toBe(longText);
    expect(nodes[0]?.position).toEqual({ x: 50, y: 50 });
  });

  it("d. empty string creates nothing", () => {
    ingestTextAsNode("", { x: 0, y: 0 });
    expect(getCanvasState().nodes).toHaveLength(0);
  });

  it("d. whitespace-only string creates nothing", () => {
    ingestTextAsNode("   \n\t  ", { x: 0, y: 0 });
    expect(getCanvasState().nodes).toHaveLength(0);
  });

  it("d. short text: title equals full text when under 20 chars", () => {
    ingestTextAsNode("Hello", { x: 10, y: 10 });
    const { nodes } = getCanvasState();
    expect(nodes[0]?.title).toBe("Hello");
    expect(nodes[0]?.metadata.content).toBe("Hello");
  });
});
