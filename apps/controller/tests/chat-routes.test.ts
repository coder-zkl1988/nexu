import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { registerChatRoutes } from "../src/routes/chat-routes.js";
import type { ControllerBindings } from "../src/types.js";

function createChatRoutesApp({
  sendToMainSession,
  getSessionBySessionKey,
}: {
  sendToMainSession: ControllerContainer["gatewayService"]["sendToMainSession"];
  getSessionBySessionKey: ControllerContainer["sessionService"]["getSessionBySessionKey"];
}) {
  const app = new OpenAPIHono<ControllerBindings>();
  registerChatRoutes(app, {
    env: {
      openclawStateDir: "/tmp/nexu-test-openclaw-state",
    },
    gatewayService: {
      sendToMainSession,
    },
    attachmentStore: {},
    sessionService: {
      getSessionBySessionKey,
    },
    wsClient: {
      onChatEvent: () => () => {},
      onChatSideResult: () => () => {},
    },
  } as unknown as ControllerContainer);
  return app;
}

describe("chat routes", () => {
  it("starts a local chat run without waiting for session discovery", async () => {
    const sendToMainSession = vi.fn(async () => ({
      runId: "run-1",
      messageId: "message-1",
      content: null,
    }));
    const getSessionBySessionKey = vi.fn(async () => null);
    const app = createChatRoutesApp({
      sendToMainSession,
      getSessionBySessionKey,
    });

    const response = await app.request("/api/v1/chat/local/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        message: {
          type: "text",
          content: "hello",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessionKey: "agent:bot-1:main",
      session: null,
      message: {
        id: "message-1",
        runId: "run-1",
      },
    });
    expect(sendToMainSession).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        message: "hello",
      }),
    );
    expect(getSessionBySessionKey).toHaveBeenCalledTimes(1);
    expect(getSessionBySessionKey).toHaveBeenCalledWith(
      "bot-1",
      "agent:bot-1:main",
    );
  });
});
