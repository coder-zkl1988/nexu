import { describe, expect, it, vi } from "vitest";
import { isLocalDesktopSessionKey } from "../src/routes/agent-browser-routes.js";
import {
  AgentBrowserBridge,
  AgentBrowserTimeoutError,
  AgentBrowserUnavailableError,
} from "../src/services/agent-browser-bridge.js";

// The bridge is the only thing standing between an agent and a browser holding
// the user's logins, so its failure modes matter as much as its happy path: a
// command must never hang forever, never run with nobody watching, and never
// resolve from a stale reply.

const OK = {
  ok: true as const,
  snapshot: {
    url: "https://example.com/",
    title: "Example",
    truncated: false,
    nodes: [],
  },
};

describe("AgentBrowserBridge", () => {
  it("delivers a command to the subscriber and resolves with its outcome", async () => {
    const bridge = new AgentBrowserBridge();
    let seen: { requestId: string; sessionKey: string } | null = null;
    bridge.subscribe((envelope) => {
      seen = envelope;
      bridge.settle(envelope.requestId, OK);
    });

    const outcome = await bridge.dispatch("agent:bot:main", {
      action: "snapshot",
    });

    expect(outcome).toEqual(OK);
    expect(seen).not.toBeNull();
    expect(seen?.sessionKey).toBe("agent:bot:main");
  });

  it("refuses to dispatch when no panel is listening", async () => {
    const bridge = new AgentBrowserBridge();

    await expect(
      bridge.dispatch("agent:bot:main", { action: "snapshot" }),
    ).rejects.toBeInstanceOf(AgentBrowserUnavailableError);
  });

  it("times out rather than leaving the agent waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const bridge = new AgentBrowserBridge(1_000);
      bridge.subscribe(() => {
        // A panel that receives the command and never answers — a page stuck
        // loading, or a renderer that froze.
      });

      const pending = bridge.dispatch("agent:bot:main", { action: "snapshot" });
      const assertion = expect(pending).rejects.toBeInstanceOf(
        AgentBrowserTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a waiting command as soon as the panel disconnects", async () => {
    const bridge = new AgentBrowserBridge(60_000);
    let unsubscribe = (): void => undefined;
    unsubscribe = bridge.subscribe(() => undefined);

    const pending = bridge.dispatch("agent:bot:main", { action: "snapshot" });
    const assertion = expect(pending).rejects.toBeInstanceOf(
      AgentBrowserUnavailableError,
    );
    // Closing the window should not make the agent sit through the full
    // timeout for an answer that can no longer arrive.
    unsubscribe();
    await assertion;
  });

  it("ignores a result for a request nobody is waiting on", async () => {
    const bridge = new AgentBrowserBridge();
    bridge.subscribe(() => undefined);

    expect(bridge.settle("never-dispatched", OK)).toBe(false);
  });

  it("does not settle the same request twice", async () => {
    const bridge = new AgentBrowserBridge();
    let requestId = "";
    bridge.subscribe((envelope) => {
      requestId = envelope.requestId;
    });

    const pending = bridge.dispatch("agent:bot:main", { action: "snapshot" });
    expect(bridge.settle(requestId, OK)).toBe(true);
    // A retrying renderer must not resolve a later command with an old answer.
    expect(bridge.settle(requestId, OK)).toBe(false);
    await expect(pending).resolves.toEqual(OK);
  });

  it("hands commands to the newest panel only", async () => {
    const bridge = new AgentBrowserBridge();
    const first = vi.fn();
    bridge.subscribe(first);
    bridge.subscribe((envelope) => bridge.settle(envelope.requestId, OK));

    await bridge.dispatch("agent:bot:main", { action: "snapshot" });

    // Broadcasting to both would perform the click twice.
    expect(first).not.toHaveBeenCalled();
  });
});

describe("isLocalDesktopSessionKey", () => {
  it("accepts the desktop main session and its sub-sessions", () => {
    expect(isLocalDesktopSessionKey("agent:bot-1:main")).toBe(true);
    expect(
      isLocalDesktopSessionKey(
        "agent:bot-1:0a1b2c3d-4e5f-6789-abcd-ef0123456789",
      ),
    ).toBe(true);
  });

  it("rejects keys that are not a desktop session", () => {
    // Anything shaped differently is an external channel or an unknown caller,
    // and must not reach a browser carrying the user's logins.
    expect(isLocalDesktopSessionKey("agent:bot-1:slack-C123")).toBe(false);
    expect(isLocalDesktopSessionKey("channel:slack:C123")).toBe(false);
    expect(isLocalDesktopSessionKey("agent:bot-1:main:extra")).toBe(false);
    expect(isLocalDesktopSessionKey("")).toBe(false);
  });
});
