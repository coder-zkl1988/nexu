/**
 * Per-session run tracking for local (webchat) turns.
 *
 * OpenClaw guards each session transcript (`<sessionId>.jsonl`) with a
 * cross-process file lock (`<sessionId>.jsonl.lock`). A turn holds that lock for
 * its entire duration, and a long-running tool (e.g. a multi-device automation
 * that blocks the agent for minutes) keeps it held the whole time. The
 * controller submits every webchat turn via `chat.send` with **no per-session
 * serialization**, so a message sent while a turn is still running becomes a
 * second turn that cannot acquire the lock within OpenClaw's 60s window and
 * hard-fails with `session file locked` → `Agent failed before reply`.
 *
 * This registry lets the send path detect an in-flight run and reject fast with
 * a friendly signal instead of hanging for 60s and surfacing the raw lock error.
 */

/**
 * Thrown by the send path when a run is already active for the target session.
 * Mapped to HTTP 409 with a friendly message by the chat routes.
 */
export class SessionBusyError extends Error {
  constructor(public readonly sessionKey: string) {
    super("a run is already active for this session");
    this.name = "SessionBusyError";
  }
}

/** Whether an error is OpenClaw's "session file locked" contention failure. */
export function isSessionLockedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("session file locked");
}

/**
 * How long a tracked run may stay "active" without a terminal chat event before
 * it is treated as stale and new sends are allowed again.
 *
 * Pure crash-safety valve: OpenClaw emits `final`/`aborted`/`error` for normal
 * turns, which clears the entry immediately; this only uncorks a session whose
 * terminal event never arrived (renderer/gateway crash). Deliberately generous
 * so it never falsely rejects a legitimately long turn (multi-device work can
 * run for several minutes).
 */
const RUN_STALE_MS = 10 * 60_000;

export class SessionRunRegistry {
  /** sessionKey → epoch ms when the active turn was first observed. */
  private readonly active = new Map<string, number>();

  /** Mark a turn as started for `sessionKey` (called when `chat.send` is issued). */
  markStarted(sessionKey: string): void {
    this.active.set(sessionKey, Date.now());
  }

  /** Clear the active turn for `sessionKey`. */
  markFinished(sessionKey: string): void {
    this.active.delete(sessionKey);
  }

  /** Whether a non-stale turn is currently active for `sessionKey`. */
  isBusy(sessionKey: string): boolean {
    const startedAt = this.active.get(sessionKey);
    if (startedAt === undefined) return false;
    if (Date.now() - startedAt > RUN_STALE_MS) {
      this.active.delete(sessionKey);
      return false;
    }
    return true;
  }

  /**
   * Consume an OpenClaw `chat` lifecycle event. Terminal states
   * (`final`/`aborted`/`error`) clear the session's active turn; any other state
   * (e.g. `delta`) marks the session active if it is not already tracked, so a
   * run that only surfaces via events — a background or automation turn we did
   * not initiate — still gates concurrent webchat sends.
   *
   * Payload shape follows OpenClaw's ChatEventSchema:
   *   { runId, sessionKey, seq, state: "delta"|"final"|"aborted"|"error", ... }
   */
  handleChatEvent(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const { sessionKey, state } = payload as {
      sessionKey?: unknown;
      state?: unknown;
    };
    if (typeof sessionKey !== "string" || typeof state !== "string") return;
    if (state === "final" || state === "aborted" || state === "error") {
      this.markFinished(sessionKey);
    } else if (!this.active.has(sessionKey)) {
      this.markStarted(sessionKey);
    }
  }
}
