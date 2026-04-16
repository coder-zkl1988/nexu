import { formatChannelConnectErrorMessage } from "@/lib/channel-connect-errors";
import type { DeviceTaskHistoryEntry } from "@nexu/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getApiV1DevicesTasksByTaskId } from "../../../lib/api/sdk.gen";

export function DeviceTaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [entry, setEntry] = useState<DeviceTaskHistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    setLoading(true);
    setEntry(null);
    setError(null);
    (async () => {
      try {
        const res = await getApiV1DevicesTasksByTaskId({
          path: { taskId: id },
        });
        if (cancelled) return;
        if (res.error) {
          setError(
            formatChannelConnectErrorMessage(res.error, "Task not found"),
          );
        } else {
          setEntry(res.data ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8 mx-auto max-w-4xl">
      <div className="mb-6">
        <Link
          to="/workspace/devices/tasks"
          className="text-[12px] text-text-secondary hover:text-text-primary"
        >
          ← Back to history
        </Link>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {!loading && (error || entry === null) && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] text-red-600">
          {error ?? "Task not found"}
        </div>
      )}

      {entry && (
        <div className="flex flex-col gap-6">
          <div>
            <div className="text-[13px] text-text-muted mb-1">Task</div>
            <div className="text-[15px] font-medium text-text-primary">
              {entry.task}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[12px]">
            <div>
              <div className="text-text-muted">Device</div>
              <div className="text-text-primary mt-0.5 truncate">
                {entry.deviceId}
              </div>
            </div>
            <div>
              <div className="text-text-muted">Status</div>
              <div
                className={`mt-0.5 font-medium ${
                  entry.result.success ? "text-green-600" : "text-red-600"
                }`}
              >
                {entry.result.success ? "Success" : "Failed"}
              </div>
            </div>
            <div>
              <div className="text-text-muted">Duration</div>
              <div className="text-text-primary mt-0.5">
                {entry.result.duration !== undefined
                  ? `${(entry.result.duration / 1000).toFixed(1)}s`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-text-muted">Steps</div>
              <div className="text-text-primary mt-0.5">
                {entry.result.totalSteps ?? "—"}
              </div>
            </div>
          </div>

          {entry.result.message && (
            <div>
              <div className="text-[13px] text-text-muted mb-1">Message</div>
              <div className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] text-text-primary whitespace-pre-wrap">
                {entry.result.message}
              </div>
            </div>
          )}

          {entry.result.steps && entry.result.steps.length > 0 && (
            <div>
              <div className="text-[13px] text-text-muted mb-2">Steps</div>
              <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface-1 overflow-hidden">
                {entry.result.steps.map((step) => (
                  <div
                    key={step.step}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <span
                      className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                        step.success ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-text-primary">
                        <span className="text-text-muted mr-2">
                          #{step.step}
                        </span>
                        {step.action}
                        {step.target && (
                          <span className="text-text-muted ml-1">
                            → {step.target}
                          </span>
                        )}
                      </div>
                      {step.error && (
                        <div className="text-[11px] text-red-600 mt-0.5">
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
              <div className="text-[13px] text-text-muted mb-2">
                Final screenshot
              </div>
              <img
                src={`data:image/png;base64,${entry.result.finalScreenshot}`}
                alt="Final screen"
                className="max-w-[320px] rounded-lg border border-border"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
