import { useTeams } from "@/hooks/use-teams";
import { cn } from "@/lib/utils";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Gauge, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiInternalDesktopReady,
  getApiV1ChannelsLiveStatus,
  getApiV1RuntimeAudit,
  getApiV1RuntimeConfig,
  getApiV1RuntimeOperations,
  getApiV1RuntimeRecovery,
  getApiV1TeamsByIdWorkflowApprovals,
  postApiV1RuntimeApprovalsByApprovalIdResolve,
  postApiV1RuntimeRecoveryCheckpointsByCheckpointIdRestore,
  postApiV1RuntimeTasksByTaskIdCancel,
  postApiV1TeamsByIdWorkflowsByWorkflowIdRunsByRunIdStepsByStepIdApprove,
} from "../../lib/api/sdk.gen";
import { ApprovalsTab } from "./session-operations/approvals-tab";
import { selectActiveTasks } from "./session-operations/formatting";
import { HealthTab } from "./session-operations/health-tab";
import { RecoveryTab } from "./session-operations/recovery-tab";
import { RunTab } from "./session-operations/run-tab";
import type {
  ApprovalDecision,
  OperationsTab,
  PendingApprovalView,
  RecoveryCheckpoint,
  RuntimeApproval,
  SessionOperationSnapshot,
  TaskGraphNode,
} from "./session-operations/types";

export type {
  SessionOperationTool,
  SessionOperationSnapshot,
} from "./session-operations/types";

interface SessionOperationsPanelProps {
  snapshot: SessionOperationSnapshot;
  onClose: () => void;
  onStop: () => void;
  onRetry?: () => void;
  onOpenBrowser: () => void;
  onOpenCanvas: () => void;
}

