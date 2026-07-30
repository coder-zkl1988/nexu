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
}: {
  sendToMainSession: ControllerContainer["gatewayService"]["sendToMainSession"];
  getSessionBySessionKey: ControllerContainer["sessionService"]["getSessionBySessionKey"];
  sessionRunRegistry?: SessionRunRegistry;
}) {
  const app = new OpenAPIHono<ControllerBindings>();
  const eventHandlers = new Map<string, (payload: unknown) => void>();
  const chatHandlers = new Set<(payload: unknown) => void>();
  registerChatRoutes(app, {
    env: {
      openclawStateDir: "/tmp/nexu-test-openclaw-state",
    },
    gatewayService: {
      sendToMainSession,
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
      on: (event: string, handler: (payload: unknown) => void) => {
        eventHandlers.set(event, handler);
      },
      onChatEvent: (handler: (payload: unknown) => void) => {
        chatHandlers.add(handler);
        return () => {
          chatHandlers.delete(handler);
        };
      },
      onChatSideResult: () => () => {},
    },
  } as unknown as ControllerContainer);
  return {
    app,
    sessionRunRegistry,
    emitAgent: (payload: unknown) => eventHandlers.get("agent")?.(payload),
    emitChat: (payload: unknown) => {
      for (const handler of chatHandlers) handler(payload);
    },
  };
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

  it("surfaces an unverified computer action as an SSE error", async () => {
    const { app, emitAgent, emitChat } = createChatRoutesApp({
      sendToMainSession: vi.fn(async () => ({})),
      getSessionBySessionKey: vi.fn(async () => null),
    });
    const abortController = new AbortController();
    const response = await app.request(
      "/api/v1/chat/local/stream?botId=bot-1&sessionKey=agent%3Abot-1%3Amain&runId=run-guarded",
      { signal: abortController.signal },
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    const connected = await reader?.read();
    expect(decoder.decode(connected?.value)).toContain("event: connected");

    emitAgent({
      runId: "run-guarded",
      stream: "tool",
      data: {
        phase: "start",
        name: "peekaboo__type",
        toolCallId: "type-guarded",
        args: { app: "飞书", text: "锦鲤" },
      },
    });
    emitAgent({
      runId: "run-guarded",
      stream: "tool",
      data: {
        phase: "result",
        name: "peekaboo__type",
        toolCallId: "type-guarded",
        isError: false,
      },
    });
    emitChat({
      runId: "run-guarded",
      sessionKey: "agent:bot-1:main",
      seq: 7,
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "已完成。" }],
      },
    });

    const guarded = await reader?.read();
    const guardedText = decoder.decode(guarded?.value);
    expect(guardedText).toContain("event: error");
    expect(guardedText).toContain("local_automation_unverified");
    expect(guardedText).not.toContain("event: final");

    emitChat({
      runId: "run-guarded",
      sessionKey: "agent:bot-1:main",
      seq: 8,
      state: "delta",
      deltaText: "迟到的成功文本",
    });
    emitChat({
      runId: "run-guarded",
      sessionKey: "agent:bot-1:main",
      seq: 9,
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "已完成。" }],
      },
    });
    const lateRead = reader?.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await reader?.cancel();
    const late = await lateRead;
    const lateText = decoder.decode(late?.value);
    expect(lateText).not.toContain("迟到的成功文本");
    expect(lateText).not.toContain("event: final");

    abortController.abort();
  });

  it("keeps an unscoped session stream open for later runs", async () => {
    const { app, emitChat } = createChatRoutesApp({
      sendToMainSession: vi.fn(async () => ({})),
      getSessionBySessionKey: vi.fn(async () => null),
    });
    const abortController = new AbortController();
    const response = await app.request(
      "/api/v1/chat/local/stream?botId=bot-1&sessionKey=agent%3Abot-1%3Amain",
      { signal: abortController.signal },
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    const connected = await reader?.read();
    expect(decoder.decode(connected?.value)).toContain("event: connected");

    emitChat({
      runId: "run-first",
      sessionKey: "agent:bot-1:main",
      seq: 1,
      state: "final",
      message: { role: "assistant", content: [] },
    });
    const firstFinal = decoder.decode((await reader?.read())?.value);
    expect(firstFinal).toContain("event: final");
    expect(firstFinal).toContain("run-first");

    emitChat({
      runId: "run-first",
      sessionKey: "agent:bot-1:main",
      seq: 2,
      state: "delta",
      deltaText: "late-first-run",
    });
    emitChat({
      runId: "run-second",
      sessionKey: "agent:bot-1:main",
      seq: 1,
      state: "delta",
      deltaText: "second-run",
    });
    const secondDelta = decoder.decode((await reader?.read())?.value);
    expect(secondDelta).toContain("event: delta");
    expect(secondDelta).toContain("second-run");
    expect(secondDelta).not.toContain("late-first-run");

    emitChat({
      runId: "run-second",
      sessionKey: "agent:bot-1:main",
      seq: 2,
      state: "final",
      message: { role: "assistant", content: [] },
    });
    const secondFinal = decoder.decode((await reader?.read())?.value);
    expect(secondFinal).toContain("event: final");
    expect(secondFinal).toContain("run-second");

    await reader?.cancel();
    abortController.abort();
  });

  it("sends the same guarded failure to every SSE subscriber", async () => {
    const { app, emitAgent, emitChat } = createChatRoutesApp({
      sendToMainSession: vi.fn(async () => ({})),
      getSessionBySessionKey: vi.fn(async () => null),
    });
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const url =
      "/api/v1/chat/local/stream?botId=bot-1&sessionKey=agent%3Abot-1%3Amain&runId=run-shared";
    const firstResponse = await app.request(url, {
      signal: firstAbort.signal,
    });
    const secondResponse = await app.request(url, {
      signal: secondAbort.signal,
    });
    const firstReader = firstResponse.body?.getReader();
    const secondReader = secondResponse.body?.getReader();
    expect(firstReader).toBeDefined();
    expect(secondReader).toBeDefined();
    const decoder = new TextDecoder();
    expect(decoder.decode((await firstReader?.read())?.value)).toContain(
      "event: connected",
    );
    expect(decoder.decode((await secondReader?.read())?.value)).toContain(
      "event: connected",
    );

    // Typing is a verifiable action class, so an unread-back value stays a
    // hard failure. A click would only raise an advisory, which keeps the
    // final event and would not exercise the shared-failure path.
    emitAgent({
      runId: "run-shared",
      stream: "tool",
      data: {
        phase: "start",
        name: "peekaboo__type",
        toolCallId: "click-shared",
        args: { app: "Safari", element_id: "search", text: "锦鲤" },
      },
    });
    emitAgent({
      runId: "run-shared",
      stream: "tool",
      data: {
        phase: "result",
        name: "peekaboo__type",
        toolCallId: "click-shared",
        isError: false,
      },
    });
    emitChat({
      runId: "run-shared",
      sessionKey: "agent:bot-1:main",
      seq: 1,
      state: "final",
      message: { role: "assistant", content: [] },
    });

    for (const guardedText of [
      decoder.decode((await firstReader?.read())?.value),
      decoder.decode((await secondReader?.read())?.value),
    ]) {
      expect(guardedText).toContain("event: error");
      expect(guardedText).toContain("local_automation_unverified");
      expect(guardedText).not.toContain("event: final");
    }

    await firstReader?.cancel();
    await secondReader?.cancel();
    firstAbort.abort();
    secondAbort.abort();
  });
});
