/**
 * preview-dialog.test.tsx — image lightbox: dialog store round-trip is
 * covered in canvas-dialogs.test.ts; this file covers the rendered markup
 * (image src/title/wheel-exempt) via the same CanvasSurface render pattern
 * used by infinite-canvas.test.tsx.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetCanvasBoardsForTests } from "../src/lib/canvas/canvas-boards";
import {
  __resetCanvasDialogsForTests,
  openCanvasDialog,
} from "../src/lib/canvas/canvas-dialogs";
import { __resetCanvasForTests, addNode } from "../src/lib/canvas/canvas-store";
import { __resetCanvasUiPrefsForTests } from "../src/lib/canvas/canvas-ui-prefs";
import { CanvasSurface } from "../src/lib/canvas/infinite-canvas";

// Plain-Node test env (same stub as infinite-canvas.test.tsx / hover-toolbar.test.tsx).
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
  __resetCanvasUiPrefsForTests();
  __resetCanvasBoardsForTests();
  __resetCanvasDialogsForTests();
});

describe("PreviewDialog", () => {
  it("renders the full-size image and node title when opened for an image node", () => {
    const node = addNode({
      type: "image",
      title: "封面图",
      metadata: { content: "data:image/png;base64,xyz" },
    });
    openCanvasDialog({ kind: "preview", nodeId: node.id });

    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain('data-canvas-preview-dialog="true"');
    expect(markup).toContain('src="data:image/png;base64,xyz"');
    expect(markup).toContain("封面图");
    // Wheel-exempt so native scroll/zoom of the dialog content doesn't
    // trigger the canvas's own wheel-zoom handler.
    expect(markup).toContain('data-canvas-wheel-exempt="true"');
  });

  it("renders nothing when the target node has no content", () => {
    const node = addNode({ type: "image", title: "empty", metadata: {} });
    openCanvasDialog({ kind: "preview", nodeId: node.id });

    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-preview-dialog");
  });

  it("renders nothing when no dialog is open", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: { content: "data:image/png;base64,xyz" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-preview-dialog");
  });
});
