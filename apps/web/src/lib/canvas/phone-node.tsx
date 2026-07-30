import { useDeviceSnapshot } from "@/pages/devices/use-device-snapshot";
import { useQuery } from "@tanstack/react-query";
import { BatteryMedium, Loader2, Smartphone, Wifi } from "lucide-react";
import { useEffect } from "react";
import { getApiV1Devices } from "../../../lib/api/sdk.gen";
import { type CanvasNode, updateNode } from "./canvas-store";

const STATUS_COLOR = {
  idle: "#10b981",
  busy: "#3b82f6",
  error: "#ef4444",
} as const;

export function PhoneNodeContent({ node }: { node: CanvasNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data: devices, error } = await getApiV1Devices();
      if (error || !devices) throw new Error("设备列表加载失败");
      return devices;
    },
    refetchInterval: 5_000,
  });
  const devices = data?.devices ?? [];
  const configuredId = node.metadata.phone?.deviceId;
  const activeDevice =
    devices.find((device) => device.deviceId === configuredId) ?? devices[0];
  const activeDeviceId = activeDevice?.deviceId ?? null;
  const snapshot = useDeviceSnapshot(activeDeviceId);

  useEffect(() => {
    if (!activeDeviceId || configuredId === activeDeviceId) return;
    updateNode(node.id, { metadata: { phone: { deviceId: activeDeviceId } } });
  }, [activeDeviceId, configuredId, node.id]);

  return (
    <div
      data-canvas-phone-node={node.id}
      data-canvas-wheel-exempt="true"
      className="flex h-full w-full flex-col bg-surface-2 p-3"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[34px] border-[7px] border-neutral-900 bg-neutral-950 shadow-inner">
        <div className="relative flex h-7 shrink-0 items-center justify-center bg-neutral-950">
          <span className="h-3 w-16 rounded-full bg-black ring-1 ring-white/10" />
          {activeDevice ? (
            <span
              className="absolute right-3 size-2 rounded-full"
              style={{ background: STATUS_COLOR[activeDevice.status] }}
            />
          ) : null}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-neutral-900">
          {snapshot ? (
            <img
              src={`data:image/jpeg;base64,${snapshot}`}
              alt={activeDevice?.name ?? "手机实时预览"}
              className="h-full w-full object-contain"
              draggable={false}
            />
          ) : isLoading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-400">
              <Loader2 size={24} className="animate-spin" />
              <span className="text-xs">正在连接手机画面</span>
            </div>
          ) : activeDevice ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-neutral-400">
              <Smartphone size={30} />
              <span className="text-xs leading-5">等待手机预览画面</span>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-neutral-400">
              <Smartphone size={30} />
              <span className="text-xs leading-5">当前没有已连接的手机</span>
            </div>
          )}
        </div>

        <div className="shrink-0 bg-neutral-950 px-3 pb-2 pt-2 text-white">
          <div className="flex items-center gap-2">
            <Wifi size={12} className="text-emerald-400" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
              {activeDevice?.name || activeDevice?.model || "未连接"}
            </span>
            {activeDevice?.batteryLevel !== undefined ? (
              <span className="flex items-center gap-1 text-[10px] text-neutral-400">
                <BatteryMedium size={12} />
                {activeDevice.batteryLevel}%
              </span>
            ) : null}
          </div>
          {devices.length > 1 ? (
            <select
              value={activeDeviceId ?? ""}
              onChange={(event) =>
                updateNode(node.id, {
                  metadata: { phone: { deviceId: event.target.value } },
                })
              }
              className="mt-2 h-7 w-full rounded-lg border border-white/15 bg-neutral-900 px-2 text-[10px] text-white outline-none"
            >
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.name || device.model || device.deviceId}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
    </div>
  );
}
