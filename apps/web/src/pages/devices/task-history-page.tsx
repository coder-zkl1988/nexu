import { formatChannelConnectErrorMessage } from "@/lib/channel-connect-errors";
import type { DeviceTaskHistoryEntry } from "@nexu/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getApiV1DevicesTasks } from "../../../lib/api/sdk.gen";

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

export function DeviceTaskHistoryPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<DeviceTaskHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getApiV1DevicesTasks();
        if (cancelled) return;
        if (res.error) {
          setError(
            formatChannelConnectErrorMessage(
              res.error,
              t("devices.taskHistory.loadError"),
            ),
          );
        } else {
          setEntries(res.data?.entries ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const renderDetail = (entry: DeviceTaskHistoryEntry) => (
    <div className="px-4 pb-4 pt-1 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
        <div>
          <div className="text-text-muted">
            {t("devices.taskDetail.device")}
          </div>
          <div className="text-text-primary mt-0.5 truncate">
            {entry.deviceName || entry.deviceId}
          </div>
        </div>
        <div>
          <div className="text-text-muted">
            {t("devices.taskDetail.status")}
          </div>
          <div
            className={`mt-0.5 font-medium ${entry.result.success ? "text-green-600" : "text-red-600"}`}
          >
            {entry.result.success
              ? t("devices.taskDetail.success")
              : t("devices.taskDetail.failed")}
          </div>
        </div>
        <div>
          <div className="text-text-muted">
            {t("devices.taskDetail.duration")}
          </div>
          <div className="text-text-primary mt-0.5">
            {entry.result.duration !== undefined
              ? `${(entry.result.duration / 1000).toFixed(1)}s`
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-text-muted">{t("devices.taskDetail.steps")}</div>
          <div className="text-text-primary mt-0.5">
            {entry.result.totalSteps ?? "—"}
          </div>
        </div>
      </div>

      {entry.result.message && (
        <div>
          <div className="text-[12px] text-text-muted mb-1">
            {t("devices.taskDetail.message")}
          </div>
          <div className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-[12px] text-text-primary whitespace-pre-wrap max-h-48 overflow-y-auto">
            {entry.result.message}
          </div>
        </div>
      )}

      {entry.result.steps && entry.result.steps.length > 0 && (
        <div>
          <div className="text-[12px] text-text-muted mb-1">
            {t("devices.taskDetail.steps")}
          </div>
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
            {entry.result.steps.map((step) => (
              <div key={step.step} className="flex items-start gap-2 px-3 py-2">
                <span
                  className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${step.success ? "bg-green-500" : "bg-red-500"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-text-primary">
                    <span className="text-text-muted mr-1.5">#{step.step}</span>
                    {step.action}
                    {step.target && (
                      <span className="text-text-muted ml-1">
                        → {step.target}
                      </span>
                    )}
                  </div>
                  {step.error && (
                    <div className="text-[10px] text-red-600 mt-0.5">
                      {step.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {entry.result.finalScreenshot && (
        <div>
          <div className="text-[12px] text-text-muted mb-1">
            {t("devices.taskDetail.finalScreenshot")}
          </div>
          <img
            src={entry.result.finalScreenshot}
            alt={t("devices.taskDetail.finalScreenshot")}
            className="max-w-[260px] rounded-lg border border-border"
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8 mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-text-primary">
            {t("devices.taskHistory.title")}
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            {t("devices.taskHistory.subtitle")}
          </p>
        </div>
        <Link
          to="/workspace/devices"
          className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
        >
          {t("devices.taskHistory.backToDevices")}
        </Link>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] text-red-600">
          {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-[13px] text-text-muted">
          {t("devices.taskHistory.empty")}
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface-1 overflow-hidden">
          {entries.map((entry) => {
            const isExpanded = expandedId === entry.taskId;
            return (
              <div key={entry.taskId}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : entry.taskId)
                  }
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left"
                >
                  <span
                    className={`mt-1 w-2 h-2 rounded-full shrink-0 ${entry.result.success ? "bg-green-500" : "bg-red-500"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-text-primary truncate">
                      {entry.task}
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5 flex items-center gap-2">
                      <span>{entry.deviceName || entry.deviceId}</span>
                      <span>·</span>
                      <span>
                        {new Date(entry.completedAt).toLocaleString()}
                      </span>
                      <span>·</span>
                      <span>{formatDuration(entry.result.duration)}</span>
                      {entry.result.totalSteps !== undefined && (
                        <>
                          <span>·</span>
                          <span>
                            {entry.result.totalSteps}{" "}
                            {t("devices.taskDetail.steps")}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="mt-1 shrink-0 text-text-muted">
                    {isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>
                </button>
                {isExpanded && renderDetail(entry)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
