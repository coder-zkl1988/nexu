/**
 * canvas-boards.test.ts — TDD (W4.4): named canvas boards index store.
 *
 * The board-index store tracks the lightweight list of boards + the active id
 * in localStorage (key `nexu:canvas:boards`). Heavy per-board content lives in
 * IDB via canvas-store's existing save/load (not tested here).
 *
 * Test matrix:
 *  a. Default seed: single "sidebar" board named 画布 1, active "sidebar"
 *  b. createBoard appends + persists (localStorage round-trip); does NOT switch active
 *  c. renameBoard trims; empty name ignored
 *  d. deleteBoard refuses last board (no-op); removes a non-last board + persists
 *  e. corrupt-index → default
 *  f. setActiveBoardId persists the active pointer
 *  g. reset helper restores default seed
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCanvasBoardsForTests,
  createBoard,
  deleteBoard,
  getCanvasBoards,
  renameBoard,
  setActiveBoardId,
} from "../src/lib/canvas/canvas-boards";

// Minimal localStorage polyfill (same pattern as canvas-ui-prefs.test.ts)
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

const BOARDS_KEY = "nexu:canvas:boards";

beforeEach(() => {
  localStorage.clear();
  __resetCanvasBoardsForTests();
});

describe("default seed", () => {
  it("seeds a single sidebar board named 画布 1, active sidebar", () => {
    const state = getCanvasBoards();
    expect(state.boards).toHaveLength(1);
    expect(state.boards[0]?.id).toBe("sidebar");
    expect(state.boards[0]?.name).toBe("画布 1");
    expect(state.activeId).toBe("sidebar");
  });

  it("default board carries a createdAt", () => {
    expect(getCanvasBoards().boards[0]?.createdAt).toBeDefined();
  });
});

describe("createBoard", () => {
  it("appends a new board and returns it", () => {
    const board = createBoard("画布 2");
    expect(board.name).toBe("画布 2");
    expect(board.id).not.toBe("sidebar");
    const state = getCanvasBoards();
    expect(state.boards).toHaveLength(2);
    expect(state.boards[1]?.id).toBe(board.id);
  });

  it("does NOT switch the active id", () => {
    createBoard("画布 2");
    expect(getCanvasBoards().activeId).toBe("sidebar");
  });

  it("persists the index to localStorage", () => {
    const board = createBoard("画布 2");
    const raw = localStorage.getItem(BOARDS_KEY);
    if (raw == null) throw new Error("expected localStorage entry");
    const parsed = JSON.parse(raw) as {
      boards: Array<{ id: string; name: string }>;
      activeId: string;
    };
    expect(parsed.boards).toHaveLength(2);
    expect(parsed.boards.map((b) => b.id)).toContain(board.id);
    expect(parsed.activeId).toBe("sidebar");
  });
});

describe("renameBoard", () => {
  it("renames a board and persists", () => {
    renameBoard("sidebar", "主画布");
    expect(getCanvasBoards().boards[0]?.name).toBe("主画布");
    const raw = localStorage.getItem(BOARDS_KEY);
    if (raw == null) throw new Error("expected localStorage entry");
    const parsed = JSON.parse(raw) as { boards: Array<{ name: string }> };
    expect(parsed.boards[0]?.name).toBe("主画布");
  });

  it("trims the new name", () => {
    renameBoard("sidebar", "  spaced  ");
    expect(getCanvasBoards().boards[0]?.name).toBe("spaced");
  });

  it("ignores an empty (whitespace-only) name", () => {
    renameBoard("sidebar", "   ");
    expect(getCanvasBoards().boards[0]?.name).toBe("画布 1");
  });

  it("is a no-op for an unknown id", () => {
    renameBoard("does-not-exist", "x");
    expect(getCanvasBoards().boards).toHaveLength(1);
    expect(getCanvasBoards().boards[0]?.name).toBe("画布 1");
  });
});

describe("deleteBoard", () => {
  it("refuses to delete the last remaining board (no-op)", () => {
    deleteBoard("sidebar");
    const state = getCanvasBoards();
    expect(state.boards).toHaveLength(1);
    expect(state.boards[0]?.id).toBe("sidebar");
  });

  it("removes a non-last board and persists", () => {
    const board = createBoard("画布 2");
    deleteBoard(board.id);
    const state = getCanvasBoards();
    expect(state.boards).toHaveLength(1);
    expect(state.boards[0]?.id).toBe("sidebar");
    const raw = localStorage.getItem(BOARDS_KEY);
    if (raw == null) throw new Error("expected localStorage entry");
    const parsed = JSON.parse(raw) as { boards: Array<{ id: string }> };
    expect(parsed.boards).toHaveLength(1);
    expect(parsed.boards[0]?.id).toBe("sidebar");
  });

  it("leaves the active pointer untouched (caller handles switching)", () => {
    const board = createBoard("画布 2");
    setActiveBoardId(board.id);
    // Deleting a different (non-active) board does not move activeId.
    const board3 = createBoard("画布 3");
    deleteBoard(board3.id);
    expect(getCanvasBoards().activeId).toBe(board.id);
  });
});

describe("setActiveBoardId", () => {
  it("updates and persists the active pointer", () => {
    const board = createBoard("画布 2");
    setActiveBoardId(board.id);
    expect(getCanvasBoards().activeId).toBe(board.id);
    const raw = localStorage.getItem(BOARDS_KEY);
    if (raw == null) throw new Error("expected localStorage entry");
    const parsed = JSON.parse(raw) as { activeId: string };
    expect(parsed.activeId).toBe(board.id);
  });
});

describe("corrupt index → default", () => {
  it("falls back to the default seed when stored value is invalid JSON", () => {
    localStorage.setItem(BOARDS_KEY, "not-valid-json{{");
    __resetCanvasBoardsForTests(); // re-runs the real load path
    const state = getCanvasBoards();
    expect(state.boards).toHaveLength(1);
    expect(state.boards[0]?.id).toBe("sidebar");
    expect(state.activeId).toBe("sidebar");
  });

  it("uses a well-formed persisted index when present", () => {
    localStorage.setItem(
      BOARDS_KEY,
      JSON.stringify({
        boards: [
          { id: "sidebar", name: "画布 1", createdAt: "2026-01-01T00:00:00Z" },
          { id: "board-x", name: "画布 2", createdAt: "2026-01-02T00:00:00Z" },
        ],
        activeId: "board-x",
      }),
    );
    __resetCanvasBoardsForTests();
    const state = getCanvasBoards();
    expect(state.boards).toHaveLength(2);
    expect(state.activeId).toBe("board-x");
  });
});

describe("__resetCanvasBoardsForTests", () => {
  it("restores the default seed after mutations", () => {
    createBoard("画布 2");
    createBoard("画布 3");
    localStorage.clear();
    __resetCanvasBoardsForTests();
    const state = getCanvasBoards();
    expect(state.boards).toHaveLength(1);
    expect(state.boards[0]?.id).toBe("sidebar");
    expect(state.activeId).toBe("sidebar");
  });
});
