import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { Download, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const qrUrl =
    deviceControl?.enabled && deviceControl?.localIp
      ? `ws://${deviceControl.localIp}:${deviceControl.wsPort}/phone`
      : null;

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

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    void fetchDevices().finally(() => {
      setTimeout(() => setRefreshing(false), 300);
    });
  };

  return (
    <div className="flex h-full">
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
                      value="https://cdn.jsdelivr.net/gh/coder-zkl1988/tabby-app@dev/app-release.apk"
                      size={160}
                      level="M"
                    />
                  </div>
                  <p className="text-[11px] text-text-muted mt-2 text-center leading-relaxed">
                    扫描下载 Tabby App
                  </p>
                  <p className="text-[10px] text-text-muted/60 mt-1 text-center leading-relaxed">
                    jsDelivr CDN · 免费无限流量
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
                  onViewScreen={setMirrorDevice}
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
    </div>
  );
}
