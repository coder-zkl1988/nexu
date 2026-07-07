import type { CanvasMirror } from "@nexu/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  getCanvasMirror,
  setCanvasMirror,
} from "../src/services/canvas-mirror-service.js";

const EMPTY_DEFAULT: CanvasMirror = {
  boardId: "sidebar",
  nodes: [],
  connections: [],
  viewport: { x: 0, y: 0, scale: 1 },
  selectedNodeIds: [],
  assets: [],
};

describe("canvas mirror service", () => {
  afterEach(() => {
    // Reset the singleton so tests do not leak state into one another.
    setCanvasMirror(EMPTY_DEFAULT);
  });

  it("defaults to an empty sidebar mirror", () => {
    // Fresh process defaults; assert the shape the plugin's canvas_read sees
    // before the frontend has ever pushed.
    expect(getCanvasMirror()).toEqual(EMPTY_DEFAULT);
  });

  it("round-trips the latest pushed mirror", () => {
    const mirror: CanvasMirror = {
      boardId: "sidebar",
      nodes: [
        {
          id: "node-1",
          type: "image",
          title: "Cat",
          x: 10,
          y: 20,
          w: 320,
          h: 240,
          hasContent: true,
        },
      ],
      connections: [{ id: "c1", from: "node-1", to: "node-1" }],
      viewport: { x: -5, y: 7, scale: 0.5 },
      selectedNodeIds: ["node-1"],
    };
    setCanvasMirror(mirror);
    expect(getCanvasMirror()).toEqual(mirror);
  });

  it("replaces the whole mirror on each set (no merge)", () => {
    setCanvasMirror({
      boardId: "sidebar",
      nodes: [
        {
          id: "a",
          type: "text",
          title: "A",
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          hasContent: false,
        },
      ],
      connections: [],
      viewport: { x: 0, y: 0, scale: 1 },
      selectedNodeIds: [],
    });
    setCanvasMirror(EMPTY_DEFAULT);
    expect(getCanvasMirror().nodes).toEqual([]);
  });
});
