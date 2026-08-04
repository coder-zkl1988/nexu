import { useTeams } from "@/hooks/use-teams";
import { requestDesktopHost } from "@/lib/desktop-host";
import { cn } from "@/lib/utils";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Coins,
  FileOutput,
  Gauge,
  GitBranch,
  Globe2,
  LayoutDashboard,
  Loader2,
  MonitorCog,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
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
  postApiV1RuntimeConfigLocalAutomationComputerUsePermissions,
  postApiV1RuntimeRecoveryCheckpointsByCheckpointIdRestore,
  postApiV1RuntimeTasksByTaskIdCancel,
  postApiV1TeamsByIdWorkflowsByWorkflowIdRunsByRunIdStepsByStepIdApprove,
} from "../../lib/api/sdk.gen";
import type {
  GetApiV1RuntimeOperationsResponse,
  GetApiV1RuntimeRecoveryResponse,
} from "../../lib/api/types.gen";

export interface SessionOperationTool {
  id: string;
  name: string;
  summary: string;
}

export interface SessionOperationSnapshot {
  busy: boolean;
  messageCount: number;
  modelId: string | null;
  contextUsedTokens: number | null;
  contextWindowTokens: number | null;
  contextFresh: boolean | null;
  sessionKey: string | null;
  agentId: string | null;
  startedAt: number | null;
  tools: SessionOperationTool[];
  fileCount: number;
  imageCount: number;
  previewCount: number;
  canvasCount: number;
  browserAvailable: boolean;
  browserOpen: boolean;
  browserOwnedByAgent: boolean;
}

interface SessionOperationsPanelProps {
  snapshot: SessionOperationSnapshot;
  onClose: () => void;
  onStop: () => void;
  onRetry?: () => void;
  onOpenBrowser: () => void;
  onOpenCanvas: () => void;
}

interface PendingApprovalView {
  teamId: string;
  teamName: string;
  workflowId: string;
  runId: string;
  stepId: string;
  prompt: string;
}

type OperationsTab = "run" | "approvals" | "health" | "recovery";
type RuntimeApproval = GetApiV1RuntimeOperationsResponse["approvals"][number];
type TaskGraph = GetApiV1RuntimeOperationsResponse["taskGraph"];
type TaskGraphNode = TaskGraph["nodes"][number];
const TASK_GRAPH_PREVIEW_LIMIT = 16;
type RecoveryCheckpoint =
  GetApiV1RuntimeRecoveryResponse["checkpoints"][number];
type ApprovalDecision = RuntimeApproval["allowedDecisions"][number];

function approvalLabelKey(category: RuntimeApproval["category"]) {
  switch (category) {
    case "controlled-terminal":
      return "sessions.operations.controlledTerminal";
    case "browser":
      return "sessions.operations.browserApproval";
    case "computer-use":
      return "sessions.operations.computerUseApproval";
    case "sensitive-tool":
      return "sessions.operations.sensitiveToolApproval";
  }
}

function StatusDot({
  active,
  warning = false,
}: { active: boolean; warning?: boolean }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        warning
          ? "bg-[var(--color-warning)]"
          : active
            ? "bg-[var(--color-success)]"
            : "bg-text-tertiary",
      )}
    />
  );
}

function SectionTitle({
  icon: Icon,
  children,
}: { icon: typeof Activity; children: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
      <Icon className="size-3.5" />
      <span>{children}</span>
    </div>
  );
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(
    value,
  );
}

function formatReset(resetAt: number | undefined) {
  if (!resetAt) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(resetAt));
}

