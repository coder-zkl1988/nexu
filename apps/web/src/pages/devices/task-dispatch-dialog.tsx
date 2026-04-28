import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { postApiV1DevicesByDeviceIdTasks } from "../../../lib/api/sdk.gen";
import type { DeviceInfo } from "./device-card";

export function TaskDispatchDialog({
  device,
  open,
  onClose,
  onSuccess,
}: {
  device: DeviceInfo;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [task, setTask] = useState("");
  const [maxSteps, setMaxSteps] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;

    setLoading(true);
    setError(null);

    // Close dialog immediately, dispatch in background
    const taskText = task.trim();
    const steps = maxSteps;
    setTask("");
    setMaxSteps(30);
    onClose();

    try {
      const { error: apiError } = await postApiV1DevicesByDeviceIdTasks({
        path: { deviceId: device.deviceId },
        body: { task: taskText, maxSteps: steps },
      });

      if (apiError) {
        throw new Error(
          typeof apiError === "object" &&
            apiError !== null &&
            "message" in apiError
            ? String((apiError as { message: unknown }).message)
            : t("devices.taskDispatch.errorFallback"),
        );
      }

      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("devices.taskDispatch.errorFallback"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget && !loading) {
      onClose();
    }
  };

  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4 m-0 max-w-none max-h-none w-full h-full border-none bg-transparent"
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !loading) onClose();
      }}
    >
      <div
        className="w-full max-w-[480px] rounded-2xl border border-border bg-surface-1 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <div
            id={titleId}
            className="text-[14px] font-semibold text-text-primary"
          >
            {t("devices.taskDispatch.title")}
          </div>
          <div className="text-[12px] text-text-muted mt-0.5 truncate">
            {device.name || device.deviceId}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="task-input"
              className="text-[12px] font-medium text-text-secondary"
            >
              {t("devices.taskDispatch.taskLabel")}{" "}
              <span className="text-red-500">*</span>
            </label>
            <textarea
              id="task-input"
              rows={3}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder={t("devices.taskDispatch.taskPlaceholder")}
              required
              disabled={loading}
              className="w-full resize-none rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label
                htmlFor="max-steps-input"
                className="text-[12px] font-medium text-text-secondary"
              >
                {t("devices.taskDispatch.maxSteps")}
              </label>
              <span className="text-[12px] tabular-nums text-text-primary font-semibold">
                {maxSteps}
              </span>
            </div>
            <input
              id="max-steps-input"
              type="range"
              min={5}
              max={100}
              step={5}
              value={maxSteps}
              onChange={(e) => setMaxSteps(Number(e.target.value))}
              disabled={loading}
              className="w-full accent-accent disabled:opacity-60"
            />
            <div className="flex justify-between text-[10px] text-text-muted">
              <span>5</span>
              <span>100</span>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2 text-[12px] text-red-600">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-3 transition-all disabled:opacity-60"
            >
              {t("devices.taskDispatch.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || !task.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-accent hover:bg-accent-hover transition-all disabled:opacity-60"
            >
              {loading ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t("devices.taskDispatch.dispatching")}
                </>
              ) : (
                t("devices.taskDispatch.dispatch")
              )}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
