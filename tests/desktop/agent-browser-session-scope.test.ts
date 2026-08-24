import { describe, expect, it } from "vitest";
import {
  agentTabId,
  isAgentTabId,
} from "../../apps/desktop/main/services/embedded-browser-manager";

// The agent's browser view lives in the main process, keyed by tab id. That id
// was once the fixed string "agent", which made the view a process-wide
// singleton: every conversation that opened the panel adopted the same tab, so
// one session's page showed up in another and outlived even the deletion of
// the conversation that opened it. Deriving the id from the session key is
// what scopes the view to its conversation, so these properties are the fix.

describe("agentTabId", () => {
  it("gives two sessions different tabs", () => {
    const a = agentTabId("agent:bot-1:11111111-1111-1111-1111-111111111111");
    const b = agentTabId("agent:bot-1:22222222-2222-2222-2222-222222222222");

    // Equal ids here mean the two conversations share one WebContentsView —
    // exactly the bug this replaced.
    expect(a).not.toBe(b);
  });

  it("gives one session the same tab every time", () => {
    const key = "agent:bot-1:main";

    // Stability is what lets a collapsed panel re-adopt its page: the
    // renderer's tab ids die with its React state, the main process tab does
    // not, and this id is the only thing connecting them.
    expect(agentTabId(key)).toBe(agentTabId(key));
  });

  it("produces ids the tab-id validator accepts", () => {
    // The manager rejects anything outside /^[A-Za-z0-9_-]{1,128}$/, and a raw
    // session key ("agent:bot:uuid") contains colons. A derived id that failed
    // this would throw on every agent command.
    const pattern = /^[A-Za-z0-9_-]{1,128}$/;
    for (const key of [
      "agent:bot-1:main",
      "agent:bot-1:33333333-3333-3333-3333-333333333333",
      "agent:bot-with-a-very-long-identifier:main",
    ]) {
      expect(agentTabId(key)).toMatch(pattern);
    }
  });

  it("marks its own ids as agent tabs and leaves user tabs alone", () => {
    // The manager routes on this: agent tabs carry the sharing gate, the LRU
    // ceiling, and revoke-agent teardown. A user tab (a random uuid) must not
    // be caught by any of them.
    expect(isAgentTabId(agentTabId("agent:bot-1:main"))).toBe(true);
    expect(isAgentTabId(crypto.randomUUID())).toBe(false);
  });
});