function timestampToMs(value: string | number | null | undefined) {
  if (typeof value === "number") return value;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function taskTone(lifecycle: TaskGraphNode["lifecycle"]) {
  if (lifecycle === "running") return "text-[var(--color-brand-primary)]";
  if (
    lifecycle === "failed" ||
    lifecycle === "timed_out" ||
    lifecycle === "blocked"
  ) {
    return "text-danger";
  }
  if (lifecycle === "succeeded") return "text-[var(--color-success)]";
  return "text-text-muted";
}

function orderTaskGraph(graph: TaskGraph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const parentsById = new Map<string, TaskGraphNode[]>();
  for (const edge of graph.edges) {
    const parent = byId.get(edge.from);
    if (!parent || !byId.has(edge.to)) continue;
    const parents = parentsById.get(edge.to) ?? [];
    parents.push(parent);
    parentsById.set(edge.to, parents);
  }
  const depthById = new Map<string, number>();

  const resolveDepth = (node: TaskGraphNode, trail: Set<string>): number => {
    const cached = depthById.get(node.id);
    if (cached !== undefined) return cached;
    if (trail.has(node.id)) return 0;
    const nextTrail = new Set(trail).add(node.id);
    const parents = parentsById.get(node.id) ?? [];
    const depth =
      parents.length === 0
        ? 0
        : 1 +
          Math.max(...parents.map((parent) => resolveDepth(parent, nextTrail)));
    depthById.set(node.id, depth);
    return depth;
  };

  return graph.nodes
    .map((node) => ({
      node,
      depth: resolveDepth(node, new Set()),
      parents: parentsById.get(node.id) ?? [],
    }))
    .sort(
      (left, right) =>
        left.depth - right.depth ||
        left.node.title.localeCompare(right.node.title),
    );
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

  const {
    data: runtime,
    isLoading: runtimeLoading,
    isError: runtimeError,
  } = useQuery({
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
  const taskGraph = operationsQuery.data?.taskGraph;
  const orderedTaskGraph = useMemo(
    () => (taskGraph ? orderTaskGraph(taskGraph) : []),
    [taskGraph],
  );
  const taskGraphSessionKey = snapshot.sessionKey ?? "";
  const taskGraphExpanded = expandedTaskGraphSessionKey === taskGraphSessionKey;
  const taskGraphRemainingCount = Math.max(
    0,
    orderedTaskGraph.length - TASK_GRAPH_PREVIEW_LIMIT,
  );
  const visibleTaskGraph = taskGraphExpanded
    ? orderedTaskGraph
    : orderedTaskGraph.slice(0, TASK_GRAPH_PREVIEW_LIMIT);
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

  const runtimeHealthy = runtime?.ready === true;
  const runtimeWarning =
    runtime?.degraded === true || runtime?.status === "unhealthy";
  const latestTools = snapshot.tools.slice(-5).reverse();
  const outputCount = snapshot.fileCount + snapshot.imageCount;
  const tasks = operationsQuery.data?.tasks ?? [];
  const activeTask = tasks.find(
    (task) => task.status === "running" || task.status === "queued",
  );
  const runStartedAt =
    timestampToMs(activeTask?.startedAt) ?? snapshot.startedAt;
  const elapsed = runStartedAt ? formatDuration(now - runStartedAt) : null;
  const activeTasks = tasks.filter(
    (task) => task.status === "running" || task.status === "queued",
  );
  const taskStatusChecking =
    !snapshot.busy && !activeTask && operationsQuery.isLoading;
  const taskStatusUnavailable =
    !snapshot.busy &&
    !activeTask &&
    (operationsQuery.isError || operationsQuery.data?.tasksAvailable === false);
  const channelSummary = channelsQuery.data
    ? `${channelsQuery.data.channels.filter((channel) => channel.ready).length}/${channelsQuery.data.channels.length}`
    : null;
  const computerUseStatus =
    runtimeConfigQuery.data?.localAutomationStatus.computerUsePermissionState;
  const contextAvailable =
    snapshot.contextUsedTokens !== null &&
    snapshot.contextWindowTokens !== null &&
    snapshot.contextWindowTokens > 0;
  const contextPercent = contextAvailable
    ? Math.min(
        100,
        Math.max(
          0,
          ((snapshot.contextUsedTokens ?? 0) /
            (snapshot.contextWindowTokens ?? 1)) *
            100,
        ),
      )
    : 0;

  return (
    <aside
      data-session-operations="true"
      className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l border-border bg-surface-0 sm:w-[360px]"
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
          <>
            <section className="border-b border-border px-4 py-4">
              <SectionTitle icon={Activity}>
                {t("sessions.operations.currentRun")}
              </SectionTitle>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  {snapshot.busy || activeTask || taskStatusChecking ? (
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--color-brand-primary)]" />
                  ) : taskStatusUnavailable ? (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
                  ) : (
                    <Check className="mt-0.5 size-4 shrink-0 text-[var(--color-success)]" />
                  )}
                  <div className="min-w-0">
                    <div
                      data-runtime-task-status={
                        taskStatusUnavailable
                          ? "unavailable"
                          : taskStatusChecking
                            ? "checking"
                            : snapshot.busy || activeTask
                              ? "running"
                              : "idle"
                      }
                      className="truncate text-[12px] font-medium text-text-primary"
                    >
                      {activeTask?.title ??
                        (snapshot.busy
                          ? t("sessions.operations.running")
                          : taskStatusChecking
                            ? t("sessions.operations.checking")
                            : taskStatusUnavailable
                              ? t("sessions.operations.unavailable")
                              : t("sessions.operations.idle"))}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
                      <span>
                        {t("sessions.operations.messageCount", {
                          count: snapshot.messageCount,
                        })}
                      </span>
                      {elapsed && (
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="size-3" />
                          {elapsed}
                        </span>
                      )}
                      {tasks.length > 0 && (
                        <span>
                          {t("sessions.operations.taskCount", {
                            count: tasks.length,
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {(snapshot.busy || activeTask) && (
                    <button
                      type="button"
                      onClick={onStop}
                      className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-danger transition-colors hover:bg-[var(--color-danger-subtle)]"
                    >
                      {t("sessions.operations.stop")}
                    </button>
                  )}
                  {taskStatusUnavailable && (
                    <button
                      type="button"
                      onClick={() => void operationsQuery.refetch()}
                      className="rounded-md border border-border p-1.5 text-text-secondary transition-colors hover:bg-surface-2"
                      aria-label={t("sessions.operations.retryCheck")}
                      title={t("sessions.operations.retryCheck")}
                    >
                      <RefreshCcw className="size-3.5" />
                    </button>
                  )}
                  {!snapshot.busy && !taskStatusUnavailable && onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="rounded-md border border-border p-1.5 text-text-secondary transition-colors hover:bg-surface-2"
                      aria-label={t("sessions.operations.retry")}
                      title={t("sessions.operations.retry")}
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div
                data-unified-task-dag="true"
                className="mt-3 space-y-2 border-t border-border pt-3"
              >
                <SectionTitle icon={GitBranch}>
                  {t("sessions.operations.unifiedTaskDag")}
                </SectionTitle>
                {operationsQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    <Loader2 className="size-3 animate-spin" />
                    {t("sessions.operations.checking")}
                  </div>
                ) : operationsQuery.isError ||
                  !taskGraph ||
                  !taskGraph.available ? (
                  <div
                    data-unified-task-dag-unavailable="true"
                    className="flex items-center justify-between gap-3 border-l-2 border-[var(--color-warning)] pl-2.5"
                  >
                    <span className="text-[10px] text-text-muted">
                      {t("sessions.operations.unifiedTaskDagUnavailable")}
                    </span>
                    <button
                      type="button"
                      onClick={() => void operationsQuery.refetch()}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[9px] font-medium text-text-secondary hover:bg-surface-2"
                    >
                      {t("sessions.operations.retryCheck")}
                    </button>
                  </div>
                ) : orderedTaskGraph.length === 0 ? (
                  <div className="text-[10px] text-text-muted">
                    {t("sessions.operations.noTasks")}
                  </div>
                ) : (
                  <>
                    {taskGraph.partial &&
                      (!taskGraph.sources.openclaw ||
                        !taskGraph.sources.team) && (
                        <div
                          data-unified-task-dag-partial="true"
                          className="flex items-center gap-2 text-[10px] text-[var(--color-warning)]"
                        >
                          <CircleAlert className="size-3 shrink-0" />
                          {t("sessions.operations.unifiedTaskDagUnavailable")}
                        </div>
                      )}
                    {taskGraph.truncated && (
                      <div
                        data-unified-task-dag-truncated="true"
                        className="flex items-center gap-2 text-[10px] text-[var(--color-warning)]"
                      >
                        <CircleAlert className="size-3 shrink-0" />
                        {t("sessions.operations.unifiedTaskDagTruncated", {
                          count: taskGraph.totalNodes,
                        })}
                      </div>
                    )}
                    {visibleTaskGraph.map(({ node, depth, parents }) => (
                      <div
                        key={node.id}
                        data-task-source={node.source}
                        data-task-lifecycle={node.lifecycle}
                        className="border-l border-border pl-2"
                        style={{ marginLeft: Math.min(depth, 4) * 12 }}
                      >
                        <div className="flex items-start gap-1.5">
                          <StatusDot
                            active={node.lifecycle === "succeeded"}
                            warning={
                              node.lifecycle === "failed" ||
                              node.lifecycle === "timed_out" ||
                              node.lifecycle === "blocked"
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-primary">
                                {node.title}
                              </span>
                              <span className="shrink-0 text-[9px] text-text-tertiary">
                                {node.source === "openclaw"
                                  ? t("sessions.operations.sourceOpenClaw")
                                  : (node.teamName ??
                                    t("sessions.operations.sourceTeam"))}
                              </span>
                            </div>
                            <div
                              className={cn(
                                "mt-0.5 truncate text-[9px]",
                                taskTone(node.lifecycle),
                              )}
                            >
                              {t(
                                `sessions.operations.lifecycle.${node.lifecycle}`,
                              )}
                              {node.output ? ` · ${node.output}` : ""}
                              {node.error ? ` · ${node.error}` : ""}
                            </div>
                            {parents.length > 0 && (
                              <div className="mt-0.5 truncate text-[9px] text-text-muted">
                                {t("sessions.operations.dependsOn", {
                                  parents: parents
                                    .map((parent) => parent.title)
                                    .join(", "),
                                })}
                              </div>
                            )}
                          </div>
                          {node.source === "openclaw" &&
                            node.cancellable &&
                            node.taskId && (
                              <button
                                type="button"
                                disabled={cancelTask.isPending}
                                onClick={() => cancelTask.mutate(node)}
                                className="shrink-0 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50"
                                aria-label={t("sessions.operations.cancelTask")}
                                title={t("sessions.operations.cancelTask")}
                              >
                                <X className="size-3" />
                              </button>
                            )}
                        </div>
                      </div>
                    ))}
                    {taskGraphRemainingCount > 0 && (
                      <button
                        type="button"
                        data-task-graph-toggle="true"
                        onClick={() =>
                          setExpandedTaskGraphSessionKey(
                            taskGraphExpanded ? null : taskGraphSessionKey,
                          )
                        }
                        className="w-full rounded-md border border-border px-2 py-1.5 text-[10px] font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
                      >
                        {taskGraphExpanded
                          ? t("sessions.operations.collapseTaskNodes")
                          : t("sessions.operations.showAllTaskNodes", {
                              count: taskGraphRemainingCount,
                            })}
                      </button>
                    )}
                  </>
                )}
              </div>

              {latestTools.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {latestTools.map((tool) => (
                    <div key={tool.id} className="flex items-start gap-2">
                      <Activity className="mt-0.5 size-3 shrink-0 text-text-tertiary" />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-text-primary">
                          {tool.name}
                        </div>
                        {tool.summary && (
                          <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-text-muted">
                            {tool.summary}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="border-b border-border px-4 py-4">
              <SectionTitle icon={Coins}>
                {t("sessions.operations.usage")}
              </SectionTitle>
              <div className="mt-3">
                <div className="truncate text-[11px] font-medium text-text-primary">
                  {snapshot.modelId ?? t("sessions.operations.defaultModel")}
                </div>
                {operationsQuery.isLoading ? (
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-text-muted">
                    <Loader2 className="size-3 animate-spin" />
                    {t("sessions.operations.checking")}
                  </div>
                ) : operationsQuery.data?.usageAvailable &&
                  operationsQuery.data.usage ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-md bg-surface-1 px-2.5 py-2">
                      <div className="text-[9px] text-text-muted">
                        {t("sessions.operations.tokens")}
                      </div>
                      <div className="mt-0.5 text-[12px] font-semibold text-text-primary">
                        {formatCount(operationsQuery.data.usage.totalTokens)}
                      </div>
                    </div>
                    <div className="rounded-md bg-surface-1 px-2.5 py-2">
                      <div className="text-[9px] text-text-muted">
                        {t("sessions.operations.cost")}
                      </div>
                      <div
                        className={cn(
                          "mt-0.5 text-[12px] font-semibold",
                          operationsQuery.data.usage.missingCostEntries === 0
                            ? "text-text-primary"
                            : "text-text-muted",
                        )}
                        title={
                          operationsQuery.data.usage.missingCostEntries > 0
                            ? t("sessions.operations.costUnavailableHint")
                            : undefined
                        }
                      >
                        {operationsQuery.data.usage.missingCostEntries === 0
                          ? `$${operationsQuery.data.usage.totalCost.toFixed(4)}`
                          : t("sessions.operations.costUnavailable")}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-[10px] text-text-muted">
                    {t("sessions.operations.usageUnavailable")}
                  </div>
                )}
                {contextAvailable && (
                  <div className="mt-3 border-t border-border pt-2.5">
                    <div className="flex items-center justify-between gap-2 text-[9px] text-text-muted">
                      <span>
                        {snapshot.contextFresh
                          ? t("sessions.operations.context")
                          : t("sessions.operations.contextSnapshot")}
                      </span>
                      <span>
                        {formatCount(snapshot.contextUsedTokens ?? 0)} /{" "}
                        {formatCount(snapshot.contextWindowTokens ?? 0)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full bg-[var(--color-brand-primary)]"
                        style={{ width: `${contextPercent}%` }}
                      />
                    </div>
                  </div>
                )}
                {!operationsQuery.isLoading &&
                  (operationsQuery.isError ||
                    operationsQuery.data?.providerUsageAvailable === false) && (
                    <div
                      data-provider-usage-unavailable="true"
                      className="mt-3 flex items-center gap-2 border-t border-border pt-2.5 text-[10px] text-text-muted"
                    >
                      <CircleAlert className="size-3 shrink-0 text-[var(--color-warning)]" />
                      {t("sessions.operations.quotaUnavailable")}
                    </div>
                  )}
                {operationsQuery.data?.providers.map((provider) => (
                  <div
                    key={provider.provider}
                    className="mt-3 border-t border-border pt-2.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate font-medium text-text-primary">
                        {provider.displayName}
                      </span>
                      <span className="text-text-muted">
                        {provider.plan ?? provider.summary}
                      </span>
                    </div>
                    {provider.error ? (
                      <div className="mt-1 text-[9px] text-danger">
                        {provider.error}
                      </div>
                    ) : (
                      provider.windows.map((window) => (
                        <div key={window.label} className="mt-2">
                          <div className="flex items-center justify-between text-[9px] text-text-muted">
                            <span>{window.label}</span>
                            <span>
                              {t("sessions.operations.quotaRemaining", {
                                percent: Math.max(
                                  0,
                                  Math.round(100 - window.usedPercent),
                                ),
                              })}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                            <div
                              className="h-full bg-[var(--color-brand-primary)]"
                              style={{
                                width: `${Math.min(100, Math.max(0, window.usedPercent))}%`,
                              }}
                            />
                          </div>
                          {formatReset(window.resetAt) && (
                            <div className="mt-1 text-right text-[9px] text-text-muted">
                              {t("sessions.operations.resetsAt", {
                                time: formatReset(window.resetAt),
                              })}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="px-4 py-4">
              <SectionTitle icon={LayoutDashboard}>
                {t("sessions.operations.workspace")}
              </SectionTitle>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!snapshot.browserAvailable}
                  onClick={onOpenBrowser}
                  className="flex min-h-[66px] flex-col justify-between rounded-md border border-border p-2.5 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Globe2 className="size-4 text-text-secondary" />
                    {snapshot.browserOwnedByAgent && (
                      <Activity className="size-3 text-[var(--color-success)]" />
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-text-primary">
                      {t("sessions.operations.browser")}
                    </div>
                    <div className="mt-0.5 text-[9px] text-text-muted">
                      {snapshot.browserOpen
                        ? t("sessions.operations.open")
                        : t("sessions.operations.previewCount", {
                            count: snapshot.previewCount,
                          })}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={onOpenCanvas}
                  className="flex min-h-[66px] flex-col justify-between rounded-md border border-border p-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <LayoutDashboard className="size-4 text-text-secondary" />
                  <div>
                    <div className="text-[11px] font-medium text-text-primary">
                      {t("sessions.operations.canvas")}
                    </div>
                    <div className="mt-0.5 text-[9px] text-text-muted">
                      {t("sessions.operations.itemCount", {
                        count: snapshot.canvasCount,
                      })}
                    </div>
                  </div>
                </button>
              </div>
              <div className="mt-3 flex items-center gap-4 text-[10px] text-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <FileOutput className="size-3" />
                  {t("sessions.operations.outputCount", { count: outputCount })}
                </span>
                {snapshot.imageCount > 0 && (
                  <span>
                    {t("sessions.operations.imageCount", {
                      count: snapshot.imageCount,
                    })}
                  </span>
                )}
              </div>
            </section>
          </>
        )}

        {activeTab === "approvals" && (
          <section className="px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle icon={ShieldCheck}>
                {t("sessions.operations.approvals")}
              </SectionTitle>
              {notificationPermission === "default" && (
                <button
                  type="button"
                  onClick={() => {
                    void Notification.requestPermission().then(
                      setNotificationPermission,
                    );
                  }}
                  className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary"
                  aria-label={t("sessions.operations.enableNotifications")}
                  title={t("sessions.operations.enableNotifications")}
                >
                  <Bell className="size-3.5" />
                </button>
              )}
            </div>

            {operationsQuery.isLoading || approvalsLoading ? (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
                <Loader2 className="size-3.5 animate-spin" />
                {t("sessions.operations.checking")}
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                {runtimeApprovalsUnavailable && (
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <StatusDot active={false} warning />
                    {t("sessions.operations.runtimeApprovalsUnavailable")}
                  </div>
                )}
                {teamApprovalsUnavailable && (
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <StatusDot active={false} warning />
                    {t("sessions.operations.approvalsUnavailable")}
                  </div>
                )}
                {approvalsPartial && (
                  <div
                    data-approvals-partial="true"
                    className="flex items-center gap-2 text-[11px] text-[var(--color-warning)]"
                  >
                    <StatusDot active={false} warning />
                    {t("sessions.operations.approvalsPartial")}
                  </div>
                )}
                {runtimeApprovals.length === 0 &&
                teamApprovals.length === 0 &&
                !runtimeApprovalsUnavailable &&
                !teamApprovalsUnavailable &&
                !approvalsPartial ? (
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <Check className="size-3.5 text-[var(--color-success)]" />
                    {t("sessions.operations.noApprovals")}
                  </div>
                ) : (
                  <>
                    {runtimeApprovals.map((approval) => (
                      <div
                        key={approval.id}
                        data-runtime-approval={approval.kind}
                        className="border-l-2 border-[var(--color-warning)] pl-3"
                      >
                        <div className="flex items-center gap-1.5 text-[10px] font-medium text-text-muted">
                          {approval.category === "controlled-terminal" ? (
                            <SquareTerminal className="size-3" />
                          ) : approval.category === "browser" ? (
                            <Globe2 className="size-3" />
                          ) : approval.category === "computer-use" ? (
                            <MonitorCog className="size-3" />
                          ) : (
                            <ShieldCheck className="size-3" />
                          )}
                          {t(approvalLabelKey(approval.category))}
                        </div>
                        <p className="mt-1 break-words text-[11px] font-medium leading-4 text-text-primary">
                          {approval.title}
                        </p>
                        {approval.cwd && (
                          <p className="mt-1 truncate font-mono text-[9px] text-text-muted">
                            {approval.cwd}
                          </p>
                        )}
                        {approval.warning && (
                          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-[var(--color-warning-subtle)] p-2 text-[9px] leading-4 text-[var(--color-warning)]">
                            <CircleAlert className="mt-0.5 size-3 shrink-0" />
                            {approval.warning}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {approval.allowedDecisions.includes("allow-once") && (
                            <button
                              type="button"
                              disabled={resolveRuntimeApproval.isPending}
                              onClick={() =>
                                resolveRuntimeApproval.mutate({
                                  approval,
                                  decision: "allow-once",
                                })
                              }
                              className="rounded-md bg-[var(--color-brand-primary)] px-2.5 py-1.5 text-[10px] font-medium text-white disabled:opacity-50"
                            >
                              {t("sessions.operations.allowOnce")}
                            </button>
                          )}
                          {approval.allowedDecisions.includes(
                            "allow-always",
                          ) && (
                            <button
                              type="button"
                              disabled={resolveRuntimeApproval.isPending}
                              onClick={() =>
                                resolveRuntimeApproval.mutate({
                                  approval,
                                  decision: "allow-always",
                                })
                              }
                              className="rounded-md border border-border px-2.5 py-1.5 text-[10px] font-medium text-text-primary disabled:opacity-50"
                            >
                              {t("sessions.operations.allowAlways")}
                            </button>
                          )}
                          {approval.allowedDecisions.includes("deny") && (
                            <button
                              type="button"
                              disabled={resolveRuntimeApproval.isPending}
                              onClick={() =>
                                resolveRuntimeApproval.mutate({
                                  approval,
                                  decision: "deny",
                                })
                              }
                              className="rounded-md border border-border px-2.5 py-1.5 text-[10px] font-medium text-danger disabled:opacity-50"
                            >
                              {t("sessions.operations.deny")}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {teamApprovals.map((approval) => (
                      <div
                        key={`${approval.runId}:${approval.stepId}`}
                        className="border-l-2 border-[var(--color-warning)] pl-3"
                      >
                        <div className="text-[10px] font-medium text-text-muted">
                          {approval.teamName}
                        </div>
                        <p className="mt-1 line-clamp-3 text-[11px] leading-4 text-text-primary">
                          {approval.prompt}
                        </p>
                        <button
                          type="button"
                          disabled={approveTeamStep.isPending}
                          onClick={() => approveTeamStep.mutate(approval)}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-primary)] px-2.5 py-1.5 text-[10px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {approveTeamStep.isPending ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Check className="size-3" />
                          )}
                          {t("sessions.operations.approve")}
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            <div className="mt-6 border-t border-border pt-4">
              <SectionTitle icon={Clock3}>
                {t("sessions.operations.approvalHistory")}
              </SectionTitle>
              {auditQuery.isLoading ? (
                <div className="mt-3 flex items-center gap-2 text-[10px] text-text-muted">
                  <Loader2 className="size-3 animate-spin" />
                  {t("sessions.operations.checking")}
                </div>
              ) : auditQuery.isError ||
                auditQuery.data?.historyAvailable === false ? (
                <div
                  data-approval-history-unavailable="true"
                  className="mt-3 flex items-center gap-2 text-[10px] text-text-muted"
                >
                  <CircleAlert className="size-3 text-[var(--color-warning)]" />
                  {t("sessions.operations.auditUnavailable")}
                </div>
              ) : auditQuery.data?.approvalHistory.length === 0 ? (
                <div className="mt-3 text-[10px] text-text-muted">
                  {t("sessions.operations.noApprovalHistory")}
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {auditQuery.data?.approvalHistory
                    .slice(0, 20)
                    .map((entry) => (
                      <div
                        key={entry.id}
                        data-approval-history={entry.status}
                        className="border-l border-border pl-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-primary">
                            {entry.title}
                          </span>
                          <span className="shrink-0 text-[9px] text-text-tertiary">
                            {t(
                              `sessions.operations.approvalStatus.${entry.status}`,
                            )}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-text-muted">
                          {entry.decision && (
                            <span>
                              {t(
                                `sessions.operations.approvalDecision.${entry.decision}`,
                              )}
                            </span>
                          )}
                          {entry.reviewer && (
                            <span>
                              {t("sessions.operations.reviewer", {
                                reviewer: entry.reviewer,
                              })}
                            </span>
                          )}
                          <span>
                            {formatTimestamp(
                              entry.resolvedAt ?? entry.requestedAt,
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <SectionTitle icon={Activity}>
                  {t("sessions.operations.runtimeAudit")}
                </SectionTitle>
                <span className="text-[9px] text-text-tertiary">
                  {t("sessions.operations.metadataOnly")}
                </span>
              </div>
              {auditQuery.isLoading ? (
                <div className="mt-3 flex items-center gap-2 text-[10px] text-text-muted">
                  <Loader2 className="size-3 animate-spin" />
                  {t("sessions.operations.checking")}
                </div>
              ) : auditQuery.isError ||
                auditQuery.data?.runtimeAuditAvailable === false ? (
                <div
                  data-runtime-audit-unavailable="true"
                  className="mt-3 flex items-center gap-2 text-[10px] text-text-muted"
                >
                  <CircleAlert className="size-3 text-[var(--color-warning)]" />
                  {t("sessions.operations.auditUnavailable")}
                </div>
              ) : auditQuery.data?.events.length === 0 ? (
                <div className="mt-3 text-[10px] text-text-muted">
                  {t("sessions.operations.noRuntimeAudit")}
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {auditQuery.data?.events.slice(0, 20).map((event) => (
                    <div
                      key={event.eventId}
                      data-runtime-audit-event={event.kind}
                      className="border-l border-border pl-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-primary">
                          {event.toolName ?? event.action}
                        </span>
                        <span className="shrink-0 text-[9px] text-text-tertiary">
                          {event.status}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[9px] text-text-muted">
                        {event.actor.id} · {formatTimestamp(event.occurredAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "recovery" && (
          <section className="px-4 py-4">
            <SectionTitle icon={RotateCcw}>
              {t("sessions.operations.recovery")}
            </SectionTitle>
            {recoveryQuery.isLoading ? (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
                <Loader2 className="size-3.5 animate-spin" />
                {t("sessions.operations.checking")}
              </div>
            ) : recoveryQuery.isError || !recoveryQuery.data ? (
              <div
                data-recovery-unavailable="true"
                className="mt-3 flex items-center gap-2 text-[11px] text-text-muted"
              >
                <CircleAlert className="size-3.5 text-[var(--color-warning)]" />
                {t("sessions.operations.unavailable")}
              </div>
            ) : (
              <div className="mt-4 space-y-6">
                <div>
                  <SectionTitle icon={CircleAlert}>
                    {t("sessions.operations.deadLetters")}
                  </SectionTitle>
                  {!recoveryQuery.data.deadLettersAvailable ? (
                    <div className="mt-3 text-[10px] text-text-muted">
                      {t("sessions.operations.unavailable")}
                    </div>
                  ) : recoveryQuery.data.deadLetters.length === 0 ? (
                    <div className="mt-3 text-[10px] text-text-muted">
                      {t("sessions.operations.noDeadLetters")}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {recoveryQuery.data.deadLetters.map((queue) => (
                        <div
                          key={queue.queueName}
                          data-dead-letter-queue={queue.queueName}
                          className="border-l-2 border-[var(--color-warning)] pl-2.5"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate font-medium text-text-primary">
                              {queue.queueName}
                            </span>
                            <span className="text-text-muted">
                              {formatCount(queue.count)}
                            </span>
                          </div>
                          {queue.oldestFailedAt && (
                            <div className="mt-0.5 text-[9px] text-text-muted">
                              {t("sessions.operations.oldestFailure")}:{" "}
                              {formatTimestamp(queue.oldestFailedAt)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {!recoveryQuery.data.deadLetterReplayAvailable && (
                    <div
                      data-dead-letter-replay-unavailable="true"
                      className="mt-3 flex items-start gap-1.5 text-[9px] leading-4 text-text-muted"
                    >
                      <CircleAlert className="mt-0.5 size-3 shrink-0" />
                      {t("sessions.operations.deadLetterReplayUnavailable")}
                    </div>
                  )}
                </div>

                <div className="border-t border-border pt-4">
                  <SectionTitle icon={ShieldCheck}>
                    {t("sessions.operations.quarantined")}
                  </SectionTitle>
                  {!recoveryQuery.data.stateIsolationAvailable ? (
                    <div className="mt-3 text-[10px] text-text-muted">
                      {t("sessions.operations.unavailable")}
                    </div>
                  ) : recoveryQuery.data.quarantined.length === 0 ? (
                    <div className="mt-3 text-[10px] text-text-muted">
                      {t("sessions.operations.noQuarantined")}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {recoveryQuery.data.quarantined.map((item) => (
                        <div
                          key={`${item.engineId}:${item.failedAt}`}
                          data-quarantined-engine={item.engineId}
                          className="border-l-2 border-danger pl-2.5"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate font-medium text-text-primary">
                              {item.engineId}
                            </span>
                            <span className="text-[9px] text-text-tertiary">
                              {item.operation}
                            </span>
                          </div>
                          <div className="mt-0.5 break-words text-[9px] leading-4 text-text-muted">
                            {item.reason}
                          </div>
                          <div className="mt-0.5 text-[9px] text-text-tertiary">
                            {formatTimestamp(item.failedAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!recoveryQuery.data.quarantineClearAvailable && (
                    <div
                      data-quarantine-clear-unavailable="true"
                      className="mt-3 flex items-start gap-1.5 text-[9px] leading-4 text-text-muted"
                    >
                      <CircleAlert className="mt-0.5 size-3 shrink-0" />
                      {t("sessions.operations.quarantineClearUnavailable")}
                    </div>
                  )}
                </div>

                <div className="border-t border-border pt-4">
                  <SectionTitle icon={GitBranch}>
                    {t("sessions.operations.checkpoints")}
                  </SectionTitle>
                  {!recoveryQuery.data.snapshotsAvailable ? (
                    <div
                      data-snapshots-unavailable="true"
                      className="mt-3 text-[10px] text-text-muted"
                    >
                      {t("sessions.operations.snapshotsUnavailable")}
                    </div>
                  ) : recoveryQuery.data.checkpoints.length === 0 ? (
                    <div className="mt-3 text-[10px] text-text-muted">
                      {t("sessions.operations.noCheckpoints")}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {recoveryQuery.data.checkpoints.map((checkpoint) => (
                        <div
                          key={checkpoint.checkpointId}
                          data-recovery-checkpoint={checkpoint.checkpointId}
                          className="border-l border-border pl-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[11px] font-medium text-text-primary">
                                {checkpoint.summary ?? checkpoint.reason}
                              </div>
                              <div className="mt-0.5 text-[9px] text-text-muted">
                                {formatTimestamp(checkpoint.createdAt)}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={restoreCheckpoint.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    t("sessions.operations.restoreConfirm"),
                                  )
                                ) {
                                  restoreCheckpoint.mutate(checkpoint);
                                }
                              }}
                              className="shrink-0 rounded-md border border-border px-2 py-1 text-[9px] font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-50"
                            >
                              {restoreCheckpoint.isPending ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                t("sessions.operations.restoreCheckpoint")
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "health" && (
          <section className="px-4 py-4">
            <SectionTitle icon={Gauge}>
              {t("sessions.operations.health")}
            </SectionTitle>
            <div className="mt-3 space-y-3">
              <HealthRow
                label={t("sessions.operations.controller")}
                status={
                  runtimeError
                    ? t("sessions.operations.unavailable")
                    : runtimeLoading
                      ? t("sessions.operations.checking")
                      : (runtime?.status ??
                        t("sessions.operations.unavailable"))
                }
                active={runtimeHealthy}
                warning={runtimeWarning}
                actionLabel={t("sessions.operations.viewLogs")}
                actionBusy={hostAction === "controller-log"}
                onAction={() => {
                  void runHostAction("controller-log", () =>
                    requestDesktopHost("runtime:show-log-file", {
                      id: "controller",
                    }),
                  );
                }}
              />
              <HealthRow
                label={t("sessions.operations.runtime")}
                status={
                  operationsQuery.isError
                    ? t("sessions.operations.unavailable")
                    : operationsQuery.isLoading
                      ? t("sessions.operations.checking")
                      : operationsQuery.data?.connected
                        ? t("sessions.operations.connected")
                        : t("sessions.operations.disconnected")
                }
                active={operationsQuery.data?.connected === true}
                warning={operationsQuery.isError}
                actionLabel={t("sessions.operations.restart")}
                actionBusy={hostAction === "openclaw-restart"}
                onAction={() => {
                  void runHostAction("openclaw-restart", async () => {
                    const stopped = await requestDesktopHost(
                      "runtime:stop-unit",
                      { id: "openclaw" },
                    );
                    if (stopped === undefined) return undefined;
                    return requestDesktopHost("runtime:start-unit", {
                      id: "openclaw",
                    });
                  });
                }}
              />
              <HealthRow
                label={t("sessions.operations.channels")}
                status={
                  channelsQuery.isError
                    ? t("sessions.operations.unavailable")
                    : channelsQuery.isLoading
                      ? t("sessions.operations.checking")
                      : (channelSummary ?? "0/0")
                }
                active={channelsQuery.data?.gatewayConnected === true}
                warning={channelsQuery.data?.gatewaySafeMode === true}
                href="/workspace/channels"
              />
              <HealthRow
                label={t("sessions.operations.browser")}
                status={
                  runtimeConfigQuery.isError
                    ? t("sessions.operations.unavailable")
                    : runtimeConfigQuery.isLoading
                      ? t("sessions.operations.checking")
                      : runtimeConfigQuery.data?.localAutomation.browser
                            ?.enabled
                        ? t("sessions.operations.enabled")
                        : t("sessions.operations.disabled")
                }
                active={
                  runtimeConfigQuery.data?.localAutomation.browser?.enabled ===
                  true
                }
                actionLabel={t("sessions.operations.open")}
                onAction={onOpenBrowser}
              />
              <HealthRow
                label={t("sessions.operations.computerUse")}
                status={
                  computerUseStatus ?? t("sessions.operations.unavailable")
                }
                active={computerUseStatus === "ready"}
                warning={computerUseStatus === "permission-required"}
                actionLabel={
                  computerUseStatus === "permission-required"
                    ? t("sessions.operations.requestPermission")
                    : undefined
                }
                actionBusy={hostAction === "permissions"}
                onAction={
                  computerUseStatus === "permission-required"
                    ? () => {
                        void runHostAction("permissions", async () => {
                          const { data, error } =
                            await postApiV1RuntimeConfigLocalAutomationComputerUsePermissions();
                          if (error || !data) return undefined;
                          return data;
                        });
                      }
                    : undefined
                }
              />
              <HealthRow
                label={t("sessions.operations.modelAuth")}
                status={
                  operationsQuery.isError
                    ? t("sessions.operations.unavailable")
                    : operationsQuery.isLoading
                      ? t("sessions.operations.checking")
                      : operationsQuery.data?.modelAuth.status === "ready"
                        ? t("sessions.operations.available")
                        : operationsQuery.data?.modelAuth.status ===
                            "unavailable"
                          ? t("sessions.operations.unavailable")
                          : t("sessions.operations.needsAttention")
                }
                active={operationsQuery.data?.modelAuth.status === "ready"}
                warning={
                  operationsQuery.data?.modelAuth.status === "needs-attention"
                }
                href="/workspace/settings/models"
              />
            </div>
            <button
              type="button"
              disabled={hostAction === "diagnostics"}
              onClick={() => {
                void runHostAction("diagnostics", () =>
                  requestDesktopHost("diagnostics:export", {
                    source: "diagnostics-page",
                  }),
                );
              }}
              className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {hostAction === "diagnostics" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileOutput className="size-3.5" />
              )}
              {t("sessions.operations.exportDiagnostics")}
            </button>
            <Link
              to="/workspace/settings"
              className="mt-3 flex items-center justify-between text-[11px] font-medium text-[var(--color-brand-primary)] hover:underline"
            >
              <span>{t("sessions.operations.openSettings")}</span>
              <ChevronRight className="size-3.5" />
            </Link>
          </section>
        )}
      </div>
    </aside>
  );
}

function HealthRow({
  label,
  status,
  active,
  warning = false,
  actionLabel,
  actionBusy = false,
  onAction,
  href,
}: {
  label: string;
  status: string;
  active: boolean;
  warning?: boolean;
  actionLabel?: string;
  actionBusy?: boolean;
  onAction?: () => void;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-text-secondary">
          <StatusDot active={active} warning={warning} />
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-0.5 truncate pl-4 text-[9px] text-text-muted">
          {status}
        </div>
      </div>
      {href ? (
        <Link
          to={href}
          className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary"
          aria-label={actionLabel ?? label}
          title={actionLabel ?? label}
        >
          <ChevronRight className="size-3.5" />
        </Link>
      ) : actionLabel && onAction ? (
        <button
          type="button"
          disabled={actionBusy}
          onClick={onAction}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[9px] font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-50"
        >
          {actionBusy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : actionLabel === "Restart" ? (
            <RefreshCcw className="size-3" />
          ) : (
            actionLabel
          )}
        </button>
      ) : null}
    </div>
  );
}
