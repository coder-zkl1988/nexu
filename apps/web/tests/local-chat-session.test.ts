import { describe, expect, it } from "vitest";
import { waitForLocalChatSession } from "../src/lib/local-chat-session";

describe("waitForLocalChatSession", () => {
  it("keeps polling after an initial null session until the session appears", async () => {
    let attempts = 0;

    const session = await waitForLocalChatSession({
      botId: "bot-1",
      sessionKey: "agent:bot-1:main",
      initialSession: null,
      maxAttempts: 5,
      intervalMs: 1,
      delay: async () => {},
      lookupSession: async ({ query }) => {
        expect(query).toEqual({
          botId: "bot-1",
          sessionKey: "agent:bot-1:main",
        });
        attempts += 1;
        return {
          data: {
            session:
              attempts < 3
                ? null
                : {
                    id: "session-1",
                  },
          },
        };
      },
    });

    expect(session?.id).toBe("session-1");
    expect(attempts).toBe(3);
  });
});
