/**
 * canvas-ops-executor.test.ts
 *
 * S8 frontend (W4.5b): the executor that applies a canvas-op batch to the
 * store. Ref resolution, per-op mapping, one-undo-step coalescing, and the
 * run_generation async seam. Plus parseCanvasOpBlock client-side re-validation.
 *
 * Plain Node env (no jsdom). Store actions are exercised directly; the
 * generation seams are mocked so run_generation dispatch can be asserted
 * without hitting the SDK.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal localStorage polyfill (same as other canvas tests) — must exist
// before canvas-store is imported (it reads localStorage at module load).
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

// Mock the generation seams — run_generation dispatch is a fire-and-forget seam.
vi.mock("../src/lib/canvas/canvas-generation", () => ({
  generateImageIntoNode: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("../src/lib/canvas/config-node-logic", () => ({
  runConfigGeneration: vi.fn(() => Promise.resolve(true)),
}));

import { generateImageIntoNode } from "../src/lib/canvas/canvas-generation";
import {
  applyCanvasOps,
  parseCanvasOpBlock,
} from "../src/lib/canvas/canvas-ops-executor";
import {
  __flushCanvasHistoryForTests,
  __resetCanvasForTests,
  addNode,
  connectNodes,
  getCanvasState,
  undo,
} from "../src/lib/canvas/canvas-store";
import { runConfigGeneration } from "../src/lib/canvas/config-node-logic";

const mockGenerateImage = vi.mocked(generateImageIntoNode);
const mockRunConfig = vi.mocked(runConfigGeneration);

beforeEach(() => {
  __resetCanvasForTests();
  vi.clearAllMocks();
});

describe("applyCanvasOps — ref resolution", () => {
  it("add_node then connect via ref:x wires the two new nodes", () => {
    const result = applyCanvasOps({
      ops: [
        { op: "add_node", ref: "a", nodeType: "text", title: "A" },
        { op: "add_node", ref: "b", nodeType: "text", title: "B" },
        { op: "connect", from: "ref:a", to: "ref:b" },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(3);

    const state = getCanvasState();
    expect(state.nodes).toHaveLength(2);
    const [a, b] = state.nodes;
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0]?.fromNodeId).toBe(a?.id);
    expect(state.connections[0]?.toNodeId).toBe(b?.id);
  });

  it("targets a real node id (not a ref) when it already exists", () => {
    const existing = addNode({ type: "text", title: "existing" });
    const result = applyCanvasOps({
      ops: [{ op: "update_node", target: existing.id, title: "renamed" }],
    });

    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(1);
    expect(getCanvasState().nodes[0]?.title).toBe("renamed");
  });

  it("unknown ref → error entry, other ops still apply", () => {
    const result = applyCanvasOps({
      ops: [
        { op: "add_node", ref: "a", nodeType: "text", title: "A" },
        { op: "connect", from: "ref:a", to: "ref:missing" },
      ],
    });

    expect(result.applied).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("ref:missing");
    // The add_node still applied.
    expect(getCanvasState().nodes).toHaveLength(1);
    expect(getCanvasState().connections).toHaveLength(0);
  });

  it("unknown real node id → error entry, skips the op", () => {
    const result = applyCanvasOps({
      ops: [{ op: "update_node", target: "does-not-exist", title: "x" }],
    });
    expect(result.applied).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("does-not-exist");
  });

  it("the live-id set tracks add and delete within one batch", () => {
    // A node deleted earlier in the batch is no longer a resolvable real id;
    // proves the incremental set is maintained (add adds, delete removes).
    const existing = addNode({ type: "text", title: "existing" });
    const result = applyCanvasOps({
      ops: [
        { op: "delete_node", target: existing.id },
        // Same real id, now gone → must error, not resurrect.
        { op: "update_node", target: existing.id, title: "zombie" },
      ],
    });
    expect(result.applied).toBe(1); // only the delete
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain(existing.id);
    expect(getCanvasState().nodes).toHaveLength(0);
  });
});

describe("applyCanvasOps — per-op mapping", () => {
  it("add_node uses default title per type when title omitted", () => {
    applyCanvasOps({
      ops: [{ op: "add_node", ref: "img", nodeType: "image" }],
    });
    const node = getCanvasState().nodes[0];
    expect(node?.type).toBe("image");
    expect((node?.title.length ?? 0) > 0).toBe(true);
  });

  it("add_node stores content into metadata", () => {
    applyCanvasOps({
      ops: [
        { op: "add_node", ref: "t", nodeType: "text", content: "hello world" },
      ],
    });
    expect(getCanvasState().nodes[0]?.metadata.content).toBe("hello world");
  });

  it("update_node moves the node when x/y present (partial keeps the other axis)", () => {
    const node = addNode({
      type: "text",
      title: "n",
      position: { x: 10, y: 20 },
    });
    applyCanvasOps({
      ops: [{ op: "update_node", target: node.id, x: 100 }],
    });
    const moved = getCanvasState().nodes[0];
    expect(moved?.position.x).toBe(100);
    expect(moved?.position.y).toBe(20); // untouched axis preserved
  });

  it("update_node writes title and content", () => {
    const node = addNode({ type: "text", title: "n" });
    applyCanvasOps({
      ops: [
        {
          op: "update_node",
          target: node.id,
          title: "new title",
          content: "new content",
        },
      ],
    });
    const updated = getCanvasState().nodes[0];
    expect(updated?.title).toBe("new title");
    expect(updated?.metadata.content).toBe("new content");
  });

  it("delete_node removes the node", () => {
    const node = addNode({ type: "text", title: "n" });
    const result = applyCanvasOps({
      ops: [{ op: "delete_node", target: node.id }],
    });
    expect(result.applied).toBe(1);
    expect(getCanvasState().nodes).toHaveLength(0);
  });

  it("connect on a duplicate edge records a non-fatal error", () => {
    const a = addNode({ type: "text", title: "A" });
    const b = addNode({ type: "text", title: "B" });
    connectNodes(a.id, b.id);
    const result = applyCanvasOps({
      ops: [{ op: "connect", from: a.id, to: b.id }],
    });
    expect(result.applied).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(getCanvasState().connections).toHaveLength(1);
  });

  it("delete_connection removes an existing connection", () => {
    const a = addNode({ type: "text", title: "A" });
    const b = addNode({ type: "text", title: "B" });
    const conn = connectNodes(a.id, b.id);
    const result = applyCanvasOps({
      ops: [{ op: "delete_connection", connectionId: conn?.id ?? "" }],
    });
    expect(result.applied).toBe(1);
    expect(getCanvasState().connections).toHaveLength(0);
  });

  it("delete_connection on unknown id records an error", () => {
    const result = applyCanvasOps({
      ops: [{ op: "delete_connection", connectionId: "conn-nope" }],
    });
    expect(result.applied).toBe(0);
    expect(result.errors.length).toBe(1);
  });

  it("set_viewport updates the viewport", () => {
    applyCanvasOps({
      ops: [{ op: "set_viewport", x: 5, y: 6, scale: 1.5 }],
    });
    expect(getCanvasState().viewport).toEqual({ x: 5, y: 6, scale: 1.5 });
  });

  it("select resolves targets and selects the resolved ids", () => {
    const node = addNode({ type: "text", title: "n" });
    applyCanvasOps({
      ops: [
        { op: "add_node", ref: "x", nodeType: "text", title: "X" },
        { op: "select", targets: [node.id, "ref:x"] },
      ],
    });
    const state = getCanvasState();
    const created = state.nodes.find((n) => n.title === "X");
    expect(new Set(state.selectedNodeIds)).toEqual(
      new Set([node.id, created?.id]),
    );
  });

  it("select skips an unresolved target with an error but selects the rest", () => {
    const node = addNode({ type: "text", title: "n" });
    const result = applyCanvasOps({
      ops: [{ op: "select", targets: [node.id, "ref:missing"] }],
    });
    expect(result.errors.length).toBe(1);
    expect(getCanvasState().selectedNodeIds).toEqual([node.id]);
  });
});

describe("applyCanvasOps — run_generation seam", () => {
  it("dispatches generateImageIntoNode for a non-config target", () => {
    const node = addNode({ type: "image", title: "img" });
    applyCanvasOps({
      ops: [{ op: "run_generation", target: node.id, prompt: "a cat" }],
    });
    expect(mockGenerateImage).toHaveBeenCalledTimes(1);
    expect(mockGenerateImage).toHaveBeenCalledWith(node.id, "a cat");
    expect(mockRunConfig).not.toHaveBeenCalled();
  });

  it("dispatches runConfigGeneration for a config-node target", () => {
    const node = addNode({
      type: "config",
      title: "cfg",
      metadata: { config: { mode: "image" } },
    });
    applyCanvasOps({
      ops: [{ op: "run_generation", target: node.id }],
    });
    expect(mockRunConfig).toHaveBeenCalledTimes(1);
    expect(mockRunConfig).toHaveBeenCalledWith(node.id);
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it("falls back to the node title as prompt when prompt omitted", () => {
    const node = addNode({ type: "image", title: "sunset over sea" });
    applyCanvasOps({ ops: [{ op: "run_generation", target: node.id }] });
    expect(mockGenerateImage).toHaveBeenCalledWith(node.id, "sunset over sea");
  });
});

describe("applyCanvasOps — one undo step", () => {
  it("a multi-op structural batch coalesces into a single undo entry", () => {
    // Pre-batch state: one lone node.
    const seed = addNode({ type: "text", title: "seed" });
    __flushCanvasHistoryForTests();
    const preNodeCount = getCanvasState().nodes.length;
    const preConnCount = getCanvasState().connections.length;

    applyCanvasOps({
      ops: [
        { op: "add_node", ref: "a", nodeType: "text", title: "A" },
        { op: "add_node", ref: "b", nodeType: "text", title: "B" },
        { op: "connect", from: "ref:a", to: "ref:b" },
        { op: "update_node", target: seed.id, title: "seed-renamed" },
      ],
    });

    // The batch grew the canvas.
    expect(getCanvasState().nodes.length).toBe(preNodeCount + 2);
    expect(getCanvasState().connections.length).toBe(preConnCount + 1);

    __flushCanvasHistoryForTests();
    undo();

    // ONE undo reverts the WHOLE batch back to the pre-batch snapshot.
    expect(getCanvasState().nodes.length).toBe(preNodeCount);
    expect(getCanvasState().connections.length).toBe(preConnCount);
    expect(getCanvasState().nodes[0]?.title).toBe("seed");
  });
});

describe("parseCanvasOpBlock", () => {
  it("extracts and validates a well-formed canvas-op block", () => {
    const text = [
      "Here you go:",
      "```canvas-op",
      JSON.stringify({
        ops: [{ op: "add_node", ref: "a", nodeType: "text", title: "A" }],
        summary: "one node",
      }),
      "```",
      "trailing prose",
    ].join("\n");

    const batch = parseCanvasOpBlock(text);
    expect(batch).not.toBeNull();
    expect(batch?.summary).toBe("one node");
    expect(batch?.ops).toHaveLength(1);
    expect(batch?.ops[0]?.op).toBe("add_node");
  });

  it("returns null for malformed JSON", () => {
    const text = "```canvas-op\n{ not json ]\n```";
    expect(parseCanvasOpBlock(text)).toBeNull();
  });

  it("returns null when the JSON fails the batch schema", () => {
    const text = `\`\`\`canvas-op\n${JSON.stringify({ ops: [] })}\n\`\`\``; // ops min(1) violated
    expect(parseCanvasOpBlock(text)).toBeNull();
  });

  it("returns null when no canvas-op block is present", () => {
    expect(parseCanvasOpBlock("just some prose, no fence")).toBeNull();
  });

  it("extracts only the FIRST canvas-op block", () => {
    const text = [
      "```canvas-op",
      JSON.stringify({ ops: [{ op: "set_viewport", x: 1, y: 2, scale: 1 }] }),
      "```",
      "```canvas-op",
      JSON.stringify({ ops: [{ op: "set_viewport", x: 9, y: 9, scale: 2 }] }),
      "```",
    ].join("\n");
    const batch = parseCanvasOpBlock(text);
    expect(batch?.ops).toHaveLength(1);
    const op = batch?.ops[0];
    expect(op?.op === "set_viewport" ? op.x : null).toBe(1);
  });
});
