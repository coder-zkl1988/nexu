import type { UseQueryResult } from "@tanstack/react-query";
import {
  CircleAlert,
  GitBranch,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetApiV1RuntimeRecoveryResponse } from "../../../lib/api/types.gen";
import { formatCount, formatTimestamp } from "./formatting";
import { SectionTitle } from "./panel-atoms";
import type { RecoveryCheckpoint } from "./types";

interface RecoveryTabProps {
  recoveryQuery: UseQueryResult<GetApiV1RuntimeRecoveryResponse, Error>;
  onRestoreCheckpoint: (checkpoint: RecoveryCheckpoint) => void;
  restoreCheckpointPending: boolean;
}

export function RecoveryTab({
  recoveryQuery,
  onRestoreCheckpoint,
  restoreCheckpointPending,
}: RecoveryTabProps) {
  const { t } = useTranslation();

  return (
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
                        disabled={restoreCheckpointPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              t("sessions.operations.restoreConfirm"),
                            )
                          ) {
                            onRestoreCheckpoint(checkpoint);
                          }
                        }}
                        className="shrink-0 rounded-md border border-border px-2 py-1 text-[9px] font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-50"
                      >
                        {restoreCheckpointPending ? (
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
  );
}
