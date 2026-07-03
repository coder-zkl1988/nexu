import { pinTeamRunToCanvas } from "@/lib/canvas/team-step-node";
import {
  exportRunMarkdown,
  parseTeamRunInfo,
  useRunApprovals,
  useTeamRunStatus,
} from "./TeamRunPanel";
import type { CustomComponentProps } from "./registry";

function statusDotClass(status: string | undefined): string {
  switch (status) {
    case "done":
      return "bg-emerald-500";
    case "running":
      return "bg-sky-500 animate-pulse";
    case "blocked":
      return "bg-amber-500";
    default:
      return "bg-border";
  }
}

/**
 * In-chat run snapshot card. Rendered from a team_run_auto /
 * team_run_workflow tool result; polls the board itself for step lighting,
 * shows approval buttons inline (straight REST — the model is not involved),
 * and opens the full DAG panel in the workspace sidebar.
 */
export function TeamRunCard({ comp, resolve }: CustomComponentProps) {
  const run = parseTeamRunInfo(resolve((comp as { run?: unknown }).run));
  const { cardsById, statusByStepId, allDone, anyBlocked } =
    useTeamRunStatus(run);
  const { pending, approve } = useRunApprovals(run, !allDone);

  if (!run) return null;

  const lastStep = run.steps[run.steps.length - 1];
  const finalOutput = lastStep ? cardsById.get(lastStep.cardId)?.output : null;

  return (
    <div
      className="flex w-[320px] flex-col gap-2 rounded-lg border border-border bg-surface-1 p-3"
      data-team-run-card={run.parentCardId}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{run.title}</div>
          <div className="text-[11px] text-text-secondary">
            {allDone
              ? "✅ 已完成"
              : anyBlocked && pending.length === 0
                ? "⚠️ 有步骤受阻"
                : pending.length > 0
                  ? "⏸ 等待审批"
                  : "⏳ 团队执行中…"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => pinTeamRunToCanvas(run)}
          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-surface-2"
        >
          查看详情
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {run.steps.map((step) => (
          <div
            key={step.id}
            data-run-step={step.id}
            data-run-step-status={statusByStepId[step.id] ?? "pending"}
            className="flex items-center gap-2 text-[12px]"
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(statusByStepId[step.id])}`}
            />
            <span className="min-w-0 flex-1 truncate">
              {step.type === "approval" ? "⏸ " : ""}
              {step.name}
            </span>
            <span className="shrink-0 text-[11px] text-text-secondary">
              {step.assigneeName}
            </span>
          </div>
        ))}
      </div>

      {pending.map((approval) => (
        <div
          key={`${approval.runId}:${approval.stepId}`}
          className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5"
        >
          <span className="min-w-0 flex-1 truncate text-[11px]">
            {approval.prompt.slice(0, 60)}
          </span>
          <button
            type="button"
            disabled={approve.isPending}
            onClick={() =>
              approve.mutate({
                teamId: approval.teamId,
                workflowId: approval.workflowId,
                runId: approval.runId,
                stepId: approval.stepId,
              })
            }
            className="shrink-0 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)] px-2 py-0.5 text-[11px] font-bold text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
          >
            {approve.isPending ? "批准中…" : "批准"}
          </button>
        </div>
      ))}

      {allDone && finalOutput ? (
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <pre className="max-h-24 overflow-hidden whitespace-pre-wrap text-[11px] text-text-secondary">
            {finalOutput.slice(0, 160)}
            {finalOutput.length > 160 ? "…" : ""}
          </pre>
          <button
            type="button"
            onClick={() => exportRunMarkdown(run, cardsById)}
            className="self-start rounded-md border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-surface-2"
          >
            导出 Markdown
          </button>
        </div>
      ) : null}
    </div>
  );
}
