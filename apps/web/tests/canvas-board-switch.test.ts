/**
 * canvas-board-switch.test.ts — TDD (W4.4): switchCanvasBoard store action.
 *
 * switchCanvasBoard flush-saves the CURRENT board, then REPLACE-loads the
 * target board (never merges two boards' content). The switch has its own
 * path that bypasses the once-ever hydratedOnce guard and records no undo
 * history.
 *
 * Test matrix:
 *  a. switch saves current board's content, then loads target's (round-trip)
 *  b. switch to the same id is a no-op
 *  c. switch does not record undo history (undo after switch is a no-op)
 *  d. switching to a board with no snapshot yields an empty canvas
 *  e. back-compat: the active board id defaults to "sidebar"
 */

import { beforeEach, describe, expect, it } from "vitest";
import { __resetCanvasBoardsForTests } from "../src/lib/canvas/canvas-boards";
import type {
  CanvasStorage,
  PersistedCanvas,
} from "../src/lib/canvas/canvas-persistence";
import { __setCanvasStorageForTests } from "../src/lib/canvas/canvas-persistence";
import {
  __getActiveBoardIdForTests,
  __resetCanvasForTests,
  addNode,
  getCanvasState,
  switchCanvasBoard,
  undo,
} from "../src/lib/canvas/canvas-store";

// Minimal localStorage polyfill (same pattern as canvas-persistence.test.ts)
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

function makeFakeStorage() {
  const db = new Map<string, PersistedCanvas>();
  const storage: CanvasStorage = {
    load: async (boardId: string) => db.get(boardId) ?? null,
    save: async (boardId: string, snapshot: PersistedCanvas) => {
      db.set(boardId, snapshot);
    },
  };
  return { storage, getDb: () => db };
}

beforeEach(() => {
  localStorage.clear();
  __resetCanvasForTests();
  __resetCanvasBoardsForTests();
  __setCanvasStorageForTests(null);
});

describe("switchCanvasBoard", () => {
  it("default active board id is sidebar (back-compat)", () => {
    expect(__getActiveBoardIdForTests()).toBe("sidebar");
  });

  it("a. saves current board, loads target, then restores on switch back", async () => {
    const fake = makeFakeStorage();

    // Seed board "b" with a single node in storage.
    const bSnapshot: PersistedCanvas = {
      version: 1,
      savedAt: new Date().toISOString(),
      nodes: [
        {
          id: "b-node",
          type: "text",
          title: "from-b",
          position: { x: 5, y: 5 },
          size: { width: 300, height: 180 },
          metadata: {},
        },
      ],
      connections: [],
    };
    await fake.storage.save("b", bSnapshot);
    __setCanvasStorageForTests(fake.storage);

    // Add a node to the current board (sidebar) — pending debounced save.
    addNode({ type: "text", title: "from-sidebar", id: "sidebar-node" });

    // Switch to "b": flush-saves sidebar first, then replaces with b's content.
    await switchCanvasBoard("b");
    expect(__getActiveBoardIdForTests()).toBe("b");

    const afterSwitch = getCanvasState();
    expect(afterSwitch.nodes).toHaveLength(1);
    expect(afterSwitch.nodes[0]?.id).toBe("b-node");
    // sidebar's content was flush-saved before the switch (no data loss).
    expect(
      fake
        .getDb()
        .get("sidebar")
        ?.nodes.map((n) => n.id),
    ).toContain("sidebar-node");

    // Switch back to sidebar: b's node is gone, sidebar's node restored.
    await switchCanvasBoard("sidebar");
    const backOnSidebar = getCanvasState();
    expect(backOnSidebar.nodes).toHaveLength(1);
    expect(backOnSidebar.nodes[0]?.id).toBe("sidebar-node");
  });

  it("b. switch to the same id is a no-op", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    addNode({ type: "text", title: "keep", id: "keep-node" });
    await switchCanvasBoard("sidebar");

    // Same-board switch must not wipe the current in-memory content.
    expect(getCanvasState().nodes).toHaveLength(1);
    expect(getCanvasState().nodes[0]?.id).toBe("keep-node");
  });

  it("c. switch does not record undo history (undo is a no-op)", async () => {
    const fake = makeFakeStorage();
    const bSnapshot: PersistedCanvas = {
      version: 1,
      savedAt: new Date().toISOString(),
      nodes: [
        {
          id: "b-node",
          type: "text",
          title: "from-b",
          position: { x: 0, y: 0 },
          size: { width: 300, height: 180 },
          metadata: {},
        },
      ],
      connections: [],
    };
    await fake.storage.save("b", bSnapshot);
    __setCanvasStorageForTests(fake.storage);

    addNode({ type: "text", title: "from-sidebar", id: "sidebar-node" });
    await switchCanvasBoard("b");

    // b is loaded; an undo must NOT resurrect the old sidebar board.
    undo();
    const state = getCanvasState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0]?.id).toBe("b-node");
  });

  it("d. switching to a board with no snapshot yields an empty canvas", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    addNode({ type: "text", title: "from-sidebar", id: "sidebar-node" });
    await switchCanvasBoard("fresh");

    expect(__getActiveBoardIdForTests()).toBe("fresh");
    expect(getCanvasState().nodes).toHaveLength(0);
    expect(getCanvasState().connections).toHaveLength(0);
  });

  it("e. switching updates the boards-index active pointer", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    await switchCanvasBoard("b");
    const { getCanvasBoards } = await import("../src/lib/canvas/canvas-boards");
    expect(getCanvasBoards().activeId).toBe("b");
  });
});
