import { describe, expect, it } from "vitest";
import type { AttachmentStore } from "../src/services/attachment-store.js";
import { ChatService } from "../src/services/chat-service.js";
import type { OpenClawGatewayService } from "../src/services/openclaw-gateway-service.js";
import {
  SessionBusyError,
  SessionRunRegistry,
} from "../src/services/session-run-registry.js";

function makeService(
  sendToMainSession: OpenClawGatewayService["sendToMainSession"],
): { service: ChatService; registry: SessionRunRegistry } {
  const registry = new SessionRunRegistry();
  const gatewayService = { sendToMainSession } satisfies Pick<
    OpenClawGatewayService,
    "sendToMainSession"
  >;
  const service = new ChatService(
    gatewayService as unknown as OpenClawGatewayService,
    {} as unknown as AttachmentStore,
    registry,
  );
  return { service, registry };
}

describe("ChatService", () => {
  it("preserves the OpenClaw runId from chat.send", async () => {
    const { service } = makeService(async () => ({
      runId: "run-1",
      messageId: "message-1",
      content: null,
    }));

    const result = await service.sendLocalMessage("bot-1", {
      type: "text",
      content: "hello",
    });

    expect(result).toMatchObject({
      id: "message-1",
      runId: "run-1",
    });
  });

  it("rejects a second local message while a run is active, without re-calling the gateway", async () => {
    let sends = 0;
    const { service, registry } = makeService(async () => {
      sends += 1;
      return { runId: "run-1", messageId: "m1", content: null };
    });

    await service.sendLocalMessage("bot-1", { type: "text", content: "hi" });
    expect(sends).toBe(1);
    expect(registry.isBusy("agent:bot-1:main")).toBe(true);

    await expect(
      service.sendLocalMessage("bot-1", { type: "text", content: "again" }),
    ).rejects.toBeInstanceOf(SessionBusyError);
    expect(sends).toBe(1);
  });

  it("maps a raw 'session file locked' gateway error to SessionBusyError and releases the mark", async () => {
    const { service, registry } = makeService(async () => {
      throw new Error(
        "Agent failed before reply: session file locked (timeout 60000ms): pid=1 alive=true ageMs=1 /x.jsonl.lock",
      );
    });

    await expect(
      service.sendLocalMessage("bot-2", { type: "text", content: "hi" }),
    ).rejects.toBeInstanceOf(SessionBusyError);
    // The failed turn never got going, so its optimistic mark is released.
    expect(registry.isBusy("agent:bot-2:main")).toBe(false);
  });

  it("allows the next message once the run completes (terminal chat event)", async () => {
    let sends = 0;
    const { service, registry } = makeService(async () => {
      sends += 1;
      return { runId: `run-${sends}`, messageId: `m${sends}`, content: null };
    });

    await service.sendLocalMessage("bot-3", { type: "text", content: "one" });
    registry.handleChatEvent({
      sessionKey: "agent:bot-3:main",
      state: "final",
    });

    await service.sendLocalMessage("bot-3", { type: "text", content: "two" });
    expect(sends).toBe(2);
  });
});
