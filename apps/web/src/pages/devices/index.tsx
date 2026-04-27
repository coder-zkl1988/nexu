import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getApiV1Devices } from "../../../lib/api/sdk.gen";
import type { DeviceInfo } from "./device-card";
import { DeviceCard } from "./device-card";

export function DevicesPage() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDevices = useCallback(async () => {
    try {
      const { data, error: apiError } = await getApiV1Devices();
      if (apiError) {
        const msg =
          typeof apiError === "object" &&
          apiError !== null &&
          "message" in apiError
            ? String((apiError as { message: unknown }).message)
            : t("devices.errorTitle");
        setError(msg);
      } else {
        setError(null);
        setDevices(data?.devices ?? []);
      }
    } catch {
      setError(t("devices.errorTitle"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const startPolling = () => {
      if (intervalRef.current === null) {
        intervalRef.current = setInterval(() => void fetchDevices(), 5000);
      }
    };
    const stopPolling = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        void fetchDevices();
        startPolling();
      }
    };

    void fetchDevices();
    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchDevices]);

  const handleRefresh = () => {
    setLoading(true);
    void fetchDevices();
  };

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8 mx-auto max-w-4xl">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-text-primary">
            {t("title.devices")}
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            {t("devices.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/workspace/devices/tasks"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-2 transition-all"
          >
            {t("devices.taskHistory")}
          </Link>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-2 transition-all disabled:opacity-60"
          >
            <span
              className={`w-3 h-3 border-2 border-current border-t-transparent rounded-full ${loading ? "animate-spin" : ""}`}
            />
            {t("devices.refresh")}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-xl border bg-amber-500/5 border-amber-500/20 text-[13px]">
          <span className="text-amber-500 shrink-0 mt-0.5">⚠</span>
          <div>
            <div className="font-medium text-text-primary">
              {t("devices.errorTitle")}
            </div>
            <div className="text-text-muted mt-0.5 text-[12px]">{error}</div>
          </div>
        </div>
      )}

      {/* Loading spinner (initial load only) */}
      {loading && devices.length === 0 && !error && (
        <div className="flex justify-center items-center py-16">
          <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && devices.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex justify-center items-center w-14 h-14 rounded-2xl bg-surface-2 mb-4">
            <span className="text-2xl">📱</span>
          </div>
          <div className="text-[14px] font-semibold text-text-primary">
            {t("devices.emptyTitle")}
          </div>
          <div className="text-[12px] text-text-muted mt-1 max-w-xs">
            {t("devices.emptyHint")}
          </div>
        </div>
      )}

      {/* Device grid — show even during error if we have cached devices */}
      {devices.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.map((device) => (
            <DeviceCard
              key={device.deviceId}
              device={device}
              onTaskSuccess={fetchDevices}
            />
          ))}
        </div>
      )}
    </div>
  );
}
