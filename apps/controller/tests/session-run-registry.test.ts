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

  it("ignores malformed chat events", () => {
    const registry = new SessionRunRegistry();
    registry.markStarted("s1");
    registry.handleChatEvent(null);
    registry.handleChatEvent({});
    registry.handleChatEvent({ sessionKey: 123, state: "final" });
    registry.handleChatEvent({ sessionKey: "s1", state: 5 });
    expect(registry.isBusy("s1")).toBe(true);
  });

  it("uncorks a wedged session after the stale window (crash safety valve)", () => {
    vi.useFakeTimers();
    const registry = new SessionRunRegistry();
    registry.markStarted("s1");
    expect(registry.isBusy("s1")).toBe(true);
    vi.advanceTimersByTime(10 * 60_000 + 1);
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
