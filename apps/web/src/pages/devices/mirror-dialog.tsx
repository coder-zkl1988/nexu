import { TouchAction } from "@nexu/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeviceInfo } from "./device-card";
import { MirrorGLRenderer } from "./mirror-renderer";
import { useMirrorControl } from "./use-mirror-control";
import { registerMirrorRenderer, useMirrorSocket } from "./use-mirror-ws";

interface Props {
  device: DeviceInfo;
  open: boolean;
  onClose: () => void;
  wsHost?: string;
  wsPort?: number;
}

export function MirrorDialog({ device, open, onClose, wsHost, wsPort }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MirrorGLRenderer | null>(null);
  const upTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { frame, status: videoStatus } = useMirrorSocket(
    open ? device.deviceId : null,
    wsHost,
    wsPort,
  );
  const { status: controlStatus, sendAction } = useMirrorControl(
    open ? device.deviceId : null,
    wsHost,
    wsPort,
    frame?.width,
    frame?.height,
  );

  const isConnected = videoStatus === "open" && controlStatus === "open";
  const status = isConnected
    ? "open"
    : videoStatus === "connecting" || controlStatus === "connecting"
      ? "connecting"
      : "closed";

  // Initialize WebGL renderer when dialog opens and canvas is available
  useEffect(() => {
    if (open && canvasEl && !rendererRef.current) {
      const renderer = new MirrorGLRenderer();
      renderer.init(canvasEl);
      rendererRef.current = renderer;

      // Register with the decoder for this device
      const unregister = registerMirrorRenderer(device.deviceId, renderer);

      return () => {
        if (upTimerRef.current !== null) {
          clearTimeout(upTimerRef.current);
          upTimerRef.current = null;
        }
        unregister();
        renderer.destroy();
        rendererRef.current = null;
      };
    }
  }, [open, canvasEl, device.deviceId]);

  // Clean up pending tap timer on close
  useEffect(() => {
    if (!open && upTimerRef.current !== null) {
      clearTimeout(upTimerRef.current);
      upTimerRef.current = null;
    }
  }, [open]);

  // Update canvas size when frame dimensions change
  useEffect(() => {
    if (frame && rendererRef.current && canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      rendererRef.current.resize(rect.width, rect.height);
    }
  }, [frame, canvasEl]);

  if (!open) return null;

  const mapPointerToDevice = (clientX: number, clientY: number) => {
    const canvas = canvasEl;
    if (canvas === null || frame === null) return null;
    const rect = canvas.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;
    return {
      x: Math.round(relX * frame.width),
      y: Math.round(relY * frame.height),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    const point = mapPointerToDevice(e.clientX, e.clientY);
    if (point === null) return;
    // Send DOWN immediately
    sendAction({
      type: "touch_raw",
      action: TouchAction.DOWN,
      pointerId: e.pointerId,
      x: point.x,
      y: point.y,
      pressure: e.pressure || 1,
      actionButton: 0,
      buttons: e.buttons,
    });
    // Schedule UP after short delay (tap gesture)
    const ptrId = e.pointerId;
    upTimerRef.current = setTimeout(() => {
      upTimerRef.current = null;
      sendAction({
        type: "touch_raw",
        action: TouchAction.UP,
        pointerId: ptrId,
        x: point.x,
        y: point.y,
        pressure: 0,
        actionButton: 0,
        buttons: 0,
      });
    }, 50);
  };

  const statusText =
    status === "connecting"
      ? t("devices.mirror.statusConnecting")
      : status === "closed"
        ? t("devices.mirror.statusClosed")
        : status;

  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 m-0 max-w-none max-h-none w-full h-full border-none bg-transparent"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl border border-border bg-surface-1 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div
              id={titleId}
              className="text-[14px] font-semibold text-text-primary"
            >
              {t("devices.mirror.title")}
            </div>
            <div className="text-[12px] text-text-muted mt-0.5 truncate">
              {device.deviceId} · {statusText}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-text-secondary hover:text-text-primary"
          >
            {t("devices.mirror.close")}
          </button>
        </div>

        <div className="px-5 py-4">
          {frame === null ? (
            <div className="aspect-[9/16] flex items-center justify-center text-[12px] text-text-muted">
              {status === "open"
                ? t("devices.mirror.waitingFrame")
                : statusText}
            </div>
          ) : (
            <canvas
              ref={setCanvasEl}
              onPointerDown={handlePointerDown}
              className="w-full rounded-lg cursor-pointer select-none"
              style={{
                aspectRatio: `${frame.width}/${frame.height}`,
                touchAction: "none",
              }}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
