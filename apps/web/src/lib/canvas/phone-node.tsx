import { useDeviceSnapshot } from "@/pages/devices/use-device-snapshot";
import { useMirrorControl } from "@/pages/devices/use-mirror-control";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Smartphone } from "lucide-react";
import { useEffect, useRef } from "react";
import { getApiV1Devices } from "../../../lib/api/sdk.gen";
import { type CanvasNode, resizeNode, updateNode } from "./canvas-store";

const PHONE_NODE_VERTICAL_CHROME = 54;
const PHONE_SWIPE_THRESHOLD_PX = 8;

interface PhonePointerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function mapPhonePointerToDevice(
  clientX: number,
  clientY: number,
  rect: PhonePointerRect,
  imageWidth: number,
  imageHeight: number,
  screenWidth: number,
  screenHeight: number,
): { x: number; y: number } | null {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    screenWidth <= 0 ||
    screenHeight <= 0
  ) {
    return null;
  }

  const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  const renderedLeft = rect.left + (rect.width - renderedWidth) / 2;
  const renderedTop = rect.top + (rect.height - renderedHeight) / 2;
  const relativeX = (clientX - renderedLeft) / renderedWidth;
  const relativeY = (clientY - renderedTop) / renderedHeight;

  if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) {
    return null;
  }

  return {
    x: Math.round(relativeX * Math.max(0, screenWidth - 1)),
    y: Math.round(relativeY * Math.max(0, screenHeight - 1)),
  };
}

export function phoneNodeHeightForScreen(
  nodeWidth: number,
  screenWidth: number,
  screenHeight: number,
): number | null {
  if (nodeWidth <= 0 || screenWidth <= 0 || screenHeight <= 0) return null;
  return (
    Math.round((nodeWidth * screenHeight) / screenWidth) +
    PHONE_NODE_VERTICAL_CHROME
  );
}

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
  const { status: controlStatus, sendAction } = useMirrorControl(
    activeDeviceId,
    undefined,
    undefined,
    activeDevice?.screenWidth,
    activeDevice?.screenHeight,
  );
  const pointerStartRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    deviceX: number;
    deviceY: number;
  } | null>(null);

  useEffect(() => {
    if (!activeDeviceId || configuredId === activeDeviceId) return;
    updateNode(node.id, { metadata: { phone: { deviceId: activeDeviceId } } });
  }, [activeDeviceId, configuredId, node.id]);

  return (
    <div
      data-canvas-phone-node={node.id}
      data-canvas-wheel-exempt="true"
      className="flex h-full w-full flex-col gap-2 bg-surface-2 p-2"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[24px] border-4 border-neutral-900 bg-neutral-900 shadow-inner">
        {snapshot ? (
          <img
            src={`data:image/jpeg;base64,${snapshot}`}
            alt={activeDevice?.name ?? "手机实时预览"}
            aria-label={
              controlStatus === "open"
                ? "手机实时画面，可点击操作"
                : "手机实时画面，正在连接控制通道"
            }
            data-canvas-phone-screen={node.id}
            className={`h-full w-full touch-none object-contain ${
              controlStatus === "open" ? "cursor-pointer" : "cursor-wait"
            }`}
            draggable={false}
            onPointerDown={(event) => {
              if (event.button !== 0 || controlStatus !== "open") return;
              const point = mapPhonePointerToDevice(
                event.clientX,
                event.clientY,
                event.currentTarget.getBoundingClientRect(),
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
                activeDevice?.screenWidth ?? event.currentTarget.naturalWidth,
                activeDevice?.screenHeight ?? event.currentTarget.naturalHeight,
              );
              if (point === null) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              pointerStartRef.current = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                deviceX: point.x,
                deviceY: point.y,
              };
            }}
            onPointerUp={(event) => {
              const start = pointerStartRef.current;
              if (start === null || start.pointerId !== event.pointerId) return;
              pointerStartRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              const point = mapPhonePointerToDevice(
                event.clientX,
                event.clientY,
                event.currentTarget.getBoundingClientRect(),
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
                activeDevice?.screenWidth ?? event.currentTarget.naturalWidth,
                activeDevice?.screenHeight ?? event.currentTarget.naturalHeight,
              );
              if (point === null) return;
              const distance = Math.hypot(
                event.clientX - start.clientX,
                event.clientY - start.clientY,
              );
              if (distance < PHONE_SWIPE_THRESHOLD_PX) {
                sendAction({ type: "click", x: point.x, y: point.y });
                return;
              }
              sendAction({
                type: "swipe",
                startX: start.deviceX,
                startY: start.deviceY,
                endX: point.x,
                endY: point.y,
              });
            }}
            onPointerCancel={(event) => {
              if (pointerStartRef.current?.pointerId === event.pointerId) {
                pointerStartRef.current = null;
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onLoad={(event) => {
              const targetHeight = phoneNodeHeightForScreen(
                node.size.width,
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
              );
              if (
                targetHeight !== null &&
                Math.abs(targetHeight - node.size.height) > 8
              ) {
                resizeNode(node.id, {
                  width: node.size.width,
                  height: targetHeight,
                });
              }
            }}
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
      <select
        aria-label="切换手机"
        value={activeDeviceId ?? ""}
        onChange={(event) =>
          updateNode(node.id, {
            metadata: { phone: { deviceId: event.target.value } },
          })
        }
        disabled={devices.length === 0}
        className="h-8 w-full shrink-0 rounded-lg border border-border bg-surface-1 px-2 text-xs text-text-primary outline-none disabled:text-text-muted"
      >
        {devices.length === 0 ? <option value="">暂无可用手机</option> : null}
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.name || device.model || device.deviceId}
          </option>
        ))}
      </select>
    </div>
  );
}
