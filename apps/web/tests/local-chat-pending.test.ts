import { describe, expect, it } from "vitest";
import {
  buildPendingSessionPath,
  getPendingSessionBotName,
  getPendingSessionText,
  parsePendingSessionParams,
} from "../src/lib/local-chat-pending";

describe("local chat pending session helpers", () => {
  it("builds a pending session route with encoded identifiers", () => {
    expect(
      buildPendingSessionPath({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        runId: "run-1",
      }),
    ).toBe(
      "/workspace/sessions/pending?botId=bot-1&sessionKey=agent%3Abot-1%3Amain&runId=run-1",
    );
  });

  it("parses required pending session params and optional runId", () => {
    const params = parsePendingSessionParams(
      new URLSearchParams(
        "botId=bot-1&sessionKey=agent%3Abot-1%3Amain&runId=run-1",
      ),
    );

    expect(params).toStrictEqual({
      botId: "bot-1",
      sessionKey: "agent:bot-1:main",
      runId: "run-1",
    });
  });

  it("returns null when required pending session params are missing", () => {
    expect(
      parsePendingSessionParams(new URLSearchParams("sessionKey=s1")),
    ).toBeNull();
    expect(
      parsePendingSessionParams(new URLSearchParams("botId=b1")),
    ).toBeNull();
  });

  it("extracts a non-empty pending message from navigation state only", () => {
    expect(getPendingSessionText({ pendingText: "hello" })).toBe("hello");
    expect(getPendingSessionText({ pendingText: "  " })).toBeNull();
    expect(getPendingSessionText({ pendingText: 123 })).toBeNull();
    expect(getPendingSessionText(null)).toBeNull();
  });

  it("extracts a non-empty pending bot name from navigation state only", () => {
    expect(getPendingSessionBotName({ pendingBotName: "Researcher" })).toBe(
      "Researcher",
    );
    expect(getPendingSessionBotName({ pendingBotName: "  " })).toBeNull();
    expect(getPendingSessionBotName({ pendingBotName: 123 })).toBeNull();
    expect(getPendingSessionBotName(null)).toBeNull();
  });
});
