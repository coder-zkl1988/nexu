import { cn } from "@/lib/utils";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  Activity,
  Check,
  CircleAlert,
  Clock3,
  Coins,
  FileOutput,
  GitBranch,
  Globe2,
  LayoutDashboard,
  Loader2,
  RefreshCcw,
  RotateCcw,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GetApiV1RuntimeOperationsResponse } from "../../../lib/api/types.gen";
import {
  TASK_GRAPH_PREVIEW_LIMIT,
  formatCount,
  formatDuration,
  formatReset,
  orderTaskGraph,
  selectActiveTasks,
  taskTone,
  timestampToMs,
} from "./formatting";
import { SectionTitle, StatusDot } from "./panel-atoms";
import type { SessionOperationSnapshot, TaskGraphNode } from "./types";

interface RunTabProps {
  snapshot: SessionOperationSnapshot;
  now: number;
  operationsQuery: UseQueryResult<GetApiV1RuntimeOperationsResponse, Error>;
  taskGraphExpanded: boolean;
  onToggleTaskGraph: () => void;
  onCancelTask: (task: TaskGraphNode) => void;
  cancelTaskPending: boolean;
  onStop: () => void;
  onRetry?: () => void;
  onOpenBrowser: () => void;
  onOpenCanvas: () => void;
}

export function RunTab({
  snapshot,
  now,
  operationsQuery,
  taskGraphExpanded,
  onToggleTaskGraph,
  onCancelTask,
  cancelTaskPending,
  onStop,
  onRetry,
  onOpenBrowser,
  onOpenCanvas,
}: RunTabProps) {
  const { t } = useTranslation();

  const tasks = operationsQuery.data?.tasks ?? [];
  const activeTask = selectActiveTasks(tasks)[0];
  const runStartedAt =
    timestampToMs(activeTask?.startedAt) ?? snapshot.startedAt;
  const elapsed = runStartedAt ? formatDuration(now - runStartedAt) : null;
  const taskStatusChecking =
    !snapshot.busy && !activeTask && operationsQuery.isLoading;
  const taskStatusUnavailable =
    !snapshot.busy &&
    !activeTask &&
    (operationsQuery.isError || operationsQuery.data?.tasksAvailable === false);

  const taskGraph = operationsQuery.data?.taskGraph;
  const orderedTaskGraph = useMemo(
    () => (taskGraph ? orderTaskGraph(taskGraph) : []),
    [taskGraph],
  );
  const taskGraphRemainingCount = Math.max(
    0,
    orderedTaskGraph.length - TASK_GRAPH_PREVIEW_LIMIT,
  );
  const visibleTaskGraph = taskGraphExpanded
    ? orderedTaskGraph
    : orderedTaskGraph.slice(0, TASK_GRAPH_PREVIEW_LIMIT);

  const latestTools = snapshot.tools.slice(-5).reverse();
  const outputCount = snapshot.fileCount + snapshot.imageCount;
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
          ) : operationsQuery.isError || !taskGraph || !taskGraph.available ? (
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
                (!taskGraph.sources.openclaw || !taskGraph.sources.team) && (
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
                        {t(`sessions.operations.lifecycle.${node.lifecycle}`)}
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
                          disabled={cancelTaskPending}
                          onClick={() => onCancelTask(node)}
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
                  onClick={onToggleTaskGraph}
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
  );
}
