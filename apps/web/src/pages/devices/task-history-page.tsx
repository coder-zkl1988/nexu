import { formatChannelConnectErrorMessage } from "@/lib/channel-connect-errors";
import type { DeviceTaskHistoryEntry } from "@nexu/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getApiV1DevicesTasks } from "../../../lib/api/sdk.gen";

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

export function DeviceTaskHistoryPage() {
  const [entries, setEntries] = useState<DeviceTaskHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
              "Failed to load history",
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
  }, []);

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8 mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-text-primary">
            Device task history
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            Last 200 tasks dispatched via the device control plugin
          </p>
        </div>
        <Link
          to="/workspace/devices"
          className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
        >
          ← Back to devices
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
          No tasks dispatched yet.
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface-1 overflow-hidden">
          {entries.map((entry) => (
            <Link
              key={entry.taskId}
              to={`/workspace/devices/tasks/${entry.taskId}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors"
            >
              <span
                className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                  entry.result.success ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text-primary truncate">
                  {entry.task}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5 flex items-center gap-2">
                  <span>{entry.deviceId}</span>
                  <span>·</span>
                  <span>{new Date(entry.completedAt).toLocaleString()}</span>
                  <span>·</span>
                  <span>{formatDuration(entry.result.duration)}</span>
                  {entry.result.totalSteps !== undefined && (
                    <>
                      <span>·</span>
                      <span>{entry.result.totalSteps} steps</span>
                    </>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
