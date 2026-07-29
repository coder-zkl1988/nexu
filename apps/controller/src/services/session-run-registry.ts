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
 * turns, which clears the entry immediately. Non-terminal events refresh the
 * lease, so this only uncorks a session that stays completely silent for an
 * hour after its terminal event was lost.
 */
const RUN_STALE_MS = 60 * 60_000;

type ActiveSession = {
  startedAt: number;
  lastObservedAt: number;
  runIds: Set<string>;
  terminalRunIds: Set<string>;
  pendingStarts: number;
};

export class SessionRunRegistry {
  /** Session-scoped main request identities, including queued guidance. */
  private readonly active = new Map<string, ActiveSession>();
  /** BTW side-run ids whose events must not alter main-session busy state. */
  private readonly sideRunIds = new Set<string>();

  /** Mark a turn as started for `sessionKey` (called when `chat.send` is issued). */
  markStarted(sessionKey: string, runId: string | null = null): void {
    const now = Date.now();
    const activeSession = this.active.get(sessionKey) ?? {
      startedAt: now,
      lastObservedAt: now,
      runIds: new Set<string>(),
      terminalRunIds: new Set<string>(),
      pendingStarts: 0,
    };
    if (runId) activeSession.runIds.add(runId);
    else activeSession.pendingStarts += 1;
    activeSession.lastObservedAt = now;
    this.active.set(sessionKey, activeSession);
  }

  /** Attach the gateway-assigned id without reviving an already-finished run. */
  attachRunId(sessionKey: string, runId: string): void {
    const activeSession = this.active.get(sessionKey);
    if (!activeSession) return;
    activeSession.pendingStarts = Math.max(0, activeSession.pendingStarts - 1);
    if (!activeSession.terminalRunIds.delete(runId)) {
      activeSession.runIds.add(runId);
    }
    activeSession.lastObservedAt = Date.now();
    if (activeSession.pendingStarts === 0 && activeSession.runIds.size === 0) {
      this.active.delete(sessionKey);
    }
  }

  /** Release one optimistic send reservation after chat.send fails. */
  releasePendingStart(sessionKey: string): void {
    const activeSession = this.active.get(sessionKey);
    if (!activeSession) return;
    activeSession.pendingStarts = Math.max(0, activeSession.pendingStarts - 1);
    if (activeSession.pendingStarts === 0 && activeSession.runIds.size === 0) {
      this.active.delete(sessionKey);
    }
  }

  /** Clear the active turn for `sessionKey`. */
  markFinished(sessionKey: string): void {
    this.active.delete(sessionKey);
  }

  /** Clear runs whose terminal events were lost with the gateway connection. */
  handleGatewayDisconnect(): void {
    this.active.clear();
    this.sideRunIds.clear();
  }

  markSideRun(runId: string): void {
    this.sideRunIds.add(runId);
  }

  handleChatSideResult(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const { kind, runId } = payload as { kind?: unknown; runId?: unknown };
    if (kind === "btw" && typeof runId === "string") {
      this.markSideRun(runId);
    }
  }

  /** Whether a non-stale turn is currently active for `sessionKey`. */
  isBusy(sessionKey: string): boolean {
    const activeSession = this.active.get(sessionKey);
    if (!activeSession) return false;
    if (Date.now() - activeSession.lastObservedAt > RUN_STALE_MS) {
      this.active.delete(sessionKey);
      return false;
    }
    return true;
  }

  /**
   * Consume an OpenClaw `chat` lifecycle event. Terminal states
   * (`final`/`aborted`/`error`) remove only their own request id. Any other
   * state observes that request as active. Multiple client request ids may
   * overlap while OpenClaw steers or serializes queued guidance, even though
   * only one physical agent run writes the session at a time.
   *
   * Payload shape follows OpenClaw's ChatEventSchema:
   *   { runId, sessionKey, seq, state: "delta"|"final"|"aborted"|"error", ... }
   */
  handleChatEvent(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const { runId, sessionKey, state } = payload as {
      runId?: unknown;
      sessionKey?: unknown;
      state?: unknown;
    };
    if (typeof sessionKey !== "string" || typeof state !== "string") return;
    const eventRunId =
      typeof runId === "string" && runId.trim() ? runId.trim() : null;
    const isTerminal =
      state === "final" || state === "aborted" || state === "error";

    if (eventRunId && this.sideRunIds.has(eventRunId)) {
      if (isTerminal) this.sideRunIds.delete(eventRunId);
      return;
    }

    if (isTerminal) {
      if (!eventRunId) {
        this.markFinished(sessionKey);
        return;
      }
      const activeSession = this.active.get(sessionKey);
      if (!activeSession) return;
      if (
        !activeSession.runIds.delete(eventRunId) &&
        activeSession.pendingStarts > 0
      ) {
        activeSession.terminalRunIds.add(eventRunId);
      }
      activeSession.lastObservedAt = Date.now();
      if (
        activeSession.pendingStarts === 0 &&
        activeSession.runIds.size === 0
      ) {
        this.active.delete(sessionKey);
      }
      return;
    }

    if (eventRunId) {
      const activeSession = this.active.get(sessionKey);
      if (!activeSession) {
        this.markStarted(sessionKey, eventRunId);
        return;
      }
      activeSession.runIds.add(eventRunId);
      activeSession.lastObservedAt = Date.now();
      return;
    }

    const activeSession = this.active.get(sessionKey);
    if (activeSession) {
      activeSession.lastObservedAt = Date.now();
    } else {
      this.markStarted(sessionKey);
    }
  }
}
