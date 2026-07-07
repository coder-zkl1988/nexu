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

describe("canvasOpSchema — image-editing ops (image-ops B)", () => {
  it("parses each of the 5 image-editing ops", () => {
    const ops = [
      { op: "crop_image", target: "node-1", x: 0, y: 0, w: 100, h: 80 },
      { op: "split_image", target: "node-1", rows: 2, cols: 3 },
      {
        op: "upscale_image",
        target: "node-1",
        targetLongEdge: 2048,
        algorithm: "high",
      },
      {
        op: "enhance_image",
        target: "ref:n1",
        operation: "multi-angle",
        horizontalDeg: 30,
        pitchDeg: -10,
        distance: 4,
        wideAngle: true,
        prompt: "front view",
      },
      { op: "enhance_image", target: "node-1", operation: "super-resolve" },
      { op: "describe_image", target: "node-1" },
    ];
    for (const op of ops) {
      expect(canvasOpSchema.safeParse(op).success).toBe(true);
    }
  });

  it("rejects crop_image with non-positive / oversized w/h", () => {
    expect(
      canvasOpSchema.safeParse({
        op: "crop_image",
        target: "n1",
        x: 0,
        y: 0,
        w: 0,
        h: 80,
      }).success,
    ).toBe(false);
    expect(
      canvasOpSchema.safeParse({
        op: "crop_image",
        target: "n1",
        x: 0,
        y: 0,
        w: 100,
        h: 20001,
      }).success,
    ).toBe(false);
  });

  it("rejects split_image rows/cols outside [1, 12]", () => {
    expect(
      canvasOpSchema.safeParse({
        op: "split_image",
        target: "n1",
        rows: 0,
        cols: 3,
      }).success,
    ).toBe(false);
    expect(
      canvasOpSchema.safeParse({
        op: "split_image",
        target: "n1",
        rows: 2,
        cols: 13,
      }).success,
    ).toBe(false);
    expect(
      canvasOpSchema.safeParse({
        op: "split_image",
        target: "n1",
        rows: 2.5,
        cols: 3,
      }).success,
    ).toBe(false);
  });

  it("rejects upscale_image with a bad targetLongEdge or algorithm", () => {
    expect(
      canvasOpSchema.safeParse({
        op: "upscale_image",
        target: "n1",
        targetLongEdge: 3000,
        algorithm: "high",
      }).success,
    ).toBe(false);
    expect(
      canvasOpSchema.safeParse({
        op: "upscale_image",
        target: "n1",
        targetLongEdge: 1024,
        algorithm: "smooth",
      }).success,
    ).toBe(false);
  });

  it("rejects enhance_image with an unknown operation or out-of-range angle", () => {
    expect(
      canvasOpSchema.safeParse({
        op: "enhance_image",
        target: "n1",
        operation: "colorize",
      }).success,
    ).toBe(false);
    expect(
      canvasOpSchema.safeParse({
        op: "enhance_image",
        target: "n1",
        operation: "multi-angle",
        horizontalDeg: 61,
      }).success,
    ).toBe(false);
  });

  it("requires a non-empty target on describe_image", () => {
    expect(
      canvasOpSchema.safeParse({ op: "describe_image", target: "" }).success,
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

  it("bounds unbounded input on the (unauthenticated) mirror route", () => {
    const node = {
      id: "n1",
      type: "text" as const,
      title: "t",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      hasContent: false,
    };
    const base = {
      boardId: "sidebar",
      nodes: [] as unknown[],
      connections: [],
      viewport: { x: 0, y: 0, scale: 1 },
      selectedNodeIds: [] as string[],
    };
    // Over-cap node array is rejected (defense-in-depth vs runaway push).
    expect(
      canvasMirrorSchema.safeParse({
        ...base,
        nodes: Array.from({ length: 5001 }, () => node),
      }).success,
    ).toBe(false);
    // Over-long id/title are rejected.
    expect(
      canvasMirrorSchema.safeParse({
        ...base,
        nodes: [{ ...node, id: "x".repeat(201) }],
      }).success,
    ).toBe(false);
    expect(
      canvasMirrorSchema.safeParse({
        ...base,
        nodes: [{ ...node, title: "y".repeat(1001) }],
      }).success,
    ).toBe(false);
    // A realistic board still parses.
    expect(
      canvasMirrorSchema.safeParse({ ...base, nodes: [node] }).success,
    ).toBe(true);
  });
});
