import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { registerChatRoutes } from "../src/routes/chat-routes.js";
import { SessionRunRegistry } from "../src/services/session-run-registry.js";
import type { ControllerBindings } from "../src/types.js";

function createChatRoutesApp({
  sendToMainSession,
  getSessionBySessionKey,
  sessionRunRegistry = new SessionRunRegistry(),
  sendSideQuestion = vi.fn(async () => ({ runId: "side-run-1" })),
  steerChatSession = vi.fn(async () => ({ runId: "steer-command-1" })),
}: {
  sendToMainSession: ControllerContainer["gatewayService"]["sendToMainSession"];
  getSessionBySessionKey: ControllerContainer["sessionService"]["getSessionBySessionKey"];
  sessionRunRegistry?: SessionRunRegistry;
  sendSideQuestion?: ControllerContainer["gatewayService"]["sendSideQuestion"];
  steerChatSession?: ControllerContainer["gatewayService"]["steerChatSession"];
}) {
  const app = new OpenAPIHono<ControllerBindings>();
  registerChatRoutes(app, {
    env: {
      openclawStateDir: "/tmp/nexu-test-openclaw-state",
    },
    gatewayService: {
      sendToMainSession,
      sendSideQuestion,
      steerChatSession,
    },
    attachmentStore: {},
    teamService: {
      listTeams: () => [],
    },
    sessionService: {
      getSessionBySessionKey,
    },
    sessionRunRegistry,
    wsClient: {
      onChatEvent: () => () => {},
      onChatSideResult: () => () => {},
    },
  } as unknown as ControllerContainer);
  return { app, sessionRunRegistry };
}

describe("chat routes", () => {
  it("starts a local chat run without waiting for session discovery", async () => {
    const sendToMainSession = vi.fn(async () => ({
      runId: "run-1",
      messageId: "message-1",
      content: null,
    }));
    const getSessionBySessionKey = vi.fn(async () => null);
    const { app } = createChatRoutesApp({
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
        // The expert-routing nudge is prepended to the user content.
        message: expect.stringContaining("hello"),
      }),
    );
    expect(getSessionBySessionKey).toHaveBeenCalledTimes(1);
    expect(getSessionBySessionKey).toHaveBeenCalledWith(
      "bot-1",
      "agent:bot-1:main",
    );
  });

  it("returns 409 without re-sending when a run is already active", async () => {
    const sendToMainSession = vi.fn(async () => ({
      runId: "run-1",
      messageId: "message-1",
      content: null,
    }));
    const getSessionBySessionKey = vi.fn(async () => null);
    const { app, sessionRunRegistry } = createChatRoutesApp({
      sendToMainSession,
      getSessionBySessionKey,
    });
    // A turn is already in flight for this session.
    sessionRunRegistry.markStarted("agent:bot-1:main");

    const response = await app.request("/api/v1/chat/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        message: { type: "text", content: "is it done yet?" },
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: expect.any(String),
    });
    // The busy session must not be hit with a second concurrent turn.
    expect(sendToMainSession).not.toHaveBeenCalled();
  });

  it("accepts a side question while the main session is busy", async () => {
    const sessionRunRegistry = new SessionRunRegistry();
    const sendSideQuestion = vi.fn(async () => ({ runId: "side-run-9" }));
    const { app } = createChatRoutesApp({
      sendToMainSession: vi.fn(async () => ({})),
      getSessionBySessionKey: vi.fn(async () => null),
      sessionRunRegistry,
      sendSideQuestion,
    });
    sessionRunRegistry.markStarted("agent:bot-1:main");

    const response = await app.request("/api/v1/chat/side-question", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        question: "当前已经完成了哪些步骤？",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: true,
      runId: "side-run-9",
    });
    expect(sendSideQuestion).toHaveBeenCalledWith(
      "agent:bot-1:main",
      "当前已经完成了哪些步骤？",
    );
    sessionRunRegistry.handleChatEvent({
      runId: "side-run-9",
      sessionKey: "agent:bot-1:main",
      state: "final",
    });
    expect(sessionRunRegistry.isBusy("agent:bot-1:main")).toBe(true);
  });

  it("tracks queued guidance separately from the active request", async () => {
    const sessionRunRegistry = new SessionRunRegistry();
    const steerChatSession = vi.fn(async () => ({ runId: "steer-command-9" }));
    const { app } = createChatRoutesApp({
      sendToMainSession: vi.fn(async () => ({})),
      getSessionBySessionKey: vi.fn(async () => null),
      sessionRunRegistry,
      steerChatSession,
    });
    sessionRunRegistry.markStarted("agent:bot-1:main", "original-run-9");

    const response = await app.request("/api/v1/chat/steer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        message: "停止扫描依赖，只总结已经发现的问题。",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: true,
      runId: "steer-command-9",
    });
    expect(steerChatSession).toHaveBeenCalledWith(
      "agent:bot-1:main",
      "停止扫描依赖，只总结已经发现的问题。",
    );
    sessionRunRegistry.handleChatEvent({
      runId: "original-run-9",
      sessionKey: "agent:bot-1:main",
      state: "final",
    });
    expect(sessionRunRegistry.isBusy("agent:bot-1:main")).toBe(true);

    sessionRunRegistry.handleChatEvent({
      runId: "steer-command-9",
      sessionKey: "agent:bot-1:main",
      state: "final",
    });
    expect(sessionRunRegistry.isBusy("agent:bot-1:main")).toBe(false);
  });

  it("does not leave the session busy when guidance submission fails", async () => {
    const sessionRunRegistry = new SessionRunRegistry();
    const steerChatSession = vi.fn(async () => {
      throw new Error("gateway unavailable");
    });
    const { app } = createChatRoutesApp({
      sendToMainSession: vi.fn(async () => ({})),
      getSessionBySessionKey: vi.fn(async () => null),
      sessionRunRegistry,
      steerChatSession,
    });

    const response = await app.request("/api/v1/chat/steer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        message: "只总结已经发现的问题。",
      }),
    });

    expect(response.status).toBe(500);
    expect(sessionRunRegistry.isBusy("agent:bot-1:main")).toBe(false);
  });
});
