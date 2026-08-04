// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalNotificationWatcher } from "../src/components/approval-notification-watcher";

const apiMocks = vi.hoisted(() => ({
  getRuntimeApprovals: vi.fn(),
  getTeamApprovals: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    data: { teams: [{ id: "team-1", name: "Research team" }] },
  }),
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1RuntimeApprovals: (...args: unknown[]) =>
    apiMocks.getRuntimeApprovals(...args),
  getApiV1TeamsByIdWorkflowApprovals: (...args: unknown[]) =>
    apiMocks.getTeamApprovals(...args),
}));

function renderWatcher() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApprovalNotificationWatcher />
    </QueryClientProvider>,
  );
}

describe("ApprovalNotificationWatcher", () => {
  const notificationConstructor = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    notificationConstructor.mockReset();
    function NotificationMock(
      this: unknown,
      title: string,
      options?: NotificationOptions,
    ) {
      notificationConstructor(title, options);
    }
    Object.assign(NotificationMock, {
      permission: "granted",
      requestPermission: vi.fn(async () => "granted"),
    });
    vi.stubGlobal("Notification", NotificationMock);
    apiMocks.getRuntimeApprovals.mockResolvedValue({
      data: {
        connected: true,
        available: true,
        approvals: [
          {
            id: "approval-1",
            kind: "plugin",
            category: "browser",
            title: "Open browser",
            riskKinds: [],
            allowedDecisions: ["allow-once", "deny"],
            createdAtMs: Date.now(),
            expiresAtMs: Date.now() + 30_000,
          },
        ],
      },
    });
    apiMocks.getTeamApprovals.mockResolvedValue({
      data: {
        approvals: [
          {
            teamId: "team-1",
            workflowId: "workflow-1",
            runId: "run-1",
            stepId: "step-1",
            cardId: "card-1",
            prompt: "Publish the report?",
          },
        ],
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("notifies every pending source and persists deduplication across remounts", async () => {
    const first = renderWatcher();

    await waitFor(() =>
      expect(notificationConstructor).toHaveBeenCalledTimes(2),
    );
    expect(notificationConstructor).toHaveBeenCalledWith(
      "sessions.operations.notificationTitle",
      { body: "Open browser" },
    );
    expect(notificationConstructor).toHaveBeenCalledWith(
      "sessions.operations.notificationTitle",
      { body: "Research team: Publish the report?" },
    );

    first.unmount();
    renderWatcher();
    await waitFor(() =>
      expect(apiMocks.getRuntimeApprovals).toHaveBeenCalled(),
    );
    expect(notificationConstructor).toHaveBeenCalledTimes(2);
  });
});
