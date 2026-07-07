import { describe, expect, it } from "vitest";
// Import the real nexu-canvas plugin helpers so this guards the exact surfaced
// payload the T6 frontend parses (fenced ```canvas-op``` block) and the compact
// mirror rendering the agent reads.
import {
  buildCanvasOpResult,
  renderMirror,
} from "../static/runtime-plugins/nexu-canvas/index.js";

function firstText(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

describe("buildCanvasOpResult (canvas_op courier)", () => {
  it("wraps the batch in a fenced canvas-op block carrying the JSON", () => {
    const ops = [
      { op: "add_node", ref: "a", nodeType: "text", title: "Note" },
      { op: "connect", from: "ref:a", to: "node-existing" },
    ];
    const result = buildCanvasOpResult(ops, "add a note and wire it");
    const block = firstText(result);
    expect(block.startsWith("```canvas-op\n")).toBe(true);
    expect(block.endsWith("\n```")).toBe(true);

    const json = block.slice("```canvas-op\n".length, -"\n```".length);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ ops, summary: "add a note and wire it" });
  });

  it("omits summary from the payload when not provided", () => {
    const ops = [{ op: "delete_node", target: "n1" }];
    const block = firstText(buildCanvasOpResult(ops, undefined));
    const json = block.slice("```canvas-op\n".length, -"\n```".length);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ ops });
    expect(parsed).not.toHaveProperty("summary");
  });

  it("carries a second text part instructing a short confirmation", () => {
    const result = buildCanvasOpResult([{ op: "delete_node", target: "n1" }]);
    const meta = JSON.parse(result.content[1].text);
    expect(meta.proposed).toBe(true);
    expect(meta.opCount).toBe(1);
  });
});

describe("renderMirror (canvas_read rendering)", () => {
  it("renders a legend, board summary and terse node/connection lines", () => {
    const text = renderMirror({
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
      connections: [{ id: "c1", from: "node-1", to: "node-2" }],
      viewport: { x: 0, y: 0, scale: 1 },
      selectedNodeIds: ["node-1"],
    });
    expect(text).toContain("legend");
    expect(text).toContain("board=sidebar nodes=1 connections=1");
    expect(text).toContain("selected: node-1");
    // content marker `*` present for a filled node.
    expect(text).toContain("node-1 [image]");
    expect(text).toContain("*");
    expect(text).toContain("c1: node-1 -> node-2");
  });

  it("notes an empty board", () => {
    const text = renderMirror({
      boardId: "sidebar",
      nodes: [],
      connections: [],
      viewport: { x: 0, y: 0, scale: 1 },
      selectedNodeIds: [],
    });
    expect(text).toContain("(no nodes yet)");
  });
});
