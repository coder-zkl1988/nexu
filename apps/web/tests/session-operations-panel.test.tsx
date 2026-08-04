// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionOperationsPanel } from "../src/components/session-operations-panel";

const apiMocks = vi.hoisted(() => ({
  getReady: vi.fn(),
  getOperations: vi.fn(),
  getChannels: vi.fn(),
  getRuntimeConfig: vi.fn(),
  getAudit: vi.fn(),
  getRecovery: vi.fn(),
  getApprovals: vi.fn(),
  approveStep: vi.fn(),
  resolveApproval: vi.fn(),
  restoreCheckpoint: vi.fn(),
  cancelTask: vi.fn(),
  requestPermissions: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

let teamsState: {
  data: { teams: Array<{ id: string; name: string }> };
  isLoading: boolean;
  isError: boolean;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => teamsState,
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiInternalDesktopReady: (...args: unknown[]) =>
    apiMocks.getReady(...args),
  getApiV1RuntimeOperations: (...args: unknown[]) =>
    apiMocks.getOperations(...args),
  getApiV1ChannelsLiveStatus: (...args: unknown[]) =>
    apiMocks.getChannels(...args),
  getApiV1RuntimeConfig: (...args: unknown[]) =>
    apiMocks.getRuntimeConfig(...args),
  getApiV1RuntimeAudit: (...args: unknown[]) => apiMocks.getAudit(...args),
  getApiV1RuntimeRecovery: (...args: unknown[]) =>
    apiMocks.getRecovery(...args),
  getApiV1TeamsByIdWorkflowApprovals: (...args: unknown[]) =>
    apiMocks.getApprovals(...args),
  postApiV1RuntimeApprovalsByApprovalIdResolve: (...args: unknown[]) =>
    apiMocks.resolveApproval(...args),
  postApiV1RuntimeTasksByTaskIdCancel: (...args: unknown[]) =>
    apiMocks.cancelTask(...args),
  postApiV1RuntimeRecoveryCheckpointsByCheckpointIdRestore: (
    ...args: unknown[]
  ) => apiMocks.restoreCheckpoint(...args),
  postApiV1RuntimeConfigLocalAutomationComputerUsePermissions: (
    ...args: unknown[]
  ) => apiMocks.requestPermissions(...args),
  postApiV1TeamsByIdWorkflowsByWorkflowIdRunsByRunIdStepsByStepIdApprove: (
    ...args: unknown[]
  ) => apiMocks.approveStep(...args),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

function renderPanel(overrides?: { onStop?: () => void; busy?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["desktop-runtime-ready"], {
    ready: true,
    coreReady: true,
    degraded: false,
    bootPhase: "ready",
    workspacePath: "/tmp/workspace",
    controlPlane: { ok: true, phase: "ready", wsConnected: true },
    status: "active",
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SessionOperationsPanel
          snapshot={{
            busy: overrides?.busy ?? true,
            messageCount: 12,
            modelId: "openai/gpt-5.6",
            contextUsedTokens: 32_000,
            contextWindowTokens: 128_000,
            contextFresh: true,
            sessionKey: "agent:main:session-1",
            agentId: "agent-1",
            startedAt: Date.now() - 5000,
            tools: [
              {
                id: "tool-1",
                name: "Browser",
                summary: "Inspect release notes",
              },
            ],
            fileCount: 2,
            imageCount: 1,
            previewCount: 3,
            canvasCount: 4,
            browserAvailable: true,
            browserOpen: false,
            browserOwnedByAgent: true,
          }}
          onClose={vi.fn()}
          onStop={overrides?.onStop ?? vi.fn()}
          onOpenBrowser={vi.fn()}
          onOpenCanvas={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SessionOperationsPanel", () => {
  beforeEach(() => {
    teamsState = {
      data: { teams: [{ id: "team-1", name: "Research team" }] },
      isLoading: false,
      isError: false,
    };
    apiMocks.getReady.mockReset();
    apiMocks.getOperations.mockReset();
    apiMocks.getChannels.mockReset();
    apiMocks.getRuntimeConfig.mockReset();
    apiMocks.getAudit.mockReset();
    apiMocks.getRecovery.mockReset();
    apiMocks.getApprovals.mockReset();
    apiMocks.approveStep.mockReset();
    apiMocks.resolveApproval.mockReset();
    apiMocks.restoreCheckpoint.mockReset();
    apiMocks.cancelTask.mockReset();
    apiMocks.requestPermissions.mockReset();
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
    apiMocks.getReady.mockResolvedValue({
      data: {
        ready: true,
        degraded: false,
        status: "active",
        controlPlane: { phase: "ready", wsConnected: true },
      },
    });
    apiMocks.getApprovals.mockResolvedValue({ data: { approvals: [] } });
    apiMocks.getAudit.mockResolvedValue({
      data: {
        connected: true,
        historyAvailable: true,
        runtimeAuditAvailable: true,
        approvalHistory: [],
        events: [],
      },
    });
    apiMocks.getRecovery.mockResolvedValue({
      data: {
        connected: true,
        healthAvailable: true,
        deadLettersAvailable: true,
        deadLetterReplayAvailable: false,
        stateIsolationAvailable: true,
        quarantineClearAvailable: false,
        snapshotsAvailable: true,
        deadLetters: [],
        quarantined: [],
        checkpoints: [],
      },
    });
    apiMocks.approveStep.mockResolvedValue({ data: { ok: true } });
    apiMocks.getOperations.mockResolvedValue({
      data: {
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
        approvals: [],
        tasks: [],
        taskGraph: {
          available: true,
          partial: false,
          truncated: false,
          totalNodes: 0,
          sources: { openclaw: true, team: true },
          nodes: [],
          edges: [],
        },
        usage: {
          input: 100,
          output: 20,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 120,
          totalCost: 0.01,
          missingCostEntries: 0,
        },
        providers: [],
      },
    });
    apiMocks.getChannels.mockResolvedValue({
      data: {
        gatewayConnected: true,
        gatewaySafeMode: false,
        channels: [],
        agent: { modelId: "openai/gpt-5.6", modelName: "GPT", alive: true },
      },
    });
    apiMocks.getRuntimeConfig.mockResolvedValue({
      data: {
        runtime: {},
        deviceControl: {},
        localAutomation: { browser: { enabled: true } },
        localAutomationStatus: {
          previewEnabled: true,
          computerUseAvailable: true,
          computerUseUnavailableReason: null,
          computerUseBinaryPath: "/tmp/cua",
          computerUseBackend: "cua-driver",
          computerUsePermissionState: "ready",
          computerUsePermissions: [],
        },
      },
    });
    apiMocks.resolveApproval.mockResolvedValue({ data: { ok: true } });
    apiMocks.restoreCheckpoint.mockResolvedValue({
      data: {
        ok: true,
        key: "agent:main:session-1",
        sessionId: "session-1",
      },
    });
    apiMocks.cancelTask.mockResolvedValue({
      data: { found: true, cancelled: true },
    });
    apiMocks.requestPermissions.mockResolvedValue({
      data: { requested: true },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders task, health, outputs, and invokes Stop", async () => {
    const onStop = vi.fn();
    const { container } = renderPanel({ onStop });

    expect(
      container.querySelector('[data-session-operations="true"]'),
    ).not.toBeNull();
    expect(screen.getByText("sessions.operations.running")).toBeTruthy();
    expect(screen.getByText("Browser")).toBeTruthy();
    expect(screen.getByText("Inspect release notes")).toBeTruthy();
    expect(screen.getByText("openai/gpt-5.6")).toBeTruthy();
    expect(await screen.findByText("120")).toBeTruthy();
    expect(screen.getByText("$0.0100")).toBeTruthy();
    expect(screen.getByText("sessions.operations.context")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "sessions.operations.stop" }),
    );
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does not present missing model pricing as a zero session cost", async () => {
    apiMocks.getOperations.mockResolvedValue({
      data: {
        connected: true,
        approvalsAvailable: true,
        tasksAvailable: true,
        usageAvailable: true,
        providerUsageAvailable: false,
        modelAuth: {
          status: "ready",
          availableModels: 1,
          configuredModels: 1,
        },
        approvals: [],
        tasks: [],
        taskGraph: {
          available: true,
          partial: false,
          truncated: false,
          totalNodes: 0,
          sources: { openclaw: true, team: true },
          nodes: [],
          edges: [],
        },
        usage: {
          input: 78_048,
          output: 785,
          cacheRead: 99_328,
          cacheWrite: 0,
          totalTokens: 178_161,
          totalCost: 0,
          missingCostEntries: 6,
        },
        providers: [],
      },
    });

    renderPanel();

    const unavailable = await screen.findByText(
      "sessions.operations.costUnavailable",
    );
    expect(unavailable.getAttribute("title")).toBe(
      "sessions.operations.costUnavailableHint",
    );
    expect(screen.queryByText("$0.0000")).toBeNull();
  });

  it("renders OpenClaw and Team nodes in one dependency graph", async () => {
    apiMocks.getOperations.mockResolvedValue({
      data: {
        connected: true,
        approvalsAvailable: true,
        tasksAvailable: true,
        usageAvailable: false,
        providerUsageAvailable: false,
        modelAuth: {
          status: "ready",
          availableModels: 1,
          configuredModels: 1,
        },
        approvals: [],
        tasks: [
          {
            id: "runtime-root",
            taskId: "runtime-task-id",
            title: "Collect runtime evidence",
            status: "running",
          },
        ],
        taskGraph: {
          available: true,
          partial: false,
          truncated: false,
          totalNodes: 3,
          sources: { openclaw: true, team: true },
          nodes: [
            {
              id: "team:team-1:child-card",
              source: "team",
              sourceId: "child-card",
              kind: "team-task",
              groupId: "team:team-1",
              title: "Publish findings",
              lifecycle: "queued",
              rawStatus: "todo",
              teamId: "team-1",
              teamName: "Research team",
              cardId: "child-card",
              cancellable: false,
            },
            {
              id: "openclaw:runtime-root",
              source: "openclaw",
              sourceId: "runtime-root",
              kind: "subagent",
              groupId: "openclaw:run-1",
              title: "Collect runtime evidence",
              lifecycle: "running",
              rawStatus: "running",
              taskId: "runtime-task-id",
              cancellable: true,
            },
            {
              id: "team:team-1:root-card",
              source: "team",
              sourceId: "root-card",
              kind: "team-task",
              groupId: "team:team-1",
              title: "Research evidence",
              lifecycle: "succeeded",
              rawStatus: "done",
              teamId: "team-1",
              teamName: "Research team",
              cardId: "root-card",
              output: "Evidence ready",
              cancellable: false,
            },
          ],
          edges: [
            {
              id: "depends-on:root:child",
              from: "team:team-1:root-card",
              to: "team:team-1:child-card",
              kind: "depends_on",
            },
          ],
        },
        providers: [],
      },
    });

    const { container } = renderPanel();

    expect(await screen.findByText("Research evidence")).toBeTruthy();
    expect(screen.getByText("Publish findings")).toBeTruthy();
    expect(screen.getAllByText("Collect runtime evidence")).toHaveLength(2);
    expect(
      screen.getByText(
        'sessions.operations.dependsOn:{"parents":"Research evidence"}',
      ),
    ).toBeTruthy();
    expect(
      container.querySelectorAll('[data-unified-task-dag="true"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-task-source="openclaw"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-task-source="team"]')).not.toBeNull();
    expect(
      screen.getAllByRole("button", {
        name: "sessions.operations.cancelTask",
      }),
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: "sessions.operations.cancelTask",
      }),
    );
    await waitFor(() =>
      expect(apiMocks.cancelTask).toHaveBeenCalledWith({
        path: { taskId: "runtime-task-id" },
        body: { reason: "Cancelled from Nexu Run Center" },
      }),
    );
  });

  it("previews 16 task nodes and exposes explicit show-all and collapse controls", async () => {
    apiMocks.getOperations.mockResolvedValue({
      data: {
        connected: true,
        approvalsAvailable: true,
        tasksAvailable: true,
        usageAvailable: false,
        providerUsageAvailable: false,
        modelAuth: {
          status: "ready",
          availableModels: 1,
          configuredModels: 1,
        },
        approvals: [],
        tasks: [],
        taskGraph: {
          available: true,
          partial: true,
          truncated: true,
          totalNodes: 18,
          sources: { openclaw: true, team: true },
          nodes: Array.from({ length: 18 }, (_, index) => ({
            id: `openclaw:task-${index}`,
            source: "openclaw",
            sourceId: `task-${index}`,
            kind: "subagent",
            groupId: "openclaw:run-1",
            title: `Task ${index.toString().padStart(2, "0")}`,
            lifecycle: "queued",
            rawStatus: "queued",
            taskId: `task-${index}`,
            cancellable: false,
          })),
          edges: [],
        },
        providers: [],
      },
    });

    const { container } = renderPanel();

    expect(await screen.findByText("Task 00")).toBeTruthy();
    expect(container.querySelectorAll("[data-task-source]")).toHaveLength(16);
    expect(screen.queryByText("Task 17")).toBeNull();
    expect(
      screen.getByText(
        'sessions.operations.unifiedTaskDagTruncated:{"count":18}',
      ),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'sessions.operations.showAllTaskNodes:{"count":2}',
      }),
    );

    expect(container.querySelectorAll("[data-task-source]")).toHaveLength(18);
    expect(screen.getByText("Task 17")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "sessions.operations.collapseTaskNodes",
      }),
    );

    expect(container.querySelectorAll("[data-task-source]")).toHaveLength(16);
    expect(screen.queryByText("Task 17")).toBeNull();
  });

  it("keeps available approvals visible when another team query fails", async () => {
    teamsState = {
      data: {
        teams: [
          { id: "team-1", name: "Research team" },
          { id: "team-2", name: "Publishing team" },
        ],
      },
      isLoading: false,
      isError: false,
    };
    apiMocks.getApprovals.mockImplementation(
      async (options: { path: { id: string } }) => {
        if (options.path.id === "team-2") {
          return { error: { message: "offline" } };
        }
        return {
          data: {
            approvals: [
              {
                teamId: "team-1",
                workflowId: "workflow-1",
                runId: "run-1",
                stepId: "step-1",
                cardId: "card-1",
                prompt: "Publish the final report?",
              },
            ],
          },
        };
      },
    );

    const { container } = renderPanel();

    fireEvent.click(
      screen.getByRole("button", { name: /sessions.operations.tab.approvals/ }),
    );

    await screen.findByText("Publish the final report?");
    expect(screen.getByText("Research team")).toBeTruthy();
    expect(
      container.querySelector('[data-approvals-partial="true"]'),
    ).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "sessions.operations.approve" }),
    );
    await waitFor(() => expect(apiMocks.approveStep).toHaveBeenCalledTimes(1));
    expect(toastMocks.success).toHaveBeenCalledWith(
      "sessions.operations.approved",
    );
  });

  it("shows an explicit unavailable state for the unified task graph", async () => {
    apiMocks.getOperations.mockResolvedValue({
      data: {
        connected: true,
        approvalsAvailable: true,
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
        taskGraph: {
          available: false,
          partial: true,
          truncated: false,
          totalNodes: 0,
          sources: { openclaw: false, team: false },
          nodes: [],
          edges: [],
        },
        providers: [],
      },
    });

    const { container } = renderPanel();

    expect(
      await screen.findByText("sessions.operations.unifiedTaskDagUnavailable"),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-unified-task-dag-unavailable="true"]'),
    ).not.toBeNull();
  });

  it("shows persisted reviewer history and metadata-only runtime audit", async () => {
    apiMocks.getAudit.mockResolvedValue({
      data: {
        connected: true,
        historyAvailable: true,
        runtimeAuditAvailable: true,
        approvalHistory: [
          {
            id: "history-1",
            approvalId: "approval-1",
            source: "openclaw",
            kind: "exec",
            status: "approved",
            decision: "allow-once",
            title: "git status",
            reviewer: "Desktop User",
            requestedAt: 1_723_000_000_000,
            resolvedAt: 1_723_000_001_000,
          },
        ],
        events: [
          {
            eventId: "event-1",
            sequence: 1,
            sourceSequence: 1,
            occurredAt: 1_723_000_002_000,
            kind: "tool_action",
            action: "tool.action.finished",
            status: "succeeded",
            actor: { type: "agent", id: "agent-1" },
            agentId: "agent-1",
            runId: "run-1",
            toolCallId: "tool-call-1",
            toolName: "exec",
            redaction: "metadata_only",
          },
        ],
      },
    });

    const { container } = renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: /sessions.operations.tab.approvals/ }),
    );

    await screen.findByText("git status");
    expect(
      container.querySelector('[data-approval-history="approved"]')
        ?.textContent,
    ).toContain("Desktop User");
    expect(
      screen.getByText("sessions.operations.approvalDecision.allow-once"),
    ).toBeTruthy();
    expect(
      screen.getByText("sessions.operations.approvalStatus.approved"),
    ).toBeTruthy();
    expect(screen.getByText("exec")).toBeTruthy();
    expect(screen.getByText("sessions.operations.metadataOnly")).toBeTruthy();
  });

  it("shows real recovery boundaries and restores a durable checkpoint", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    apiMocks.getRecovery.mockResolvedValue({
      data: {
        connected: true,
        healthAvailable: true,
        deadLettersAvailable: true,
        deadLetterReplayAvailable: false,
        stateIsolationAvailable: true,
        quarantineClearAvailable: false,
        snapshotsAvailable: true,
        deadLetters: [
          {
            queueName: "outbound",
            count: 3,
            oldestFailedAt: 1_723_000_000_000,
          },
        ],
        quarantined: [
          {
            engineId: "context-engine-1",
            owner: "agent-1",
            operation: "compact",
            reason: "state checksum mismatch",
            failedAt: 1_723_000_001_000,
          },
        ],
        checkpoints: [
          {
            checkpointId: "checkpoint-1",
            sessionKey: "agent:main:session-1",
            sessionId: "session-1",
            createdAt: 1_723_000_002_000,
            reason: "manual",
            summary: "Before publishing",
          },
        ],
      },
    });

    const { container } = renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: /sessions.operations.tab.recovery/ }),
    );

    expect(await screen.findByText("outbound")).toBeTruthy();
    expect(screen.getByText("context-engine-1")).toBeTruthy();
    expect(screen.getByText("Before publishing")).toBeTruthy();
    expect(
      screen.getByText("sessions.operations.deadLetterReplayUnavailable"),
    ).toBeTruthy();
    expect(
      screen.getByText("sessions.operations.quarantineClearUnavailable"),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-dead-letter-replay-unavailable="true"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-quarantine-clear-unavailable="true"]'),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: /replay/i })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "sessions.operations.restoreCheckpoint",
      }),
    );

    expect(window.confirm).toHaveBeenCalledWith(
      "sessions.operations.restoreConfirm",
    );
    await waitFor(() =>
      expect(apiMocks.restoreCheckpoint).toHaveBeenCalledWith({
        path: { checkpointId: "checkpoint-1" },
        body: {
          sessionKey: "agent:main:session-1",
          agentId: "agent-1",
          confirm: true,
        },
      }),
    );
    expect(toastMocks.success).toHaveBeenCalledWith(
      "sessions.operations.restoreSucceeded",
    );
  });

  it("uses the runtime model catalog instead of usage RPC health", async () => {
    apiMocks.getOperations.mockResolvedValue({
      data: {
        connected: true,
        approvalsAvailable: true,
        tasksAvailable: true,
        usageAvailable: false,
        providerUsageAvailable: true,
        modelAuth: {
          status: "needs-attention",
          availableModels: 0,
          configuredModels: 1,
        },
        approvals: [],
        tasks: [],
        providers: [],
      },
    });

    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "sessions.operations.tab.health" }),
    );

    expect(
      await screen.findByText("sessions.operations.needsAttention"),
    ).toBeTruthy();
  });

  it("does not report an idle run when runtime tasks are unavailable", async () => {
    apiMocks.getOperations.mockResolvedValue({
      error: { message: "runtime operations offline" },
    });

    const { container } = renderPanel({ busy: false });

    expect(
      await screen.findByText("sessions.operations.unavailable"),
    ).toBeTruthy();
    expect(screen.queryByText("sessions.operations.idle")).toBeNull();
    expect(
      container.querySelector('[data-runtime-task-status="unavailable"]'),
    ).not.toBeNull();
  });

  it("shows an explicit unavailable state when provider quotas fail", async () => {
    apiMocks.getOperations.mockResolvedValue({
      data: {
        connected: true,
        approvalsAvailable: true,
        tasksAvailable: true,
        usageAvailable: true,
        providerUsageAvailable: false,
        modelAuth: {
          status: "ready",
          availableModels: 1,
          configuredModels: 1,
        },
        approvals: [],
        tasks: [],
        usage: {
          input: 100,
          output: 20,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 120,
          totalCost: 0.01,
          missingCostEntries: 0,
        },
        providers: [],
      },
    });

    const { container } = renderPanel();

    expect(
      await screen.findByText("sessions.operations.quotaUnavailable"),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-provider-usage-unavailable="true"]'),
    ).not.toBeNull();
  });

  it("shows unavailable browser and model health when their queries fail", async () => {
    apiMocks.getOperations.mockResolvedValue({
      error: { message: "runtime operations offline" },
    });
    apiMocks.getRuntimeConfig.mockResolvedValue({
      error: { message: "runtime config offline" },
    });

    renderPanel({ busy: false });
    fireEvent.click(
      screen.getByRole("button", { name: "sessions.operations.tab.health" }),
    );

    const browserLabel = await screen.findByText("sessions.operations.browser");
    const modelLabel = screen.getByText("sessions.operations.modelAuth");
    await waitFor(() => {
      expect(browserLabel.parentElement?.parentElement?.textContent).toContain(
        "sessions.operations.unavailable",
      );
      expect(modelLabel.parentElement?.parentElement?.textContent).toContain(
        "sessions.operations.unavailable",
      );
    });
    expect(screen.queryByText("sessions.operations.needsAttention")).toBeNull();
  });

  it("does not show a green empty approval state for partial runtime data", async () => {
    apiMocks.getOperations.mockResolvedValue({
      data: {
        connected: true,
        approvalsAvailable: false,
        tasksAvailable: true,
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
      },
    });

    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "sessions.operations.tab.approvals" }),
    );

    expect(
      await screen.findByText(
        "sessions.operations.runtimeApprovalsUnavailable",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("sessions.operations.noApprovals")).toBeNull();
  });

  it("resolves a controlled terminal approval with an explicit decision", async () => {
    apiMocks.getOperations.mockResolvedValue({
      data: {
        connected: true,
        approvalsAvailable: true,
        tasksAvailable: true,
        usageAvailable: false,
        providerUsageAvailable: false,
        modelAuth: {
          status: "unavailable",
          availableModels: 0,
          configuredModels: 0,
        },
        approvals: [
          {
            id: "approval-1",
            kind: "exec",
            category: "controlled-terminal",
            title: "git status",
            cwd: "/tmp/repo",
            riskKinds: [],
            allowedDecisions: ["allow-once", "allow-always", "deny"],
            createdAtMs: Date.now(),
            expiresAtMs: Date.now() + 30_000,
          },
        ],
        tasks: [],
        providers: [],
      },
    });

    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: /sessions.operations.tab.approvals/ }),
    );
    await screen.findByText("git status");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "sessions.operations.allowAlways",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "sessions.operations.deny" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "sessions.operations.allowOnce" }),
    );

    await waitFor(() =>
      expect(apiMocks.resolveApproval).toHaveBeenCalledWith({
        path: { approvalId: "approval-1" },
        body: { kind: "exec", decision: "allow-once" },
      }),
    );
  });
});
