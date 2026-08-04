import type { SessionResponse } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import {
  SessionMessageNotFoundError,
  type SessionsRuntime,
} from "../src/runtime/sessions-runtime.js";
import type {
  OpenClawGatewayService,
  SessionCompactionCheckpointSnapshot,
} from "../src/services/openclaw-gateway-service.js";
import type { SessionRunRegistry } from "../src/services/session-run-registry.js";
import { SessionService } from "../src/services/session-service.js";

function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    id: "session-1.jsonl",
    botId: "bot-1",
    sessionKey: "agent:bot-1:session-1",
    channelType: "webchat",
    channelId: null,
    title: "Release review",
    status: "active",
    messageCount: 2,
    lastMessageAt: "2026-08-03T02:00:00.000Z",
    metadata: null,
    createdAt: "2026-08-03T01:00:00.000Z",
    updatedAt: "2026-08-03T02:00:00.000Z",
    category: null,
    pinned: false,
    unread: false,
    archived: false,
    archivedAt: null,
    checkpointCount: 0,
    runState: "idle",
    ...overrides,
  };
}

function createRuntimeStub(sessions: SessionResponse[]) {
  return {
    listSessions: vi.fn(async () => sessions),
    getSession: vi.fn(
      async (id: string) => sessions.find((item) => item.id === id) ?? null,
    ),
    invalidateSessionsCache: vi.fn(),
    materializeSessionFile: vi.fn(async () => "recovery.jsonl"),
    sessionContainsMessage: vi.fn(async () => true),
    sessionContainsActiveMessage: vi.fn(async () => true),
    selectActiveMessage: vi.fn(async () => undefined),
  } as unknown as SessionsRuntime;
}

function createGatewayStub() {
  return {
    isConnected: vi.fn(() => true),
    sessionsPatch: vi.fn(async () => ({})),
    sessionsCompactionList: vi.fn(async () => ({ checkpoints: [] })),
    sessionsCompactionBranch: vi.fn(async () => ({})),
    sessionsCreate: vi.fn(async () => ({})),
  } as unknown as OpenClawGatewayService;
}

