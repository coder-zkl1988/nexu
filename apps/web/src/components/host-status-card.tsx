import { useQuery } from "@tanstack/react-query";
import { Cpu, HardDrive, MemoryStick, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getApiV1RuntimeHostStatus } from "../../lib/api/sdk.gen";

/**
 * Runtime host status card: CPU load, memory, disk and uptime of the machine
 * running the OpenClaw gateway (system.info RPC, OpenClaw >=2026.7.1).
 */

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "—";
  const gib = bytes / 1024 ** 3;
  return gib >= 100 ? `${Math.round(gib)} GB` : `${gib.toFixed(1)} GB`;
}

function formatUptime(
  uptimeMs: number | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (uptimeMs === undefined || !Number.isFinite(uptimeMs)) return "—";
  const minutes = Math.floor(uptimeMs / 60000);
  if (minutes < 60) return t("home.hostUptimeMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return t("home.hostUptimeHours", { h: hours, m: minutes % 60 });
  const days = Math.floor(hours / 24);
  return t("home.hostUptimeDays", { d: days, h: hours % 24 });
}

export function HostStatusCard() {
  const { t } = useTranslation();

  const { data } = useQuery({
    queryKey: ["runtime-host-status"],
    queryFn: async () => {
      const { data } = await getApiV1RuntimeHostStatus();
      return data;
    },
    refetchInterval: 30000,
  });

  if (!data) return null;

  const memoryUsedBytes =
    data.memoryTotalBytes !== undefined && data.memoryFreeBytes !== undefined
      ? data.memoryTotalBytes - data.memoryFreeBytes
      : undefined;
  const memoryPercent =
    memoryUsedBytes !== undefined && data.memoryTotalBytes
      ? Math.round((memoryUsedBytes / data.memoryTotalBytes) * 100)
      : undefined;
  const loadPercent =
    data.loadAverage?.[0] !== undefined && data.cpuCount
      ? Math.round((data.loadAverage[0] / data.cpuCount) * 100)
      : undefined;

  const metrics: Array<{
    key: string;
    icon: typeof Cpu;
    label: string;
    value: string;
    detail?: string;
  }> = [
    {
      key: "cpu",
      icon: Cpu,
      label: t("home.hostCpu"),
      value: loadPercent !== undefined ? `${loadPercent}%` : "—",
      detail:
        data.loadAverage?.[0] !== undefined && data.cpuCount
          ? `load ${data.loadAverage[0].toFixed(2)} / ${data.cpuCount} core`
          : undefined,
    },
    {
      key: "memory",
      icon: MemoryStick,
      label: t("home.hostMemory"),
      value: memoryPercent !== undefined ? `${memoryPercent}%` : "—",
      detail:
        memoryUsedBytes !== undefined
          ? `${formatBytes(memoryUsedBytes)} / ${formatBytes(data.memoryTotalBytes)}`
          : undefined,
    },
    {
      key: "disk",
      icon: HardDrive,
      label: t("home.hostDisk"),
      value:
        data.diskAvailableBytes !== undefined
          ? formatBytes(data.diskAvailableBytes)
          : "—",
      detail:
        data.diskTotalBytes !== undefined
          ? t("home.hostDiskFree", {
              total: formatBytes(data.diskTotalBytes),
            })
          : undefined,
    },
    {
      key: "uptime",
      icon: Timer,
      label: t("home.hostUptime"),
      value: formatUptime(data.uptimeMs, t),
      detail: data.osLabel ?? data.hostname,
    },
  ];

  return (
    <div className="card card-static p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-text-primary">
          {t("home.hostStatusTitle")}
        </h3>
        <span
          className={
            data.connected
              ? "inline-flex items-center gap-1.5 text-[10px] text-[var(--color-success)]"
              : "inline-flex items-center gap-1.5 text-[10px] text-text-muted"
          }
        >
          <span
            className={
              data.connected
                ? "h-1.5 w-1.5 rounded-full bg-[var(--color-success)]"
                : "h-1.5 w-1.5 rounded-full bg-surface-4"
            }
          />
          {data.connected
            ? (data.machineName ?? t("home.hostConnected"))
            : t("home.hostDisconnected")}
        </span>
      </div>
      {data.connected ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.key}
              className="rounded-xl bg-surface-1 px-3 py-2.5"
            >
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                <metric.icon size={11} />
                {metric.label}
              </div>
              <div className="mt-1 text-[15px] font-semibold text-text-primary">
                {metric.value}
              </div>
              {metric.detail && (
                <div className="mt-0.5 truncate text-[10px] text-text-muted">
                  {metric.detail}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="py-2 text-[13px] text-text-muted">
          {t("home.hostDisconnectedHint")}
        </p>
      )}
    </div>
  );
}
