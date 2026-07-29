import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SessionRunRegistry,
  isSessionLockedError,
} from "../src/services/session-run-registry.js";

describe("SessionRunRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not busy for an unknown session", () => {
    const registry = new SessionRunRegistry();
    expect(registry.isBusy("agent:a:main")).toBe(false);
  });

  it("reports busy after a turn starts and idle after it finishes", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1");
    expect(registry.isBusy("s1")).toBe(true);
    registry.markFinished("s1");
    expect(registry.isBusy("s1")).toBe(false);
  });

  it("clears all active turns when the gateway disconnects", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1");
    registry.markStarted("s2");

    registry.handleGatewayDisconnect();

    expect(registry.isBusy("s1")).toBe(false);
    expect(registry.isBusy("s2")).toBe(false);
  });

  it("clears the active turn on terminal chat events", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1");
    registry.handleChatEvent({ sessionKey: "s1", state: "delta" });
    expect(registry.isBusy("s1")).toBe(true);
    registry.handleChatEvent({ sessionKey: "s1", state: "final" });
    expect(registry.isBusy("s1")).toBe(false);
  });

  it("tracks a run that only surfaces via chat events (background/automation turn)", () => {
    const registry = new SessionRunRegistry();
    registry.handleChatEvent({ sessionKey: "s1", state: "delta" });
    expect(registry.isBusy("s1")).toBe(true);
    registry.handleChatEvent({ sessionKey: "s1", state: "aborted" });
    expect(registry.isBusy("s1")).toBe(false);
  });

  it("does not let a BTW side-run terminal event clear the main run", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1");
    registry.handleChatSideResult({
      kind: "btw",
      runId: "side-1",
      sessionKey: "s1",
    });

    registry.handleChatEvent({
      runId: "side-1",
      sessionKey: "s1",
      state: "final",
    });

    expect(registry.isBusy("s1")).toBe(true);
  });

  it("does not let an interrupted run clear its replacement", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1", "original-run-1");
    registry.markStarted("s1", "replacement-run-1");

    registry.handleChatEvent({
      runId: "original-run-1",
      sessionKey: "s1",
      state: "aborted",
    });

    expect(registry.isBusy("s1")).toBe(true);

    registry.handleChatEvent({
      runId: "replacement-run-1",
      sessionKey: "s1",
      state: "final",
    });
    expect(registry.isBusy("s1")).toBe(false);
  });

  it("keeps queued guidance busy across the primary-run handoff", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1", "primary-1");
    registry.markStarted("s1", "guidance-1");

    registry.handleChatEvent({
      runId: "primary-1",
      sessionKey: "s1",
      state: "final",
    });
    expect(registry.isBusy("s1")).toBe(true);

    registry.handleChatEvent({
      runId: "guidance-1",
      sessionKey: "s1",
      state: "delta",
    });
    registry.handleChatEvent({
      runId: "guidance-1",
      sessionKey: "s1",
      state: "final",
    });
    expect(registry.isBusy("s1")).toBe(false);
  });

  it("releases only the failed optimistic send reservation", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1", "primary-1");
    registry.markStarted("s1");

    registry.releasePendingStart("s1");

    expect(registry.isBusy("s1")).toBe(true);
    registry.handleChatEvent({
      runId: "primary-1",
      sessionKey: "s1",
      state: "final",
    });
    expect(registry.isBusy("s1")).toBe(false);
  });

  it("attaches a gateway run id without reviving a finished optimistic run", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1");
    registry.attachRunId("s1", "run-1");

    registry.handleChatEvent({
      runId: "other-run",
      sessionKey: "s1",
      state: "final",
    });
    expect(registry.isBusy("s1")).toBe(true);

    registry.handleChatEvent({
      runId: "run-1",
      sessionKey: "s1",
      state: "final",
    });
    registry.attachRunId("s1", "run-1");
    expect(registry.isBusy("s1")).toBe(false);
  });

  it("does not revive a run that finishes before its gateway id is attached", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1");

    registry.handleChatEvent({
      runId: "fast-run",
      sessionKey: "s1",
      state: "final",
    });
    expect(registry.isBusy("s1")).toBe(true);

    registry.attachRunId("s1", "fast-run");
    expect(registry.isBusy("s1")).toBe(false);
  });

  it("ignores malformed chat events", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1");
    registry.handleChatEvent(null);
    registry.handleChatEvent({});
    registry.handleChatEvent({ sessionKey: 123, state: "final" });
    registry.handleChatEvent({ sessionKey: "s1", state: 5 });
    expect(registry.isBusy("s1")).toBe(true);
  });

  it("keeps active runs gated while events arrive and uncorks a silent wedged run", () => {
    vi.useFakeTimers();
    const registry = new SessionRunRegistry();
    registry.markStarted("s1", "run-1");

    vi.advanceTimersByTime(45 * 60_000);
    registry.handleChatEvent({
      runId: "run-1",
      sessionKey: "s1",
      state: "delta",
    });
    vi.advanceTimersByTime(45 * 60_000);
    expect(registry.isBusy("s1")).toBe(true);

    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(registry.isBusy("s1")).toBe(false);
  });

  it("recognises OpenClaw's session-file-locked error", () => {
    expect(
      isSessionLockedError(
        new Error(
          "Agent failed before reply: session file locked (timeout 60000ms): pid=1 alive=true ageMs=1 /x.jsonl.lock",
        ),
      ),
    ).toBe(true);
    expect(isSessionLockedError(new Error("something else"))).toBe(false);
  });
});