describe("SessionService organization and recovery", () => {
  it("overlays live run state, filters unread sessions, and sorts pinned first", async () => {
    const sessions = [
      session({
        id: "running.jsonl",
        sessionKey: "agent:bot-1:running",
        title: "Running task",
        unread: true,
      }),
      session({
        id: "pinned.jsonl",
        sessionKey: "agent:bot-1:pinned",
        title: "Pinned task",
        pinned: true,
        unread: true,
        updatedAt: "2026-08-02T02:00:00.000Z",
      }),
      session({
        id: "read.jsonl",
        sessionKey: "agent:bot-1:read",
        title: "Read task",
      }),
    ];
    const runtime = createRuntimeStub(sessions);
    const runRegistry = {
      isBusy: vi.fn((key: string) => key.endsWith(":running")),
    } as unknown as SessionRunRegistry;
    const service = new SessionService(
      runtime,
      createGatewayStub(),
      runRegistry,
    );

    const result = await service.listSessions({
      limit: 20,
      offset: 0,
      unread: true,
    });

    expect(result.sessions.map((item) => item.id)).toEqual([
      "pinned.jsonl",
      "running.jsonl",
    ]);
    expect(result.sessions[1]?.runState).toBe("running");
    expect(runtime.listSessions).toHaveBeenCalledWith(false, "exclude");
  });

  it("passes clear-category, pin, and unread changes through sessions.patch", async () => {
    const runtime = createRuntimeStub([session()]);
    const gateway = createGatewayStub();
    const service = new SessionService(runtime, gateway);

    await service.updateOrganization("session-1.jsonl", {
      clearCategory: true,
      pinned: true,
      unread: true,
    });

    expect(gateway.sessionsPatch).toHaveBeenCalledWith({
      key: "agent:bot-1:session-1",
      agentId: "bot-1",
      category: null,
      pinned: true,
      unread: true,
    });
    expect(runtime.invalidateSessionsCache).toHaveBeenCalledOnce();
  });

  it("can find an archived session when restoring it", async () => {
    const runtime = createRuntimeStub([session({ archived: true })]);
    const gateway = createGatewayStub();
    const service = new SessionService(runtime, gateway);

    await service.setSessionArchived("session-1.jsonl", false);

    expect(runtime.getSession).toHaveBeenCalledWith("session-1.jsonl", true);
    expect(gateway.sessionsPatch).toHaveBeenCalledWith({
      key: "agent:bot-1:session-1",
      agentId: "bot-1",
      archived: false,
    });
    expect(runtime.invalidateSessionsCache).toHaveBeenCalledOnce();
  });

  it("lists real checkpoints and creates a non-destructive recovery branch", async () => {
    const runtime = createRuntimeStub([session()]);
    const gateway = createGatewayStub();
    const checkpoint: SessionCompactionCheckpointSnapshot = {
      checkpointId: "checkpoint-1",
      sessionKey: "agent:bot-1:session-1",
      sessionId: "session-1",
      createdAt: Date.parse("2026-08-03T03:00:00.000Z"),
      reason: "auto-threshold",
      tokensBefore: 18_000,
      tokensAfter: 4_000,
      summary: "Release plan",
    };
    vi.mocked(gateway.sessionsCompactionList).mockResolvedValue({
      checkpoints: [checkpoint],
    });
    vi.mocked(gateway.sessionsCompactionBranch).mockResolvedValue({
      ok: true,
      sourceKey: "agent:bot-1:session-1",
      key: "agent:bot-1:recovery",
      sessionId: "recovery",
      checkpoint,
      entry: {
        sessionId: "recovery",
        sessionFile: "/tmp/recovery.jsonl",
      },
    });
    const service = new SessionService(runtime, gateway);

    const listed = await service.listCheckpoints("session-1.jsonl");
    const recovered = await service.branchFromCheckpoint(
      "session-1.jsonl",
      "checkpoint-1",
    );

    expect(listed).toEqual({
      checkpoints: [
        {
          id: "checkpoint-1",
          createdAt: "2026-08-03T03:00:00.000Z",
          reason: "auto-threshold",
          tokensBefore: 18_000,
          tokensAfter: 4_000,
          summary: "Release plan",
        },
      ],
    });
    expect(gateway.sessionsCompactionBranch).toHaveBeenCalledWith({
      key: "agent:bot-1:session-1",
      agentId: "bot-1",
      checkpointId: "checkpoint-1",
    });
    expect(recovered).toMatchObject({
      id: "recovery.jsonl",
      sessionKey: "agent:bot-1:recovery",
      title: "Release review · recovery",
    });
  });

  it("uses OpenClaw's real fork mode for whole-session and message branches", async () => {
    const runtime = createRuntimeStub([session()]);
    const gateway = createGatewayStub();
    vi.mocked(gateway.sessionsCreate).mockResolvedValue({
      ok: true,
      key: "agent:bot-1:forked",
      sessionId: "forked",
      entry: {
        sessionId: "forked",
        sessionFile: "/tmp/forked.jsonl",
      },
    });
    const service = new SessionService(runtime, gateway);

    await service.forkSession("session-1.jsonl");
    const branch = await service.branchAtMessage(
      "session-1.jsonl",
      "message-1",
    );

    expect(gateway.sessionsCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        agentId: "bot-1",
        parentSessionKey: "agent:bot-1:session-1",
        fork: true,
      }),
    );
    expect(gateway.sessionsCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agentId: "bot-1",
        parentSessionKey: "agent:bot-1:session-1",
        fork: true,
      }),
    );
    expect(runtime.sessionContainsActiveMessage).toHaveBeenCalledWith({
      botId: "bot-1",
      sessionKey: "agent:bot-1:session-1",
      messageId: "message-1",
    });
    expect(runtime.selectActiveMessage).toHaveBeenCalledWith({
      botId: "bot-1",
      sessionKey: "agent:bot-1:forked",
      sessionFile: "/tmp/forked.jsonl",
      messageId: "message-1",
    });
    expect(branch).toMatchObject({
      id: "recovery.jsonl",
      sessionKey: "agent:bot-1:forked",
      messageId: "message-1",
    });
  });

  it("rejects message branch changes while the session is running", async () => {
    const runtime = createRuntimeStub([session()]);
    const gateway = createGatewayStub();
    const runRegistry = {
      isBusy: vi.fn(() => true),
    } as unknown as SessionRunRegistry;
    const service = new SessionService(runtime, gateway, runRegistry);

    await expect(
      service.branchAtMessage("session-1.jsonl", "message-1"),
    ).rejects.toThrow("while the session is running");
    await expect(
      service.rollbackToMessage("session-1.jsonl", "message-1"),
    ).rejects.toThrow("while the session is running");
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(runtime.selectActiveMessage).not.toHaveBeenCalled();
  });

  it("rejects message branch changes while the gateway is disconnected", async () => {
    const runtime = createRuntimeStub([session()]);
    const gateway = createGatewayStub();
    vi.mocked(gateway.isConnected).mockReturnValue(false);
    const service = new SessionService(runtime, gateway);

    await expect(
      service.branchAtMessage("session-1.jsonl", "message-1"),
    ).rejects.toThrow("OpenClaw gateway is not connected");
    await expect(
      service.rollbackToMessage("session-1.jsonl", "message-1"),
    ).rejects.toThrow("OpenClaw gateway is not connected");
    expect(runtime.selectActiveMessage).not.toHaveBeenCalled();
  });

  it("validates the active source branch before creating a fork", async () => {
    const runtime = createRuntimeStub([session()]);
    const gateway = createGatewayStub();
    vi.mocked(runtime.sessionContainsActiveMessage).mockResolvedValue(false);
    const service = new SessionService(runtime, gateway);

    await expect(
      service.branchAtMessage("session-1.jsonl", "inactive-message"),
    ).rejects.toBeInstanceOf(SessionMessageNotFoundError);
    expect(gateway.sessionsCreate).not.toHaveBeenCalled();
    expect(runtime.materializeSessionFile).not.toHaveBeenCalled();
    expect(runtime.selectActiveMessage).not.toHaveBeenCalled();
  });
});
