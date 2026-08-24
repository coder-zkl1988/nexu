import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAgentBrowserTabRequest,
  getAgentBrowserTabRequest,
  requestAgentBrowserTab,
  resetAgentBrowserRelayForTests,
} from "../src/lib/browser/agent-browser-relay";

// This module-level request is what the panel adopts on mount. It used to hold
// the last page the agent opened forever: every later panel mount, in every
// conversation, re-adopted it — which is why a page survived switching
// sessions and even deleting the session that opened it. Both the session tag
// and the clearing below exist to end that.

const SESSION_A = "agent:bot-1:11111111-1111-1111-1111-111111111111";
const SESSION_B = "agent:bot-1:22222222-2222-2222-2222-222222222222";

describe("agent browser tab request", () => {
  beforeEach(() => {
    resetAgentBrowserRelayForTests();
  });

  it("records which session opened the page", () => {
    requestAgentBrowserTab("agent-abc", "https://example.com", SESSION_A);

    // Without the session on the request the panel cannot tell its own
    // conversation's page from someone else's.
    expect(getAgentBrowserTabRequest()).toMatchObject({
      tabId: "agent-abc",
      url: "https://example.com",
      sessionKey: SESSION_A,
    });
  });

  it("clears the request when its own run ends", () => {
    requestAgentBrowserTab("agent-abc", "https://example.com", SESSION_A);

    clearAgentBrowserTabRequest(SESSION_A);

    // A standing request is re-adopted by the next panel mount; this is what
    // stops the page from following the user into another conversation.
    expect(getAgentBrowserTabRequest()).toBeNull();
  });

  it("ignores a clear from a different session", () => {
    requestAgentBrowserTab("agent-abc", "https://example.com", SESSION_A);

    clearAgentBrowserTabRequest(SESSION_B);

    // Session B ending its run must not cancel session A's live page — A may
    // still be mid-task with the panel showing its work.
    expect(getAgentBrowserTabRequest()?.sessionKey).toBe(SESSION_A);
  });

  it("gives consecutive opens of the same url distinct nonces", () => {
    requestAgentBrowserTab("agent-abc", "https://example.com", SESSION_A);
    const first = getAgentBrowserTabRequest()?.nonce;
    requestAgentBrowserTab("agent-abc", "https://example.com", SESSION_A);

    // The panel re-adopts on identity change; without a moving nonce a second
    // open of the same URL would look like no change at all.
    expect(getAgentBrowserTabRequest()?.nonce).not.toBe(first);
  });
});
