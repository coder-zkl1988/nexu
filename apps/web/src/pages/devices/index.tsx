import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCloudConnect } from "@/hooks/use-cloud-connect";
import { useDesktopCloudStatus } from "@/hooks/use-desktop-cloud-status";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Lock, LogIn, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  getApiV1Devices,
  getApiV1RuntimeConfig,
} from "../../../lib/api/sdk.gen";
import type { DeviceInfo } from "./device-card";
import { DeviceCard } from "./device-card";
import { MirrorPanel } from "./mirror-panel";

export function DevicesPage() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mirrorDevice, setMirrorDevice] = useState<DeviceInfo | null>(null);

  const handleViewScreen = useCallback(
    (device: DeviceInfo) => {
      if (mirrorDevice?.deviceId === device.deviceId) {
        // Same device already shown — force remount to reconnect
        setMirrorDevice(null);
        requestAnimationFrame(() => setMirrorDevice(device));
      } else {
        setMirrorDevice(device);
      }
    },
    [mirrorDevice],
  );
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);

  const { data: runtimeConfig } = useQuery({
    queryKey: ["runtime-config"],
    queryFn: async () => {
      const res = await getApiV1RuntimeConfig();
      return res.data;
    },
  });

  const deviceControl = runtimeConfig?.deviceControl;
  const wsPort: number =
    typeof (deviceControl as Record<string, unknown> | undefined)?.wsPort ===
    "number"
      ? ((deviceControl as Record<string, unknown>).wsPort as number)
      : 18790;
  const qrUrl =
    deviceControl?.enabled && deviceControl?.localIp
      ? `ws://${deviceControl.localIp}:${wsPort}/phone`
      : null;

  // Device task execution needs the cloud model, so the whole tab is gated
  // behind cloud login. Reuse the same cloud-status / connect path as the
  // sidebar and rewards page instead of inventing a parallel auth check.
  const {
    data: cloudStatus,
    isLoading: cloudStatusLoading,
    refetch: refetchCloudStatus,
  } = useDesktopCloudStatus();
  const cloudConnected = cloudStatus?.connected ?? false;
  const { cloudConnecting, handleCloudConnect } = useCloudConnect({
    cloudConnected,
    onPoll: refetchCloudStatus,
  });
  // Only show the gate once we actually know the user is signed out — avoid a
  // flash of the overlay for logged-in users during the initial status fetch.
  const showLoginGate = !cloudStatusLoading && !cloudConnected;

  const fetchDevices = useCallback(async () => {
    try {
      const { data, error: apiError, response } = await getApiV1Devices();
      if (apiError) {
        const msg =
          typeof apiError === "object" &&
          apiError !== null &&
          "message" in apiError
            ? String((apiError as { message: unknown }).message)
            : t("devices.errorTitle");
        setError(msg);
        // 503 = device control plugin is not running → no devices are
        // reachable. Clear stale cards instead of leaving them looking
        // connected. Other errors (transient network) keep the last list.
        if (response?.status === 503) {
          setDevices([]);
        }
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

  useEffect(() => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const es = new EventSource(`${baseUrl}/api/v1/devices/stream`);
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    // Safety net: never let the spinner hang forever. If no device_list
    // snapshot arrives within the grace window — e.g. an older controller that
    // stays silent when the device-control plugin is down, and the SSE connects
    // fine so onerror's polling fallback never fires — fall back to the empty
    // state. The controller normally emits an initial snapshot within ~5s, so
    // this only triggers when that contract isn't met.
    const loadingFallback = setTimeout(() => setLoading(false), 8000);

    es.addEventListener("device_list", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.devices) {
          setDevices(data.devices);
          setLoading(false);
          setError(null);
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("device_connected", () => {
      void fetchDevices();
    });

    es.addEventListener("device_disconnected", (e) => {
      // Drop the card immediately using the deviceId in the event, so it
      // disappears even if the reconciling refetch transiently fails.
      try {
        const data = JSON.parse(e.data);
        if (data?.deviceId) {
          setDevices((prev) =>
            prev.filter((d) => d.deviceId !== data.deviceId),
          );
        }
      } catch {
        /* ignore */
      }
      void fetchDevices();
    });

    es.onerror = () => {
      // SSE failed — fall back to polling
      es.close();
      if (fallbackInterval === null) {
        fallbackInterval = setInterval(() => void fetchDevices(), 3000);
      }
    };

    return () => {
      clearTimeout(loadingFallback);
      es.close();
      if (fallbackInterval !== null) {
        clearInterval(fallbackInterval);
      }
    };
  }, [fetchDevices]);

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    void fetchDevices().finally(() => {
      setTimeout(() => setRefreshing(false), 300);
    });
  };

  return (
    <div className="relative flex h-full">
      <div className="flex-1 min-w-0 px-4 py-4 sm:px-6 sm:py-6 md:p-8 overflow-y-auto">
        <div className="mx-auto">
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
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowDownloadDialog(!showDownloadDialog)}
                  className="flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-2 transition-all"
                >
                  <Download size={12} />
                  下载 Tabby
                </button>
                <div
                  className={`absolute top-full right-0 mt-2 z-50 bg-surface-0 rounded-xl border border-border shadow-lg p-4 transition-all duration-200 origin-top-right ${
                    showDownloadDialog
                      ? "opacity-100 scale-100"
                      : "opacity-0 scale-95 pointer-events-none"
                  }`}
                >
                  <div className="bg-white p-2 rounded-lg border border-border">
                    <QRCodeSVG
                      value="https://downloads.picaso.studio/releases/app-release.apk"
                      size={160}
                      level="M"
                    />
                  </div>
                  <p className="text-[11px] text-text-muted mt-2 text-center leading-relaxed">
                    扫描下载 Tabby App
                  </p>
                </div>
              </div>
              {qrUrl && (
                <button
                  type="button"
                  onClick={() => setShowQrDialog(true)}
                  className="flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium text-accent rounded-lg border border-border hover:bg-accent/5 transition-all"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  扫码连接
                </button>
              )}
              <Link
                to="/workspace/devices/tasks"
                className="flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-2 transition-all"
              >
                {t("devices.taskHistory")}
              </Link>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-2 transition-all disabled:opacity-60"
              >
                <span
                  className={`w-3 h-3 border-2 border-current border-t-transparent rounded-full ${refreshing ? "animate-spin" : ""}`}
                />
                {t("devices.refresh")}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-6 flex items-start gap-3 p-4 rounded-xl border bg-amber-500/5 border-amber-500/20 text-[13px]">
              <span className="text-amber-500 shrink-0 mt-0.5">⚠</span>
              <div>
                <div className="font-medium text-text-primary">
                  {t("devices.errorTitle")}
                </div>
                <div className="text-text-muted mt-0.5 text-[12px]">
                  {error}
                </div>
              </div>
            </div>
          )}

          {loading && devices.length === 0 && !error && (
            <div className="flex justify-center items-center py-16">
              <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            </div>
          )}

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
              {qrUrl && (
                <button
                  type="button"
                  onClick={() => setShowQrDialog(true)}
                  className="flex items-center gap-2 mt-4 px-4 py-2 text-[13px] font-medium text-accent rounded-lg border border-accent/30 hover:bg-accent/5 transition-all"
                >
                  <QrCode className="h-4 w-4" />
                  扫码连接手机
                </button>
              )}
            </div>
          )}

          {devices.length > 0 && (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              }}
            >
              {devices.map((device) => (
                <DeviceCard
                  key={device.deviceId}
                  device={device}
                  onTaskSuccess={fetchDevices}
                  onViewScreen={handleViewScreen}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {mirrorDevice && (
        <div className="w-[360px] shrink-0 hidden md:block">
          <MirrorPanel
            device={mirrorDevice}
            onClose={() => setMirrorDevice(null)}
          />
        </div>
      )}

      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4" />
              扫码连接手机
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 pt-2">
            <div className="bg-white p-3 rounded-xl border border-border">
              {qrUrl && <QRCodeSVG value={qrUrl} size={200} level="M" />}
            </div>
            <div className="w-full px-[15%] pb-[15%]">
              <p className="text-[12px] text-text-muted leading-relaxed text-left">
                在手机上打开 Tabby
                App，点击「扫码连接」，扫描上方二维码即可连接。
              </p>
              {qrUrl && (
                <code className="block mt-2 text-[11px] text-text-muted bg-surface-2 px-2 py-1 rounded font-mono break-all text-left">
                  {qrUrl}
                </code>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showLoginGate && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-surface-0/80 px-6 backdrop-blur-sm">
          <div className="flex max-w-sm flex-col items-center rounded-2xl border border-border bg-surface-0 px-8 py-8 text-center shadow-lg">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2">
              <Lock className="h-6 w-6 text-text-secondary" />
            </div>
            <h2 className="text-[15px] font-semibold text-text-primary">
              {t("devices.loginTitle")}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
              {t("devices.loginBody")}
            </p>
            <button
              type="button"
              onClick={() => void handleCloudConnect()}
              disabled={cloudConnecting}
              className="mt-5 flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-[13px] font-medium text-white transition-all hover:bg-accent/90 disabled:opacity-60"
            >
              {cloudConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {t("devices.loginCta")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
