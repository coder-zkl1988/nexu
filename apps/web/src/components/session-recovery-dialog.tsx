import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, History, LoaderCircle, Play, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getApiV1SessionsByIdCheckpoints,
  postApiV1SessionsByIdCheckpointsByCheckpointIdBranch,
} from "../../lib/api/sdk.gen";

interface RecoverySession {
  id: string;
  title: string;
}

interface SessionRecoveryDialogProps {
  session: RecoverySession;
  onClose: () => void;
  onContinue: (sessionId: string) => void;
  onRecovered: (sessionId: string) => void;
}

export function formatCheckpointTime(value: string, locale: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

export function SessionRecoveryDialog({
  session,
  onClose,
  onContinue,
  onRecovered,
}: SessionRecoveryDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const checkpointsQuery = useQuery({
    queryKey: ["session-checkpoints", session.id],
    queryFn: async () => {
      const { data, error } = await getApiV1SessionsByIdCheckpoints({
        path: { id: session.id },
      });
      if (error) {
        throw new Error(
          (error as { message?: string }).message ??
            t("layout.recoveryLoadFailed"),
        );
      }
      return data?.checkpoints ?? [];
    },
  });
  const branchMutation = useMutation({
    mutationFn: async (checkpointId: string) => {
      const { data, error } =
        await postApiV1SessionsByIdCheckpointsByCheckpointIdBranch({
          path: { id: session.id, checkpointId },
        });
      if (error || !data?.id) {
        throw new Error(
          (error as { message?: string } | undefined)?.message ??
            t("layout.recoveryBranchFailed"),
        );
      }
      return data;
    },
    onSuccess: (recovered) => {
      queryClient.invalidateQueries({ queryKey: ["sidebar-sessions"] });
      onRecovered(recovered.id);
    },
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={onClose}
    >
      <dialog
        open
        aria-labelledby="session-recovery-title"
        className="relative m-0 flex max-h-[min(620px,85vh)] w-full max-w-md flex-col rounded-lg border border-border bg-surface-0 p-0 text-left shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div
              id="session-recovery-title"
              className="text-[13px] font-semibold text-text-primary"
            >
              {t("layout.recoverSession")}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-text-muted">
              {session.title}
            </div>
          </div>
          <button
            type="button"
            aria-label={t("modal.close")}
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text-primary"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-border p-3">
          <button
            type="button"
            onClick={() => onContinue(session.id)}
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-text-primary hover:bg-surface-2"
          >
            <Play className="size-4 shrink-0 text-[var(--color-brand-primary)]" />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">
                {t("layout.continueCurrentSession")}
              </span>
              <span className="block text-[10px] text-text-muted">
                {t("layout.currentSession")}
              </span>
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase text-text-muted">
            <History className="size-3" />
            {t("layout.recoveryCheckpoints")}
          </div>
          {checkpointsQuery.isLoading && (
            <div className="flex items-center justify-center py-8 text-text-muted">
              <LoaderCircle className="size-4 animate-spin" />
            </div>
          )}
          {checkpointsQuery.error && (
            <div className="px-2 py-6 text-center text-[11px] text-danger">
              {checkpointsQuery.error instanceof Error
                ? checkpointsQuery.error.message
                : t("layout.recoveryLoadFailed")}
            </div>
          )}
          {!checkpointsQuery.isLoading &&
            !checkpointsQuery.error &&
            checkpointsQuery.data?.length === 0 && (
              <div className="px-2 py-6 text-center text-[11px] text-text-muted">
                {t("layout.noRecoveryCheckpoints")}
              </div>
            )}
          <div className="space-y-1">
            {checkpointsQuery.data?.map((checkpoint) => (
              <button
                key={checkpoint.id}
                type="button"
                disabled={branchMutation.isPending}
                onClick={() => branchMutation.mutate(checkpoint.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-surface-2 disabled:opacity-50",
                  branchMutation.variables === checkpoint.id && "bg-surface-2",
                )}
              >
                {branchMutation.isPending &&
                branchMutation.variables === checkpoint.id ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-text-muted" />
                ) : (
                  <GitBranch className="size-4 shrink-0 text-text-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-text-primary">
                    {formatCheckpointTime(checkpoint.createdAt, i18n.language)}
                  </span>
                  <span className="block truncate text-[10px] text-text-muted">
                    {checkpoint.summary ||
                      t(`layout.checkpointReason.${checkpoint.reason}`)}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] font-medium text-[var(--color-brand-primary)]">
                  {t("layout.createRecoveryBranch")}
                </span>
              </button>
            ))}
          </div>
          {branchMutation.error && (
            <div className="mt-2 px-2 text-[11px] text-danger">
              {branchMutation.error instanceof Error
                ? branchMutation.error.message
                : t("layout.recoveryBranchFailed")}
            </div>
          )}
        </div>
      </dialog>
    </div>
  );
}
