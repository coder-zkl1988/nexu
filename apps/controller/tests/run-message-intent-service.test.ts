import { describe, expect, it, vi } from "vitest";
import {
  RunMessageIntentService,
  parseRunMessageIntentResult,
} from "../src/services/run-message-intent-service.js";

describe("parseRunMessageIntentResult", () => {
  it("parses a strict classifier result", () => {
    expect(
      parseRunMessageIntentResult(
        '```json\n{"intent":"steer","confidence":0.92}\n```',
      ),
    ).toEqual({ intent: "steer", confidence: 0.92 });
  });

  it("rejects prose and out-of-range confidence", () => {
    expect(parseRunMessageIntentResult("steer, probably")).toBeNull();
    expect(
      parseRunMessageIntentResult('{"intent":"steer","confidence":1.2}'),
    ).toBeNull();
  });
});

describe("RunMessageIntentService", () => {
  it("uses an isolated session and the configured utility model", async () => {
    const patchSession = vi.fn(async () => ({}));
    const abortSession = vi.fn(async () => ({}));
    const service = new RunMessageIntentService(
      {
        getUtilityModelId: vi.fn(async () => "provider/utility"),
        createSession: vi.fn(async () => ({})),
        patchSession,
        sendChat: vi.fn(async () => ({})),
        abortSession,
        readSessionEntry: vi.fn(async () => ({
          status: "done",
          sessionFile: "/tmp/run-intent.jsonl",
        })),
        readAssistantReply: vi.fn(async () =>
          Promise.resolve('{"intent":"side-question","confidence":0.96}'),
        ),
        genId: () => "test-id",
      },
      { pollIntervalMs: 1, timeoutMs: 100 },
    );

    await expect(
      service.classify({ botId: "bot-1", message: "¿Cómo va?" }),
    ).resolves.toEqual({ intent: "side-question", confidence: 0.96 });
    expect(patchSession).toHaveBeenNthCalledWith(1, {
      key: "agent:bot-1:subagent:run-intent-test-id",
      model: "provider/utility",
    });
    expect(patchSession).toHaveBeenLastCalledWith({
      key: "agent:bot-1:subagent:run-intent-test-id",
      archived: true,
    });
    expect(abortSession).not.toHaveBeenCalled();
  });

  it("aborts and archives the isolated session after invalid output", async () => {
    const abortSession = vi.fn(async () => ({}));
    const patchSession = vi.fn(async () => ({}));
    const service = new RunMessageIntentService(
      {
        getUtilityModelId: vi.fn(async () => null),
        createSession: vi.fn(async () => ({})),
        patchSession,
        sendChat: vi.fn(async () => ({})),
        abortSession,
        readSessionEntry: vi.fn(async () => ({
          status: "done",
          sessionFile: "/tmp/run-intent.jsonl",
        })),
        readAssistantReply: vi.fn(async () => "not json"),
        genId: () => "test-id",
      },
      { pollIntervalMs: 1, timeoutMs: 100 },
    );

    await expect(
      service.classify({ botId: "bot-1", message: "ambiguous" }),
    ).rejects.toThrow("invalid output");
    expect(abortSession).toHaveBeenCalledWith(
      "agent:bot-1:subagent:run-intent-test-id",
    );
    expect(patchSession).toHaveBeenLastCalledWith({
      key: "agent:bot-1:subagent:run-intent-test-id",
      archived: true,
    });
  });
});
