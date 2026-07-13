/**
 * canvas-session-binding.ts — bind each chat session to its own canvas board (W5).
 *
 * The infinite canvas is app-global (one store + one mirror). This module maps a
 * stable per-session key → a board id so opening a session shows that session's
 * canvas, and switching sessions auto-switches the board. A brand-new session
 * lazily gets a fresh board on first bind.
 *
 * Persistence: a `Record<sessionKey, boardId>` in localStorage key
 * `nexu:canvas:session-boards` (merge-on-load, corrupt/absent → {}, storage
 * failures degrade silently — same precedent as canvas-boards.ts / canvas-ui-prefs.ts).
 *
 * DATA-SAFETY: the actual board switch always routes through the reviewed
 * switchCanvasBoard (flush-saves the current board first, then REPLACE-loads the
 * target). This module never touches flush/load itself, so it can neither lose
 * the current board's content nor mix two boards' content.
 *
 * BACK-COMPAT: the default "sidebar" board is left untouched — it is the
 * off-session / pre-existing canvas. Sessions get their OWN lazily-created
 * boards; the W4.4 manual board switcher keeps working as a board manager.
 */

import { createBoard, getCanvasBoards, renameBoard } from "./canvas-boards";
import { switchCanvasBoard } from "./canvas-store";

const SESSION_BOARDS_KEY = "nexu:canvas:session-boards";

/** Default name for a lazily-created session board (title used only at creation). */
const DEFAULT_SESSION_BOARD_NAME = "对话画布";

/**
 * True when a would-be board name is a raw session key (`agent:<uuid>:main`)
 * rather than a human title. Untitled sessions report the key AS their title,
 * and using it verbatim fills the board manager with meaningless entries.
 * Heuristic: colon-separated, no whitespace — human titles with a colon
 * virtually always contain spaces too.
 */
function isRawSessionKey(label: string): boolean {
  return /^\S+:\S+$/.test(label);
}

/** Board name for a session whose title is unusable: 对话画布 · MM-DD HH:mm. */
function fallbackBoardName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${DEFAULT_SESSION_BOARD_NAME} · ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Resolve the display name for a session board from its session title. */
function sessionBoardName(label?: string): string {
  const trimmed = label?.trim() ?? "";
  if (!trimmed || isRawSessionKey(trimmed)) return fallbackBoardName();
  return trimmed;
}

function loadStoredMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SESSION_BOARDS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    // Keep only string→string entries (drop anything malformed).
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") clean[key] = value;
    }
    return clean;
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(SESSION_BOARDS_KEY, JSON.stringify(map));
  } catch {
    // Storage failures degrade silently (viewport-persistence precedent).
  }
}

let sessionBoardMap: Record<string, string> = loadStoredMap();

/**
 * Latest-wins token. Every bindSessionToBoard call captures a fresh sequence
 * number; if a newer call starts while an earlier one is mid-await, the earlier
 * call sees the token has moved and bails before applying its switch. This stops
 * a stale board from clobbering the active one under rapid session switching.
 */
let requestSeq = 0;

/**
 * Serializes the actual board switches. switchCanvasBoard mutates shared module
 * state (activeBoardId, in-memory canvas) across awaits; running two of them
 * concurrently would let a stale one land last. Chaining each switch after the
 * previous one guarantees ordered, non-interleaved application — combined with
 * the requestSeq re-check, only the newest requested bind actually switches.
 */
let switchChain: Promise<void> = Promise.resolve();

/**
 * Bind a chat session to its canvas board and switch the global canvas to it.
 *
 * - Falsy/whitespace sessionKey → no-op (session-list route, pending chat).
 * - Mapped board that still exists → switch to it.
 * - Unmapped, or mapped board was deleted → create a fresh board, record the
 *   mapping, then switch to it.
 *
 * The `label` (session title) is used only as the created board's name; it does
 * NOT rename an existing board on later binds.
 */
export async function bindSessionToBoard(
  sessionKey: string,
  label?: string,
): Promise<void> {
  if (!sessionKey || sessionKey.trim().length === 0) return;

  const myReq = ++requestSeq;

  const mappedId = sessionBoardMap[sessionKey];
  const mappedBoardExists =
    mappedId !== undefined &&
    getCanvasBoards().boards.some((b) => b.id === mappedId);

  let targetBoardId: string;
  if (mappedId !== undefined && mappedBoardExists) {
    targetBoardId = mappedId;
    // Retro-fix boards created before raw-key names were sanitized: a board
    // still named after the bare session key gets the friendly name once.
    const mapped = getCanvasBoards().boards.find((b) => b.id === mappedId);
    if (mapped && isRawSessionKey(mapped.name)) {
      renameBoard(mappedId, sessionBoardName(label));
    }
  } else {
    // Unmapped, or the mapped board was deleted: create + remap.
    const board = createBoard(sessionBoardName(label));
    targetBoardId = board.id;
    sessionBoardMap = { ...sessionBoardMap, [sessionKey]: board.id };
    saveMap(sessionBoardMap);
  }

  // A newer bind won the race while we prepared this one — do NOT apply the
  // switch (the newer target owns the active board now).
  if (myReq !== requestSeq) return;

  // Serialize the switch behind any in-flight one, then re-check the token so a
  // stale bind that queued earlier bails once a newer target has won. The chain
  // is advanced synchronously here so a later bind awaits this switch, not an
  // interleaved one.
  const run = switchChain.then(async () => {
    if (myReq !== requestSeq) return;
    await switchCanvasBoard(targetBoardId);
  });
  // Swallow rejection on the chain link so one failed switch can't reject every
  // subsequent bind; the awaited `run` below still surfaces this call's error.
  switchChain = run.catch(() => {});
  await run;
}

/** Read the board id currently mapped to a session (test/debug). */
export function getSessionBoardId(sessionKey: string): string | undefined {
  return sessionBoardMap[sessionKey];
}

/** Test-only: re-run the load-from-localStorage path and reset the race state. */
export function __resetSessionBindingForTests(): void {
  sessionBoardMap = loadStoredMap();
  requestSeq = 0;
  switchChain = Promise.resolve();
}
