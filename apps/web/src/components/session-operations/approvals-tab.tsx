import type { UseQueryResult } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  Check,
  CircleAlert,
  Clock3,
  Globe2,
  Loader2,
  MonitorCog,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetApiV1RuntimeAuditResponse } from "../../../lib/api/types.gen";
import { approvalLabelKey, formatTimestamp } from "./formatting";
import { SectionTitle, StatusDot } from "./panel-atoms";
import type {
  ApprovalDecision,
  PendingApprovalView,
  RuntimeApproval,
} from "./types";

interface ApprovalsTabProps {
  operationsLoading: boolean;
  approvalsLoading: boolean;
  runtimeApprovals: RuntimeApproval[];
  teamApprovals: PendingApprovalView[];
  runtimeApprovalsUnavailable: boolean;
  teamApprovalsUnavailable: boolean;
  approvalsPartial: boolean;
  auditQuery: UseQueryResult<GetApiV1RuntimeAuditResponse, Error>;
  canEnableNotifications: boolean;
  onEnableNotifications: () => void;
  onResolveRuntimeApproval: (
    approval: RuntimeApproval,
    decision: ApprovalDecision,
  ) => void;
  resolveRuntimeApprovalPending: boolean;
  onApproveTeamStep: (approval: PendingApprovalView) => void;
  approveTeamStepPending: boolean;
}

export function ApprovalsTab({
  operationsLoading,
  approvalsLoading,
  runtimeApprovals,
  teamApprovals,
  runtimeApprovalsUnavailable,
  teamApprovalsUnavailable,
  approvalsPartial,
  auditQuery,
  canEnableNotifications,
  onEnableNotifications,
  onResolveRuntimeApproval,
  resolveRuntimeApprovalPending,
  onApproveTeamStep,
  approveTeamStepPending,
}: ApprovalsTabProps) {
  const { t } = useTranslation();

  return (
    <section className="px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle icon={ShieldCheck}>
          {t("sessions.operations.approvals")}
        </SectionTitle>
        {canEnableNotifications && (
          <button
            type="button"
            onClick={onEnableNotifications}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary"
            aria-label={t("sessions.operations.enableNotifications")}
            title={t("sessions.operations.enableNotifications")}
          >
            <Bell className="size-3.5" />
          </button>
        )}
      </div>

      {operationsLoading || approvalsLoading ? (
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
                        disabled={resolveRuntimeApprovalPending}
                        onClick={() =>
                          onResolveRuntimeApproval(approval, "allow-once")
                        }
                        className="rounded-md bg-[var(--color-brand-primary)] px-2.5 py-1.5 text-[10px] font-medium text-white disabled:opacity-50"
                      >
                        {t("sessions.operations.allowOnce")}
                      </button>
                    )}
                    {approval.allowedDecisions.includes("allow-always") && (
                      <button
                        type="button"
                        disabled={resolveRuntimeApprovalPending}
                        onClick={() =>
                          onResolveRuntimeApproval(approval, "allow-always")
                        }
                        className="rounded-md border border-border px-2.5 py-1.5 text-[10px] font-medium text-text-primary disabled:opacity-50"
                      >
                        {t("sessions.operations.allowAlways")}
                      </button>
                    )}
                    {approval.allowedDecisions.includes("deny") && (
                      <button
                        type="button"
                        disabled={resolveRuntimeApprovalPending}
                        onClick={() =>
                          onResolveRuntimeApproval(approval, "deny")
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
                    disabled={approveTeamStepPending}
                    onClick={() => onApproveTeamStep(approval)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-primary)] px-2.5 py-1.5 text-[10px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {approveTeamStepPending ? (
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
            {auditQuery.data?.approvalHistory.slice(0, 20).map((entry) => (
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
                    {t(`sessions.operations.approvalStatus.${entry.status}`)}
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
                    {formatTimestamp(entry.resolvedAt ?? entry.requestedAt)}
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
  );
}
