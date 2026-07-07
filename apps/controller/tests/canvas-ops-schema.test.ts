import {
  canvasMirrorSchema,
  canvasOpBatchSchema,
  canvasOpSchema,
} from "@nexu/shared";
import { describe, expect, it } from "vitest";

describe("canvasOpSchema", () => {
  it("parses each of the 8 op kinds", () => {
    const ops = [
      { op: "add_node", ref: "n1", nodeType: "text" },
      { op: "update_node", target: "ref:n1", title: "hi" },
      { op: "delete_node", target: "node-abc" },
      { op: "connect", from: "ref:n1", to: "node-abc" },
      { op: "delete_connection", connectionId: "conn-1" },
      { op: "set_viewport", x: 10, y: 20, scale: 1.5 },
      { op: "select", targets: ["node-a", "node-b"] },
      { op: "run_generation", target: "node-img", prompt: "a cat" },
    ];
    for (const op of ops) {
      expect(canvasOpSchema.safeParse(op).success).toBe(true);
    }
  });

  it("requires a ref on add_node", () => {
    expect(
      canvasOpSchema.safeParse({ op: "add_node", nodeType: "text" }).success,
    ).toBe(false);
    expect(
      canvasOpSchema.safeParse({ op: "add_node", ref: "", nodeType: "text" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown nodeType on add_node", () => {
    expect(
      canvasOpSchema.safeParse({
        op: "add_node",
        ref: "n1",
        nodeType: "sticker",
      }).success,
    ).toBe(false);
  });

  it("enforces set_viewport scale bounds [0.05, 5]", () => {
    expect(
      canvasOpSchema.safeParse({ op: "set_viewport", x: 0, y: 0, scale: 0.04 })
        .success,
    ).toBe(false);
    expect(
      canvasOpSchema.safeParse({ op: "set_viewport", x: 0, y: 0, scale: 5.1 })
        .success,
    ).toBe(false);
    expect(
      canvasOpSchema.safeParse({ op: "set_viewport", x: 0, y: 0, scale: 0.05 })
        .success,
    ).toBe(true);
    expect(
      canvasOpSchema.safeParse({ op: "set_viewport", x: 0, y: 0, scale: 5 })
        .success,
    ).toBe(true);
  });

  it("rejects an unknown op discriminator", () => {
    expect(
      canvasOpSchema.safeParse({ op: "teleport", target: "x" }).success,
    ).toBe(false);
  });
});

describe("canvasOpBatchSchema", () => {
  const validOp = { op: "delete_node", target: "n1" } as const;

  it("requires at least one op", () => {
    expect(canvasOpBatchSchema.safeParse({ ops: [] }).success).toBe(false);
  });

  it("caps the batch at 50 ops", () => {
    const fiftyOne = Array.from({ length: 51 }, () => validOp);
    expect(canvasOpBatchSchema.safeParse({ ops: fiftyOne }).success).toBe(
      false,
    );
    const fifty = Array.from({ length: 50 }, () => validOp);
    expect(canvasOpBatchSchema.safeParse({ ops: fifty }).success).toBe(true);
  });

  it("accepts an optional summary", () => {
    const parsed = canvasOpBatchSchema.parse({
      ops: [validOp],
      summary: "delete one",
    });
    expect(parsed.summary).toBe("delete one");
  });
});

describe("canvasMirrorSchema", () => {
  it("round-trips a populated mirror including a2ui/team-step node types", () => {
    const mirror = {
      boardId: "sidebar",
      nodes: [
        {
          id: "node-1",
          type: "image",
          title: "Cat",
          x: 0,
          y: 0,
          w: 320,
          h: 240,
          hasContent: true,
        },
        {
          id: "node-2",
          type: "team-step",
          title: "Draft",
          x: 400,
          y: 0,
          w: 280,
          h: 160,
          hasContent: false,
        },
        {
          id: "node-3",
          type: "a2ui",
          title: "Card",
          x: 0,
          y: 300,
          w: 300,
          h: 200,
          hasContent: true,
        },
      ],
      connections: [{ id: "c1", from: "node-1", to: "node-2" }],
      viewport: { x: 12, y: -8, scale: 0.75 },
      selectedNodeIds: ["node-1"],
    };
    const parsed = canvasMirrorSchema.parse(mirror);
    expect(parsed).toEqual(mirror);
  });

  it("rejects a node with an out-of-vocabulary type", () => {
    const bad = {
      boardId: "sidebar",
      nodes: [
        {
          id: "node-1",
          type: "spreadsheet",
          title: "x",
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
    };
    expect(canvasMirrorSchema.safeParse(bad).success).toBe(false);
  });
});
