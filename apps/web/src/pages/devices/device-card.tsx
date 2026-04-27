import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetApiV1DevicesResponse } from "../../../lib/api/types.gen";
import { MirrorDialog } from "./mirror-dialog";
import { TaskDispatchDialog } from "./task-dispatch-dialog";

export type DeviceInfo =
  NonNullable<GetApiV1DevicesResponse>["devices"][number];

type StatusColor = "success" | "processing" | "error" | "default";

function statusColor(status: DeviceInfo["status"]): StatusColor {
  if (status === "idle") return "success";
  if (status === "busy") return "processing";
  if (status === "error") return "error";
  return "default";
}

const STATUS_DOT: Record<StatusColor, string> = {
  success: "bg-green-500",
  processing: "bg-blue-500 animate-pulse",
  error: "bg-red-500",
  default: "bg-gray-400",
};

const STATUS_TEXT: Record<StatusColor, string> = {
  success: "text-green-700",
  processing: "text-blue-700",
  error: "text-red-700",
  default: "text-gray-500",
};

const STATUS_I18N_KEY: Record<DeviceInfo["status"], string> = {
  idle: "devices.status.idle",
  busy: "devices.status.busy",
  error: "devices.status.error",
};

export function DeviceCard({
  device,
  onTaskSuccess,
}: {
  device: DeviceInfo;
  onTaskSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const color = statusColor(device.status);
  const label = STATUS_I18N_KEY[device.status]
    ? t(STATUS_I18N_KEY[device.status])
    : device.status;

  return (
    <>
      <div className="rounded-xl border border-border bg-surface-1 p-4 flex flex-col gap-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text-primary truncate">
              {device.deviceId}
            </div>
            {device.model && (
              <div className="text-[11px] text-text-muted mt-0.5 truncate">
                {device.model}
              </div>
            )}
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${STATUS_TEXT[color]}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[color]}`} />
            {label}
          </span>
        </div>

        <div className="flex flex-col gap-1 text-[12px] text-text-secondary">
          {device.currentApp && (
            <div className="flex justify-between gap-2">
              <span className="text-text-muted shrink-0">
                {t("devices.currentApp")}
              </span>
              <span className="truncate text-right">{device.currentApp}</span>
            </div>
          )}
          {device.batteryLevel !== undefined && (
            <div className="flex justify-between gap-2">
              <span className="text-text-muted shrink-0">
                {t("devices.battery")}
              </span>
              <span>
                {device.batteryLevel}%
                {device.isCharging && (
                  <span className="ml-1 text-green-600">⚡</span>
                )}
              </span>
            </div>
          )}
        </div>

        <div className="mt-auto flex gap-2">
          <button
            type="button"
            disabled={device.status === "busy"}
            onClick={() => setDialogOpen(true)}
            className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2 hover:border-border-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("devices.dispatchTask")}
          </button>
          <button
            type="button"
            onClick={() => setMirrorOpen(true)}
            className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2 hover:border-border-hover"
          >
            {t("devices.viewScreen")}
          </button>
        </div>
      </div>

      <TaskDispatchDialog
        device={device}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={() => {
          setDialogOpen(false);
          onTaskSuccess();
        }}
      />
      <MirrorDialog
        device={device}
        open={mirrorOpen}
        onClose={() => setMirrorOpen(false)}
      />
    </>
  );
}
