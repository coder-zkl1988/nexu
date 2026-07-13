/**
 * canvas-session-binding.test.ts — TDD (W5): per-session canvas board binding.
 *
 * bindSessionToBoard maps a stable sessionKey → boardId (persisted in
 * localStorage) and drives the global canvas through the reviewed
 * switchCanvasBoard. First bind for a session lazily creates a fresh board;
 * re-binding the same session reuses it; a deleted mapped board is recreated.
 * DATA-SAFETY: the switch always routes through switchCanvasBoard's
 * flush-save-first path — no content loss, no cross-board mixing.
 *
 * Test matrix:
 *  a. first bind → creates a board, persists the mapping, that board is active
 *  b. re-bind same sessionKey → reuses the board (no duplicate), switches to it
 *  c. two sessions isolate content (A's node absent under B; back on A it returns)
 *  d. mapped board deleted → next bind recreates a fresh board and remaps
 *  e. empty sessionKey → no-op (active board unchanged, no board created)
 *  f. latest-wins: two calls in quick succession → the LAST session's board wins
 *  g. localStorage round-trip: mapping persists + reloads; corrupt blob → {}
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCanvasBoardsForTests,
  createBoard,
  deleteBoard,
  getCanvasBoards,
} from "../src/lib/canvas/canvas-boards";
import type {
  CanvasStorage,
  PersistedCanvas,
} from "../src/lib/canvas/canvas-persistence";
import { __setCanvasStorageForTests } from "../src/lib/canvas/canvas-persistence";
import {
  __resetSessionBindingForTests,
  bindSessionToBoard,
  getSessionBoardId,
} from "../src/lib/canvas/canvas-session-binding";
import {
  __flushCanvasPersistForTests,
  __getActiveBoardIdForTests,
  __resetCanvasForTests,
  addNode,
  getCanvasState,
} from "../src/lib/canvas/canvas-store";

// Minimal localStorage polyfill (same pattern as canvas-board-switch.test.ts).
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

const SESSION_BOARDS_KEY = "nexu:canvas:session-boards";

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
  __resetSessionBindingForTests();
  __setCanvasStorageForTests(null);
});

describe("bindSessionToBoard", () => {
  it("a. first bind creates a board, persists the mapping, activates it", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    const boardsBefore = getCanvasBoards().boards.length;
    await bindSessionToBoard("session-a", "Session A");

    const boardsAfter = getCanvasBoards().boards;
    expect(boardsAfter.length).toBe(boardsBefore + 1);

    const boardId = getSessionBoardId("session-a");
    expect(boardId).toBeDefined();
    if (!boardId) throw new Error("expected a mapped board id");
    // The newly created board is the active board.
    expect(__getActiveBoardIdForTests()).toBe(boardId);
    // The mapping is persisted to localStorage.
    const raw = localStorage.getItem(SESSION_BOARDS_KEY);
    if (raw == null) throw new Error("expected persisted session-board map");
    const parsed = JSON.parse(raw) as Record<string, string>;
    expect(parsed["session-a"]).toBe(boardId);
  });

  it("b. re-binding the same session reuses its board (no duplicate)", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    await bindSessionToBoard("session-a", "Session A");
    const firstBoardId = getSessionBoardId("session-a");
    const boardsAfterFirst = getCanvasBoards().boards.length;

    // Switch focus away, then back to the same session.
    await bindSessionToBoard("session-b", "Session B");
    await bindSessionToBoard("session-a", "Session A");

    // No new board created on re-bind; still mapped to the same id and active.
    expect(getCanvasBoards().boards.length).toBe(boardsAfterFirst + 1); // +1 for session-b only
    expect(getSessionBoardId("session-a")).toBe(firstBoardId);
    expect(__getActiveBoardIdForTests()).toBe(firstBoardId);
  });

  it("c. two sessions isolate content (no mixing, no loss)", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    // Bind A, add a node, flush it to storage.
    await bindSessionToBoard("session-a", "Session A");
    addNode({ type: "text", title: "A-note", id: "a-node" });
    await __flushCanvasPersistForTests();
    expect(getCanvasState().nodes.map((n) => n.id)).toContain("a-node");

    // Bind B: A's node must NOT appear on B's board.
    await bindSessionToBoard("session-b", "Session B");
    expect(getCanvasState().nodes.map((n) => n.id)).not.toContain("a-node");
    expect(getCanvasState().nodes).toHaveLength(0);

    // Re-bind A: A's node is restored (flush-saved before leaving).
    await bindSessionToBoard("session-a", "Session A");
    expect(getCanvasState().nodes.map((n) => n.id)).toContain("a-node");
  });

  it("d. a deleted mapped board is recreated on next bind and remapped", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    await bindSessionToBoard("session-a", "Session A");
    const firstBoardId = getSessionBoardId("session-a");
    if (!firstBoardId) throw new Error("expected a mapped board id");

    // Move off session-a first (deleteBoard refuses the active/last board),
    // then delete session-a's board out from under the mapping.
    await bindSessionToBoard("session-b", "Session B");
    deleteBoard(firstBoardId);
    expect(getCanvasBoards().boards.some((b) => b.id === firstBoardId)).toBe(
      false,
    );

    // Re-binding session-a must create a NEW board and remap to it.
    await bindSessionToBoard("session-a", "Session A");
    const remappedId = getSessionBoardId("session-a");
    expect(remappedId).toBeDefined();
    expect(remappedId).not.toBe(firstBoardId);
    expect(__getActiveBoardIdForTests()).toBe(remappedId);
    expect(getCanvasBoards().boards.some((b) => b.id === remappedId)).toBe(
      true,
    );
  });

  it("e. empty sessionKey is a no-op (no board created, active unchanged)", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    const activeBefore = __getActiveBoardIdForTests();
    const boardsBefore = getCanvasBoards().boards.length;

    await bindSessionToBoard("", "Nope");
    await bindSessionToBoard("   ", "Also nope"); // whitespace-only

    expect(__getActiveBoardIdForTests()).toBe(activeBefore);
    expect(getCanvasBoards().boards.length).toBe(boardsBefore);
    expect(getSessionBoardId("")).toBeUndefined();
  });

  it("f. latest-wins: rapid succession leaves the LAST session's board active", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    // Pre-map both sessions to real boards so bind takes the switch path.
    const boardA = createBoard("A");
    const boardB = createBoard("B");
    await bindSessionToBoard("session-a", "Session A"); // creates + maps a fresh board
    await bindSessionToBoard("session-b", "Session B"); // creates + maps a fresh board
    const mappedA = getSessionBoardId("session-a");
    const mappedB = getSessionBoardId("session-b");
    if (!mappedA || !mappedB) throw new Error("expected both sessions mapped");
    // boardA/boardB are unused pre-seeds to ensure createBoard ids differ.
    expect(boardA.id).not.toBe(boardB.id);

    // Fire A then B without awaiting A first; the LAST requested (B) must win
    // even though A's async work may resolve after B started.
    const pA = bindSessionToBoard("session-a", "Session A");
    const pB = bindSessionToBoard("session-b", "Session B");
    await Promise.all([pA, pB]);

    expect(__getActiveBoardIdForTests()).toBe(mappedB);
  });

  it("g. mapping round-trips through localStorage; corrupt blob → {}", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    await bindSessionToBoard("session-a", "Session A");
    const boardId = getSessionBoardId("session-a");
    if (!boardId) throw new Error("expected a mapped board id");

    // Reload the module state from localStorage — mapping survives.
    __resetSessionBindingForTests();
    expect(getSessionBoardId("session-a")).toBe(boardId);

    // Corrupt the persisted blob — reload degrades to an empty map (no throw).
    localStorage.setItem(SESSION_BOARDS_KEY, "not-json{{{");
    expect(() => __resetSessionBindingForTests()).not.toThrow();
    expect(getSessionBoardId("session-a")).toBeUndefined();
  });

  it("h. raw sessionKey-shaped label is NOT used as the board name", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    const rawKey = "agent:0fac7d8b-0440-4d4a-9291-0f994a8a3a6e:main";
    // Untitled sessions report their key AS the title — bind passes it through.
    await bindSessionToBoard(rawKey, rawKey);

    const boardId = getSessionBoardId(rawKey);
    const board = getCanvasBoards().boards.find((b) => b.id === boardId);
    if (!board) throw new Error("expected a created board");
    expect(board.name).not.toBe(rawKey);
    expect(board.name).toContain("对话画布");
  });

  it("h2. human session title IS used as the board name", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    await bindSessionToBoard("session-a", "小红书发布计划");

    const boardId = getSessionBoardId("session-a");
    const board = getCanvasBoards().boards.find((b) => b.id === boardId);
    expect(board?.name).toBe("小红书发布计划");
  });

  it("h3. re-bind retro-renames a board still named after the raw key", async () => {
    const fake = makeFakeStorage();
    __setCanvasStorageForTests(fake.storage);

    const rawKey = "agent:f50c0302-30ae-49a2-aa4a-69d4bae5067c:main";
    // Simulate a board created BEFORE sanitizing existed: raw-key name.
    const legacy = createBoard(rawKey);
    localStorage.setItem(
      SESSION_BOARDS_KEY,
      JSON.stringify({ [rawKey]: legacy.id }),
    );
    __resetSessionBindingForTests();

    await bindSessionToBoard(rawKey, rawKey);

    const board = getCanvasBoards().boards.find((b) => b.id === legacy.id);
    if (!board) throw new Error("expected the legacy board to survive");
    expect(board.name).not.toBe(rawKey);
    expect(board.name).toContain("对话画布");
  });
});
