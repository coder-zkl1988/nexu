/**
 * canvas-boards.ts — Module-level store for the named-canvas-board index (W4.4).
 *
 * Tracks the lightweight list of boards + the active id. The INDEX (ids, names,
 * activeId) persists to localStorage key `nexu:canvas:boards`; heavy per-board
 * content stays in IndexedDB via canvas-store's save/load, keyed by board id.
 *
 * Follows the useSyncExternalStore pattern used by canvas-ui-prefs.ts:
 * merge/seed-on-load, silent degradation on storage failure.
 *
 * BACK-COMPAT: the default board keeps id "sidebar" (displayed 画布 1) so
 * existing users' canvas content, persisted in IDB under "sidebar", becomes
 * the first board on upgrade. Do not re-key or rename it.
 */

import { useSyncExternalStore } from "react";
import { genId } from "./canvas-store";

export type CanvasBoard = { id: string; name: string; createdAt: string };

export type CanvasBoardsState = {
  boards: CanvasBoard[];
  activeId: string;
};

const BOARDS_KEY = "nexu:canvas:boards";

/** The default single board — id MUST stay "sidebar" (see back-compat note). */
function defaultBoard(): CanvasBoard {
  return { id: "sidebar", name: "画布 1", createdAt: new Date().toISOString() };
}

function defaultState(): CanvasBoardsState {
  return { boards: [defaultBoard()], activeId: "sidebar" };
}

function isCanvasBoard(value: unknown): value is CanvasBoard {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CanvasBoard).id === "string" &&
    typeof (value as CanvasBoard).name === "string" &&
    typeof (value as CanvasBoard).createdAt === "string"
  );
}

function loadStoredState(): CanvasBoardsState {
  try {
    const raw = localStorage.getItem(BOARDS_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<CanvasBoardsState>;
    const boards = Array.isArray(parsed.boards)
      ? parsed.boards.filter(isCanvasBoard)
      : [];
    // A missing/empty board list is treated as corrupt → seed the default.
    if (boards.length === 0) return defaultState();
    const activeId =
      typeof parsed.activeId === "string" &&
      boards.some((b) => b.id === parsed.activeId)
        ? parsed.activeId
        : (boards[0]?.id ?? "sidebar");
    return { boards, activeId };
  } catch {
    return defaultState();
  }
}

function saveState(next: CanvasBoardsState): void {
  try {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(next));
  } catch {
    // Storage failures degrade silently (viewport-persistence precedent).
  }
}

let state: CanvasBoardsState = loadStoredState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Persist + notify. */
function commit(next: CanvasBoardsState): void {
  state = next;
  saveState(state);
  emit();
}

/** Read the current boards-index snapshot (non-reactive). */
export function getCanvasBoards(): CanvasBoardsState {
  return state;
}

/** React hook — subscribes to boards-index changes via useSyncExternalStore. */
export function useCanvasBoards(): CanvasBoardsState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    getCanvasBoards,
    getCanvasBoards,
  );
}

/**
 * Create a new board, appending it to the index. Does NOT switch the active
 * board — the caller drives switching (see switchCanvasBoard in canvas-store).
 */
export function createBoard(name: string): CanvasBoard {
  const board: CanvasBoard = {
    id: genId("board"),
    name: name.trim() || "未命名画布",
    createdAt: new Date().toISOString(),
  };
  commit({ ...state, boards: [...state.boards, board] });
  return board;
}

/** Rename a board. Trims; an empty (whitespace-only) name is ignored. */
export function renameBoard(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (!state.boards.some((b) => b.id === id)) return;
  commit({
    ...state,
    boards: state.boards.map((b) =>
      b.id === id ? { ...b, name: trimmed } : b,
    ),
  });
}

/**
 * Delete a board from the index. Refuses if it is the last remaining board
 * (a no-op). Leaves the active pointer untouched — the caller is responsible
 * for switching away first when deleting the active board.
 *
 * NOTE (non-goal): the board's per-board content in IDB is left orphaned; a
 * future GC handles reclamation. We only remove the lightweight index entry.
 */
export function deleteBoard(id: string): void {
  if (state.boards.length <= 1) return;
  if (!state.boards.some((b) => b.id === id)) return;
  commit({ ...state, boards: state.boards.filter((b) => b.id !== id) });
}

/** Set the active board id + persist the index pointer. */
export function setActiveBoardId(id: string): void {
  if (state.activeId === id) return;
  commit({ ...state, activeId: id });
}

/** Test-only: re-run the load-from-localStorage path (seed/merge/corrupt). */
export function __resetCanvasBoardsForTests(): void {
  state = loadStoredState();
  emit();
}
