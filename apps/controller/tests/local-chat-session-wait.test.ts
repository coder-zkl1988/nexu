import { describe, expect, it } from "vitest";
import { waitForLocalChatSession } from "../src/routes/local-chat-session-wait.js";

describe("waitForLocalChatSession", () => {
  it("returns an already available session without waiting", async () => {
    const session = { id: "session-1" };
    const delays: number[] = [];

    const result = await waitForLocalChatSession({
      lookupSession: async () => session,
      wait: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toMatchObject({
      session,
      attempts: 1,
      timedOut: false,
    });
    expect(delays).toEqual([]);
  });

  it("retries until the session appears", async () => {
    const session = { id: "session-1" };
    const delays: number[] = [];
    let attempts = 0;

    const result = await waitForLocalChatSession({
      maxAttempts: 4,
      intervalMs: 200,
      lookupSession: async () => {
        attempts += 1;
        return attempts === 3 ? session : null;
      },
      wait: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toMatchObject({
      session,
      attempts: 3,
      timedOut: false,
    });
    expect(delays).toEqual([200, 200]);
  });

  it("reports timeout after the configured attempts", async () => {
    const delays: number[] = [];

    const result = await waitForLocalChatSession({
      maxAttempts: 3,
      intervalMs: 200,
      lookupSession: async () => null,
      wait: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toMatchObject({
      session: null,
      attempts: 3,
      timedOut: true,
    });
    expect(delays).toEqual([200, 200]);
  });
});
