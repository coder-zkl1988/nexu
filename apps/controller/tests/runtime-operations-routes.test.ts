import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { registerRuntimeOperationsRoutes } from "../src/routes/runtime-operations-routes.js";
import type { ControllerBindings } from "../src/types.js";

function createOperationsApp(
  gatewayService: Partial<ControllerContainer["gatewayService"]>,
  overrides: Partial<ControllerContainer> = {},
) {
  const app = new OpenAPIHono<ControllerBindings>();
  registerRuntimeOperationsRoutes(app, {
    ...overrides,
    gatewayService,
  } as unknown as ControllerContainer);
  return app;
}

describe("runtime operations routes", () => {
  it("returns a sanitized aggregate of approvals, tasks, usage, and quotas", async () => {
    const gatewayService = {
      isConnected: vi.fn(() => true),
      listExecApprovals: vi.fn(async () => [
        {
          id: "approval-1",
          request: {
            command: "pnpm test",
            cwd: "/workspace",
            env: { SECRET_TOKEN: "must-not-leak" },
            envKeys: ["SECRET_TOKEN"],
            allowedDecisions: ["allow-once", "allow-always", "deny"],
            commandAnalysis: { riskKinds: ["shell-wrapper"] },
            sessionKey: "agent:bot-1:main",
          },
          createdAtMs: 10,
          expiresAtMs: 20,
        },
      ]),
      listPluginApprovals: vi.fn(async () => [
        {
          id: "plugin:approval-2",
          request: {
            title: "Control browser",
            description: "Open the current tab",
            allowedDecisions: ["allow-once", "deny"],
          },
          createdAtMs: 11,
          expiresAtMs: 21,
        },
      ]),
      listTasks: vi.fn(async () => ({
        tasks: [
          {
            id: "task-1",
            taskId: "task-1",
            kind: "subagent",
            runtime: "subagent",
            status: "running",
            title: "Audit settings",
            sessionKey: "agent:bot-1:main",
            createdAt: 1,
            updatedAt: 2,
            progressSummary: "Reading configuration",
          },
        ],
      })),
      getSessionUsage: vi.fn(async () => ({
        totals: {
          input: 100,
          output: 50,
          cacheRead: 10,
          cacheWrite: 5,
          totalTokens: 165,
          totalCost: 0.05,
          inputCost: 0.03,
          outputCost: 0.02,
          cacheReadCost: 0,
          cacheWriteCost: 0,
          missingCostEntries: 0,
        },
      })),
      getProviderUsage: vi.fn(async () => ({
        updatedAt: 1,
        providers: [
          {
            provider: "openai-codex",
            displayName: "OpenAI Codex",
            plan: "Team",
            windows: [{ label: "5 hours", usedPercent: 25, resetAt: 12345 }],
          },
        ],
      })),
      listModels: vi.fn(async () => ({
        models: [
          {
            id: "gpt-5.6",
            name: "GPT-5.6",
            provider: "openai",
            available: true,
            contextWindow: 1_050_000,
          },
        ],
      })),
    };
    const app = createOperationsApp(gatewayService);

    const response = await app.request(
      "/api/v1/runtime/operations?sessionKey=agent%3Abot-1%3Amain&agentId=bot-1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      connected: true,
      approvalsAvailable: true,
      tasksAvailable: true,
      usageAvailable: true,
      providerUsageAvailable: true,
      modelAuth: {
        status: "ready",
        availableModels: 1,
        configuredModels: 1,
      },
      usage: { totalTokens: 165, totalCost: 0.05 },
    });
    expect(body.approvals).toHaveLength(2);
    expect(body.approvals[0]).toMatchObject({
      id: "approval-1",
      kind: "exec",
      category: "controlled-terminal",
      command: "pnpm test",
      riskKinds: ["shell-wrapper"],
    });

    expect(body.approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "plugin",
          category: "browser",
        }),
      ]),
    );
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(JSON.stringify(body)).not.toContain("SECRET_TOKEN");
    expect(gatewayService.listTasks).toHaveBeenCalledWith({
      sessionKey: "agent:bot-1:main",
      agentId: "bot-1",
      limit: 100,
    });
  });

  it("resolves an approval using its explicit kind and decision", async () => {
    const resolveApproval = vi.fn(async () => ({ ok: true }));
    const app = createOperationsApp({
      isConnected: vi.fn(() => true),
      resolveApproval,
    });

    const response = await app.request(
      "/api/v1/runtime/approvals/approval-1/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "exec", decision: "deny" }),
      },
    );

    expect(response.status).toBe(200);
    expect(resolveApproval).toHaveBeenCalledWith({
      id: "approval-1",
      kind: "exec",
      decision: "deny",
    });
  });

  it("does not report a resolved approval as failed when audit persistence fails", async () => {
    const resolveApproval = vi.fn(async () => ({ ok: true }));
    const app = createOperationsApp(
      {
        isConnected: vi.fn(() => true),
        resolveApproval,
      },
      {
        approvalAuditService: {
          recordResolved: vi.fn(async () => {
            throw new Error("disk unavailable");
          }),
        } as unknown as ControllerContainer["approvalAuditService"],
      },
    );

    const response = await app.request(
      "/api/v1/runtime/approvals/approval-1/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "exec", decision: "allow-once" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(resolveApproval).toHaveBeenCalledTimes(1);
  });

  it("returns pending approvals when request audit persistence fails", async () => {
    const recordRequested = vi.fn(async (_input: Record<string, unknown>) => {
      throw new Error("disk unavailable");
    });
    const gatewayService = {
      isConnected: vi.fn(() => true),
      listExecApprovals: vi.fn(async () => [
        {
          id: "approval-sensitive",
          request: {
            command: "curl -H 'Authorization: Bearer command-secret'",
            commandPreview: "deploy title-secret",
            description: "description-secret",
            cwd: "/private/cwd-secret",
          },
          createdAtMs: 10,
          expiresAtMs: 20,
        },
      ]),
      listPluginApprovals: vi.fn(async () => []),
      listTasks: vi.fn(async () => ({ tasks: [] })),
      getProviderUsage: vi.fn(async () => ({ providers: [] })),
      listModels: vi.fn(async () => ({ models: [] })),
    };
    const app = createOperationsApp(gatewayService, {
      approvalAuditService: {
        recordRequested,
      } as unknown as ControllerContainer["approvalAuditService"],
    });

    const [operationsResponse, approvalsResponse] = await Promise.all([
      app.request("/api/v1/runtime/operations"),
      app.request("/api/v1/runtime/approvals"),
    ]);

    expect(operationsResponse.status).toBe(200);
    expect(approvalsResponse.status).toBe(200);
    await expect(operationsResponse.json()).resolves.toMatchObject({
      approvals: [expect.objectContaining({ id: "approval-sensitive" })],
    });
    await expect(approvalsResponse.json()).resolves.toMatchObject({
      approvals: [expect.objectContaining({ id: "approval-sensitive" })],
    });
    expect(recordRequested).toHaveBeenCalledTimes(2);
    for (const [auditInput] of recordRequested.mock.calls) {
      expect(auditInput).toMatchObject({
        approvalId: "approval-sensitive",
        kind: "exec",
        title: "Command approval",
      });
      const serialized = JSON.stringify(auditInput);
      expect(serialized).not.toContain("command-secret");
      expect(serialized).not.toContain("title-secret");
      expect(serialized).not.toContain("description-secret");
      expect(serialized).not.toContain("cwd-secret");
    }
  });

  it("projects OpenClaw and Team tasks into one dependency graph", async () => {
    const app = createOperationsApp(
      {
        isConnected: vi.fn(() => true),
        listExecApprovals: vi.fn(async () => []),
        listPluginApprovals: vi.fn(async () => []),
        listTasks: vi.fn(
          async (params: { sessionKey?: string; agentId?: string }) => ({
            tasks:
              params.sessionKey || params.agentId
                ? []
                : [
                    {
                      id: "root-task",
                      taskId: "root-task",
                      ownerKey: "owner-1",
                      flowId: "flow-1",
                      status: "completed",
                      createdAt: "2026-08-04T00:00:00.000Z",
                    },
                    {
                      id: "child-task",
                      taskId: "child-task",
                      parentTaskId: "root-task",
                      ownerKey: "owner-1",
                      flowId: "flow-1",
                      childSessionKey:
                        "agent:bot-writer:subagent:wf-run-1-publish",
                      status: "running",
                    },
                  ],
          }),
        ),
        getProviderUsage: vi.fn(async () => ({ providers: [] })),
        listModels: vi.fn(async () => ({ models: [] })),
      },
      {
        teamService: {
          listTeams: vi.fn(() => [{ id: "team-1", name: "Research" }]),
          getBoard: vi.fn(async () => ({
            boardId: "board-1",
            available: true,
            cards: [
              {
                id: "card-root",
                title: "Collect evidence",
                status: "done",
                parentIds: [],
                childIds: ["card-child"],
              },
              {
                id: "card-child",
                title: "Publish",
                status: "blocked",
                sessionKey: "agent:bot-writer:subagent:wf-run-1-publish",
                parentIds: ["card-root"],
                childIds: [],
              },
            ],
          })),
        } as unknown as ControllerContainer["teamService"],
      },
    );

    const response = await app.request(
      "/api/v1/runtime/operations?agentId=viewer",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.taskGraph).toMatchObject({
      available: true,
      partial: false,
      truncated: false,
      totalNodes: 4,
      sources: { openclaw: true, team: true },
    });
    expect(body.taskGraph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "openclaw:root-task",
          lifecycle: "succeeded",
          flowId: "flow-1",
        }),
        expect.objectContaining({
          id: "openclaw:child-task",
          groupId: "team:team-1",
          teamId: "team-1",
          cardId: "card-child",
        }),
        expect.objectContaining({
          id: "team:team-1:card-child",
          groupId: "team:team-1",
          lifecycle: "blocked",
          teamName: "Research",
        }),
      ]),
    );
    expect(body.taskGraph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "openclaw:root-task",
          to: "openclaw:child-task",
          kind: "parent_child",
        }),
        expect.objectContaining({
          from: "team:team-1:card-child",
          to: "openclaw:child-task",
          kind: "executes",
        }),
        expect.objectContaining({
          from: "team:team-1:card-root",
          to: "team:team-1:card-child",
          kind: "depends_on",
        }),
      ]),
    );
    expect(body.tasks).toEqual([]);
  });

  it("marks the unified task graph partial when the global task page is truncated", async () => {
    const app = createOperationsApp({
      isConnected: vi.fn(() => true),
      listExecApprovals: vi.fn(async () => []),
      listPluginApprovals: vi.fn(async () => []),
      listTasks: vi.fn(async (params: { agentId?: string }) =>
        params.agentId
          ? { tasks: [] }
          : {
              tasks: [
                {
                  id: "global-task-1",
                  taskId: "global-task-1",
                  status: "running" as const,
                },
              ],
              nextCursor: "global-page-2",
            },
      ),
      getProviderUsage: vi.fn(async () => ({ providers: [] })),
      listModels: vi.fn(async () => ({ models: [] })),
    });

    const response = await app.request(
      "/api/v1/runtime/operations?agentId=viewer",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tasks).toEqual([]);
    expect(body.taskGraph).toMatchObject({
      available: true,
      partial: true,
      truncated: true,
      totalNodes: 1,
      sources: { openclaw: true, team: true },
    });
    expect(body.taskGraph.nodes).toHaveLength(1);
  });

  it("returns persistent approval history beside metadata-only runtime audit", async () => {
    const app = createOperationsApp(
      {
        isConnected: vi.fn(() => true),
        listAudit: vi.fn(async () => ({
          events: [
            {
              eventId: "event-1",
              sequence: 2,
              sourceSequence: 1,
              occurredAt: 100,
              kind: "tool_action",
              action: "tool.action.finished",
              status: "succeeded",
              actor: { type: "agent", id: "agent-1" },
              agentId: "agent-1",
              sessionKey: "agent:agent-1:main",
              runId: "run-1",
              toolName: "browser",
              redaction: "metadata_only",
            },
          ],
        })),
      },
      {
        approvalAuditService: {
          list: vi.fn(async () => [
            {
              id: "openclaw:approval-1",
              approvalId: "approval-1",
              source: "openclaw",
              kind: "exec",
              status: "approved",
              decision: "allow-once",
              title: "pnpm test",
              reviewer: "Alice",
              requestedAt: 10,
              resolvedAt: 20,
            },
          ]),
        } as unknown as ControllerContainer["approvalAuditService"],
      },
    );

    const response = await app.request(
      "/api/v1/runtime/audit?sessionKey=agent%3Aagent-1%3Amain",
    );
    const body = await response.json();
    expect(body).toMatchObject({
      historyAvailable: true,
      runtimeAuditAvailable: true,
      approvalHistory: [
        expect.objectContaining({ reviewer: "Alice", status: "approved" }),
      ],
      events: [expect.objectContaining({ redaction: "metadata_only" })],
    });
  });

  it("exposes real dead-letter, quarantine, and checkpoint recovery state", async () => {
    const app = createOperationsApp({
      isConnected: vi.fn(() => true),
      getGatewayHealthSnapshot: vi.fn(async () => ({
        deliveryQueues: {
          failed: [{ queueName: "outbound", count: 2, oldestFailedAt: null }],
        },
        contextEngines: {
          quarantined: [
            {
              engineId: "plugin-context",
              operation: "build",
              reason: "schema failure",
              failedAt: 200,
            },
          ],
        },
      })),
      sessionsCompactionList: vi.fn(async () => ({
        ok: true,
        key: "agent:agent-1:main",
        checkpoints: [
          {
            checkpointId: "checkpoint-1",
            sessionKey: "agent:agent-1:main",
            sessionId: "session-1",
            createdAt: 300,
            reason: "manual",
          },
        ],
      })),
    });

    const response = await app.request(
      "/api/v1/runtime/recovery?sessionKey=agent%3Aagent-1%3Amain",
    );
    const body = await response.json();
    expect(body).toMatchObject({
      healthAvailable: true,
      deadLettersAvailable: true,
      deadLetterReplayAvailable: false,
      stateIsolationAvailable: true,
      quarantineClearAvailable: false,
      snapshotsAvailable: true,
      deadLetters: [{ queueName: "outbound", count: 2 }],
      quarantined: [{ engineId: "plugin-context" }],
      checkpoints: [{ checkpointId: "checkpoint-1" }],
    });
    expect(body.deadLetters).toEqual([{ queueName: "outbound", count: 2 }]);
  });

  it("does not claim dead-letter availability when health omits delivery queues", async () => {
    const app = createOperationsApp({
      isConnected: vi.fn(() => true),
      getGatewayHealthSnapshot: vi.fn(async () => ({
        contextEngines: { quarantined: [] },
      })),
    });

    const response = await app.request("/api/v1/runtime/recovery");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      healthAvailable: true,
      deadLettersAvailable: false,
      stateIsolationAvailable: true,
      deadLetters: [],
    });
  });

  it("does not claim recovery extensions when health omits their fields", async () => {
    const getGatewayHealthSnapshot = vi.fn(async () => ({}));
    const app = createOperationsApp({
      isConnected: vi.fn(() => true),
      getGatewayHealthSnapshot,
    });

    const response = await app.request("/api/v1/runtime/recovery");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getGatewayHealthSnapshot).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      probe: false,
    });
    expect(body).toMatchObject({
      healthAvailable: true,
      deadLettersAvailable: false,
      stateIsolationAvailable: false,
      deadLetters: [],
      quarantined: [],
    });
  });

  it("restores a durable checkpoint only after explicit confirmation", async () => {
    const sessionsCompactionRestore = vi.fn(async () => ({
      ok: true as const,
      key: "agent:agent-1:main",
      sessionId: "session-1",
      checkpoint: {
        checkpointId: "checkpoint-1",
        sessionKey: "agent:agent-1:main",
        sessionId: "session-1",
        createdAt: 300,
        reason: "manual" as const,
      },
      entry: {
        sessionId: "session-1",
        updatedAt: 400,
        sessionFile: "/private/runtime/session-1.jsonl",
      },
      sessionFile: "/private/runtime/session-1.jsonl",
      internalStateDir: "/private/runtime",
    }));
    const app = createOperationsApp(
      {
        isConnected: vi.fn(() => true),
        sessionsCompactionRestore,
      },
      {
        sessionRunRegistry: {
          isBusy: vi.fn(() => false),
        } as unknown as ControllerContainer["sessionRunRegistry"],
      },
    );

    const response = await app.request(
      "/api/v1/runtime/recovery/checkpoints/checkpoint-1/restore",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionKey: "agent:agent-1:main",
          confirm: true,
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      key: "agent:agent-1:main",
      sessionId: "session-1",
      checkpoint: {
        checkpointId: "checkpoint-1",
        sessionKey: "agent:agent-1:main",
        sessionId: "session-1",
        createdAt: 300,
        reason: "manual",
      },
      entry: { sessionId: "session-1", updatedAt: 400 },
    });
    expect(JSON.stringify(body)).not.toContain("sessionFile");
    expect(JSON.stringify(body)).not.toContain("/private/runtime");
    expect(sessionsCompactionRestore).toHaveBeenCalledWith({
      key: "agent:agent-1:main",
      checkpointId: "checkpoint-1",
    });
  });

  it("rejects a checkpoint restore whose returned identities disagree", async () => {
    const app = createOperationsApp(
      {
        isConnected: vi.fn(() => true),
        sessionsCompactionRestore: vi.fn(async () => ({
          ok: true as const,
          key: "agent:agent-1:main",
          sessionId: "session-1",
          checkpoint: {
            checkpointId: "checkpoint-1",
            sessionKey: "agent:agent-1:main",
            sessionId: "session-1",
            createdAt: 300,
            reason: "manual" as const,
          },
          entry: { sessionId: "different-session", updatedAt: 400 },
        })),
      },
      {
        sessionRunRegistry: {
          isBusy: vi.fn(() => false),
        } as unknown as ControllerContainer["sessionRunRegistry"],
      },
    );

    const response = await app.request(
      "/api/v1/runtime/recovery/checkpoints/checkpoint-1/restore",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionKey: "agent:agent-1:main",
          confirm: true,
        }),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toBe("Checkpoint restore failed");
  });

  it("reports unavailable capabilities when OpenClaw is disconnected", async () => {
    const app = createOperationsApp({ isConnected: vi.fn(() => false) });
    const response = await app.request("/api/v1/runtime/operations");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connected: false,
      approvalsAvailable: false,
      tasksAvailable: false,
      usageAvailable: false,
      providerUsageAvailable: false,
      modelAuth: {
        status: "unavailable",
        availableModels: 0,
        configuredModels: 0,
      },
      approvals: [],
      tasks: [],
      providers: [],
    });
  });

  it("does not infer model authentication from provider usage", async () => {
    const app = createOperationsApp({
      isConnected: vi.fn(() => true),
      listExecApprovals: vi.fn(async () => []),
      listPluginApprovals: vi.fn(async () => []),
      listTasks: vi.fn(async () => ({ tasks: [] })),
      getProviderUsage: vi.fn(async () => ({
        providers: [
          {
            provider: "openai-codex",
            displayName: "OpenAI Codex",
            windows: [],
            error: "authentication failed",
          },
        ],
      })),
      listModels: vi.fn(async () => ({
        models: [
          {
            id: "gpt-5.6",
            name: "GPT-5.6",
            provider: "openai",
            available: false,
          },
        ],
      })),
    });

    const response = await app.request("/api/v1/runtime/operations");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      providerUsageAvailable: true,
      modelAuth: {
        status: "needs-attention",
        availableModels: 0,
        configuredModels: 1,
      },
    });
  });

  it("keeps valid approvals visible while marking a failed source unavailable", async () => {
    const app = createOperationsApp({
      isConnected: vi.fn(() => true),
      listExecApprovals: vi.fn(async () => [
        {
          id: "approval-1",
          request: { command: "pnpm test" },
          createdAtMs: 10,
          expiresAtMs: 20,
        },
      ]),
      listPluginApprovals: vi.fn(async () => {
        throw new Error("plugin approval RPC unavailable");
      }),
      listTasks: vi.fn(async () => ({ tasks: [] })),
      getProviderUsage: vi.fn(async () => ({ providers: [] })),
      listModels: vi.fn(async () => ({ models: [] })),
    });

    const response = await app.request("/api/v1/runtime/operations");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.approvalsAvailable).toBe(false);
    expect(body.approvals).toEqual([
      expect.objectContaining({ id: "approval-1", kind: "exec" }),
    ]);
  });

  it("marks approvals unavailable when an approval source returns an invalid payload", async () => {
    const app = createOperationsApp({
      isConnected: vi.fn(() => true),
      listExecApprovals: vi.fn(async () => []),
      listPluginApprovals: vi.fn(async () => ({ approvals: [] })),
      listTasks: vi.fn(async () => ({ tasks: [] })),
      getProviderUsage: vi.fn(async () => ({ providers: [] })),
      listModels: vi.fn(async () => ({ models: [] })),
    });

    const response = await app.request("/api/v1/runtime/operations");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      approvalsAvailable: false,
      approvals: [],
    });
  });

  it("returns a lightweight partial approval snapshot for global notifications", async () => {
    const app = createOperationsApp({
      isConnected: vi.fn(() => true),
      listExecApprovals: vi.fn(async () => [
        {
          id: "approval-1",
          request: { command: "git status" },
          createdAtMs: 10,
          expiresAtMs: 20,
        },
      ]),
      listPluginApprovals: vi.fn(async () => {
        throw new Error("plugin approval RPC unavailable");
      }),
    });

    const response = await app.request("/api/v1/runtime/approvals");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connected: true,
      available: false,
      approvals: [expect.objectContaining({ id: "approval-1", kind: "exec" })],
    });
  });
});
