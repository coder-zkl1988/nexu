import { describe, expect, it } from "vitest";
import type { AttachmentStore } from "../src/services/attachment-store.js";
import { ChatService } from "../src/services/chat-service.js";
import type { OpenClawGatewayService } from "../src/services/openclaw-gateway-service.js";

describe("ChatService", () => {
  it("preserves the OpenClaw runId from chat.send", async () => {
    const gatewayService = {
      sendToMainSession: async () => ({
        runId: "run-1",
        messageId: "message-1",
        content: null,
      }),
    } satisfies Pick<OpenClawGatewayService, "sendToMainSession">;

    const service = new ChatService(
      gatewayService as unknown as OpenClawGatewayService,
      {} as unknown as AttachmentStore,
    );

    const result = await service.sendLocalMessage("bot-1", {
      type: "text",
      content: "hello",
    });

    expect(result).toMatchObject({
      id: "message-1",
      runId: "run-1",
    });
  });
});