export function SessionOperationsPanel({
  snapshot,
  onClose,
  onStop,
  onRetry,
  onOpenBrowser,
  onOpenCanvas,
}: SessionOperationsPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<OperationsTab>("run");
  const [now, setNow] = useState(Date.now());
  const [hostAction, setHostAction] = useState<string | null>(null);
  const [expandedTaskGraphSessionKey, setExpandedTaskGraphSessionKey] =
    useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const {
    data: teamsData,
    isLoading: teamsLoading,
    isError: teamsError,
  } = useTeams();

  useEffect(() => {
    if (!snapshot.busy) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [snapshot.busy]);

  const operationsQuery = useQuery({
    queryKey: ["runtime-operations", snapshot.sessionKey, snapshot.agentId],
    queryFn: async () => {
      const { data, error } = await getApiV1RuntimeOperations({
        query: {
          ...(snapshot.sessionKey ? { sessionKey: snapshot.sessionKey } : {}),
          ...(snapshot.agentId ? { agentId: snapshot.agentId } : {}),
        },
      });
      if (error || !data) throw new Error("Runtime operations unavailable");
      return data;
    },
    refetchInterval: activeTab === "approvals" ? 2500 : 10000,
  });

  const auditQuery = useQuery({
    queryKey: ["runtime-audit", snapshot.sessionKey, snapshot.agentId],
    queryFn: async () => {
      const { data, error } = await getApiV1RuntimeAudit({
        query: {
          ...(snapshot.sessionKey ? { sessionKey: snapshot.sessionKey } : {}),
          ...(snapshot.agentId ? { agentId: snapshot.agentId } : {}),
          limit: 100,
        },
      });
      if (error || !data) throw new Error("Runtime audit unavailable");
      return data;
    },
    enabled: activeTab === "approvals",
    refetchInterval: activeTab === "approvals" ? 5000 : false,
  });

  const recoveryQuery = useQuery({
    queryKey: ["runtime-recovery", snapshot.sessionKey, snapshot.agentId],
    queryFn: async () => {
      const { data, error } = await getApiV1RuntimeRecovery({
        query: {
          ...(snapshot.sessionKey ? { sessionKey: snapshot.sessionKey } : {}),
          ...(snapshot.agentId ? { agentId: snapshot.agentId } : {}),
        },
      });
      if (error || !data) throw new Error("Runtime recovery unavailable");
      return data;
    },
    enabled: activeTab === "recovery",
    refetchInterval: activeTab === "recovery" ? 10000 : false,
  });

  const runtimeQuery = useQuery({
    queryKey: ["desktop-runtime-ready"],
    queryFn: async () => {
      const { data, error } = await getApiInternalDesktopReady();
      if (error || !data) throw new Error("Runtime status unavailable");
      return data;
    },
    refetchInterval: activeTab === "health" ? 3000 : 15000,
  });

  const channelsQuery = useQuery({
    queryKey: ["channels-live-status"],
    queryFn: async () => {
      const { data, error } = await getApiV1ChannelsLiveStatus();
      if (error || !data) throw new Error("Channel health unavailable");
      return data;
    },
    enabled: activeTab === "health",
    refetchInterval: 10000,
  });

  const runtimeConfigQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: async () => {
      const { data, error } = await getApiV1RuntimeConfig();
      if (error || !data) throw new Error("Runtime config unavailable");
      return data;
    },
    enabled: activeTab === "health",
    staleTime: 10000,
  });

  const teams = teamsData?.teams ?? [];
  const approvalQueries = useQueries({
    queries: teams.map((team) => ({
      queryKey: ["teams", team.id, "workflow-approvals"],
      queryFn: async () => {
        const { data, error } = await getApiV1TeamsByIdWorkflowApprovals({
          path: { id: team.id },
        });
        if (error || !data) throw new Error("Approvals unavailable");
        return data;
      },
      refetchInterval: activeTab === "approvals" ? 3000 : 15000,
    })),
  });
  const teamApprovals: PendingApprovalView[] = approvalQueries.flatMap(
    (query, index) => {
      const team = teams[index];
      if (!team) return [];
      return (query.data?.approvals ?? []).map((approval) => ({
        ...approval,
        teamName: team.name,
      }));
    },
  );
  const approvalsLoading =
    teamsLoading ||
    (teamApprovals.length === 0 &&
      approvalQueries.some((query) => query.isLoading));
  const teamApprovalsUnavailable =
    teamsError ||
    (!approvalsLoading &&
      approvalQueries.length > 0 &&
      approvalQueries.every((query) => query.isError));
  const approvalsPartial =
    !teamApprovalsUnavailable &&
    approvalQueries.some((query) => query.isError) &&
    approvalQueries.some((query) => query.data !== undefined);
  const runtimeApprovalsUnavailable =
    operationsQuery.isError ||
    operationsQuery.data?.approvalsAvailable === false;

  const runtimeApprovals = operationsQuery.data?.approvals ?? [];
  const taskGraphSessionKey = snapshot.sessionKey ?? "";
  const taskGraphExpanded = expandedTaskGraphSessionKey === taskGraphSessionKey;
  const activeTasks = selectActiveTasks(operationsQuery.data?.tasks ?? []);

  const approveTeamStep = useMutation({
    mutationFn: async (approval: PendingApprovalView) => {
      const { data, error } =
        await postApiV1TeamsByIdWorkflowsByWorkflowIdRunsByRunIdStepsByStepIdApprove(
          {
            path: {
              id: approval.teamId,
              workflowId: approval.workflowId,
              runId: approval.runId,
              stepId: approval.stepId,
            },
          },
        );
      if (error || !data) throw new Error("Approval failed");
      return data;
    },
    onSuccess: (_data, approval) => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["teams", approval.teamId, "workflow-approvals"],
        }),
        queryClient.invalidateQueries({ queryKey: ["runtime-audit"] }),
      ]);
      toast.success(t("sessions.operations.approved"));
    },
    onError: () => toast.error(t("sessions.operations.approvalFailed")),
  });

  const resolveRuntimeApproval = useMutation({
    mutationFn: async ({
      approval,
      decision,
    }: {
      approval: RuntimeApproval;
      decision: ApprovalDecision;
    }) => {
      const { data, error } =
        await postApiV1RuntimeApprovalsByApprovalIdResolve({
          path: { approvalId: approval.id },
          body: { kind: approval.kind, decision },
        });
      if (error || !data) throw new Error("Approval resolution failed");
      return data;
    },
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["runtime-operations"] }),
        queryClient.invalidateQueries({ queryKey: ["runtime-audit"] }),
      ]);
      toast.success(t("sessions.operations.approved"));
    },
    onError: () => toast.error(t("sessions.operations.approvalFailed")),
  });

  const cancelTask = useMutation({
    mutationFn: async (task: TaskGraphNode) => {
      if (task.source !== "openclaw" || !task.cancellable || !task.taskId) {
        throw new Error("Task cannot be cancelled");
      }
      const { data, error } = await postApiV1RuntimeTasksByTaskIdCancel({
        path: { taskId: task.taskId },
        body: { reason: "Cancelled from Nexu Run Center" },
      });
      if (error || !data) throw new Error("Task cancellation failed");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["runtime-operations"] });
      toast.success(t("sessions.operations.taskCancelled"));
    },
    onError: () => toast.error(t("sessions.operations.taskCancelFailed")),
  });

  const restoreCheckpoint = useMutation({
    mutationFn: async (checkpoint: RecoveryCheckpoint) => {
      const { data, error } =
        await postApiV1RuntimeRecoveryCheckpointsByCheckpointIdRestore({
          path: { checkpointId: checkpoint.checkpointId },
          body: {
            sessionKey: checkpoint.sessionKey,
            ...(snapshot.agentId ? { agentId: snapshot.agentId } : {}),
            confirm: true,
          },
        });
      if (error || !data) throw new Error("Checkpoint restore failed");
      return data;
    },
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["runtime-recovery"] }),
        queryClient.invalidateQueries({ queryKey: ["runtime-operations"] }),
        queryClient.invalidateQueries({ queryKey: ["chat-history"] }),
        queryClient.invalidateQueries({ queryKey: ["chat-run-status"] }),
        queryClient.invalidateQueries({ queryKey: ["session-meta"] }),
        queryClient.invalidateQueries({ queryKey: ["sessions-recent"] }),
        queryClient.invalidateQueries({ queryKey: ["sidebar-sessions"] }),
      ]);
      toast.success(t("sessions.operations.restoreSucceeded"));
    },
    onError: () => toast.error(t("sessions.operations.restoreFailed")),
  });

  const runHostAction = async (
    action: string,
    execute: () => Promise<unknown>,
  ) => {
    setHostAction(action);
    try {
      const result = await execute();
      if (result === undefined) throw new Error("Desktop host unavailable");
      toast.success(t("sessions.operations.actionComplete"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["desktop-runtime-ready"] }),
        queryClient.invalidateQueries({ queryKey: ["runtime-operations"] }),
      ]);
    } catch {
      toast.error(t("sessions.operations.actionFailed"));
    } finally {
      setHostAction(null);
    }
  };

  return (
    <aside
      data-session-operations="true"
      className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l border-border bg-[var(--color-tabby-bg)] sm:w-[360px]"
    >
      <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 text-text-secondary" />
          <h2 className="text-[13px] font-semibold text-text-heading">
            {t("sessions.operations.title")}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          aria-label={t("sessions.operations.close")}
          title={t("sessions.operations.close")}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid shrink-0 grid-cols-4 border-b border-border px-3 py-2">
        {(["run", "approvals", "health", "recovery"] as const).map((tab) => {
          const count =
            tab === "approvals"
              ? runtimeApprovals.length + teamApprovals.length
              : tab === "run"
                ? activeTasks.length
                : tab === "recovery" && recoveryQuery.data
                  ? recoveryQuery.data.deadLetters.reduce(
                      (total, queue) => total + queue.count,
                      recoveryQuery.data.quarantined.length,
                    )
                  : 0;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex h-8 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors",
                activeTab === tab
                  ? "bg-surface-2 text-text-primary"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {t(`sessions.operations.tab.${tab}`)}
              {count > 0 && (
                <span className="min-w-4 rounded-full bg-[var(--color-brand-primary)] px-1 text-[9px] leading-4 text-white">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "run" && (
          <RunTab
            snapshot={snapshot}
            now={now}
            operationsQuery={operationsQuery}
            taskGraphExpanded={taskGraphExpanded}
            onToggleTaskGraph={() =>
              setExpandedTaskGraphSessionKey(
                taskGraphExpanded ? null : taskGraphSessionKey,
              )
            }
            onCancelTask={(task) => cancelTask.mutate(task)}
            cancelTaskPending={cancelTask.isPending}
            onStop={onStop}
            onRetry={onRetry}
            onOpenBrowser={onOpenBrowser}
            onOpenCanvas={onOpenCanvas}
          />
        )}

        {activeTab === "approvals" && (
          <ApprovalsTab
            operationsLoading={operationsQuery.isLoading}
            approvalsLoading={approvalsLoading}
            runtimeApprovals={runtimeApprovals}
            teamApprovals={teamApprovals}
            runtimeApprovalsUnavailable={runtimeApprovalsUnavailable}
            teamApprovalsUnavailable={teamApprovalsUnavailable}
            approvalsPartial={approvalsPartial}
            auditQuery={auditQuery}
            canEnableNotifications={notificationPermission === "default"}
            onEnableNotifications={() => {
              void Notification.requestPermission().then(
                setNotificationPermission,
              );
            }}
            onResolveRuntimeApproval={(approval, decision) =>
              resolveRuntimeApproval.mutate({ approval, decision })
            }
            resolveRuntimeApprovalPending={resolveRuntimeApproval.isPending}
            onApproveTeamStep={(approval) => approveTeamStep.mutate(approval)}
            approveTeamStepPending={approveTeamStep.isPending}
          />
        )}

        {activeTab === "recovery" && (
          <RecoveryTab
            recoveryQuery={recoveryQuery}
            onRestoreCheckpoint={(checkpoint) =>
              restoreCheckpoint.mutate(checkpoint)
            }
            restoreCheckpointPending={restoreCheckpoint.isPending}
          />
        )}

        {activeTab === "health" && (
          <HealthTab
            runtimeQuery={runtimeQuery}
            operationsQuery={operationsQuery}
            channelsQuery={channelsQuery}
            runtimeConfigQuery={runtimeConfigQuery}
            hostAction={hostAction}
            onRunHostAction={runHostAction}
            onOpenBrowser={onOpenBrowser}
          />
        )}
      </div>
    </aside>
  );
}
