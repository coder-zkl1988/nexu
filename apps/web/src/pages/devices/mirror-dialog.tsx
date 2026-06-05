import { TouchAction } from "@nexu/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  const pendingMoveRef = useRef<
    Map<number, { x: number; y: number; pressure: number; buttons: number }>
  >(new Map());
  const moveRafRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const { frame, status: videoStatus } = useMirrorSocket(
    open ? device.deviceId : null,
    wsHost,
    wsPort,
  );
  const { status: controlStatus, sendAction } = useMirrorControl(
    open ? device.deviceId : null,
    wsHost,
    wsPort,
    frame?.screenWidth ?? frame?.width,
    frame?.screenHeight ?? frame?.height,
  );

  const isConnected = videoStatus === "open" && controlStatus === "open";
  const status = isConnected
    ? "open"
    : videoStatus === "connecting" || controlStatus === "connecting"
      ? "connecting"
      : "closed";

  const flushPendingMoves = useCallback(() => {
    moveRafRef.current = null;
    const pending = pendingMoveRef.current;
    if (pending.size === 0) return;
    for (const [pointerId, move] of pending) {
      sendAction({
        type: "touch_raw",
        action: TouchAction.MOVE,
        pointerId,
        x: move.x,
        y: move.y,
        pressure: move.pressure,
        actionButton: 0,
        buttons: move.buttons,
      });
    }
    pending.clear();
  }, [sendAction]);

  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) {
        cancelAnimationFrame(moveRafRef.current);
      }
    };
  }, []);

  // Initialize WebGL renderer when dialog opens and canvas is available
  useEffect(() => {
    if (open && canvasEl && !rendererRef.current) {
      const renderer = new MirrorGLRenderer();
      renderer.init(canvasEl);
      rendererRef.current = renderer;

      // Register with the decoder for this device
      const unregister = registerMirrorRenderer(device.deviceId, renderer);

      return () => {
        unregister();
        renderer.destroy();
        rendererRef.current = null;
      };
    }
  }, [open, canvasEl, device.deviceId]);

  // Update canvas size when frame dimensions change
  useEffect(() => {
    if (frame && rendererRef.current && canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      rendererRef.current.resize(rect.width, rect.height);
    }
  }, [frame, canvasEl]);

  if (!open) return null;

  const mapPointerToDevice = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasEl;
      if (canvas === null || frame === null) return null;
      const rect = canvas.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width;
      const relY = (clientY - rect.top) / rect.height;
      if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;
      return {
        x: Math.round(relX * (frame.screenWidth ?? frame.width)),
        y: Math.round(relY * (frame.screenHeight ?? frame.height)),
      };
    },
    [frame, canvasEl],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isConnected) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const point = mapPointerToDevice(e.clientX, e.clientY);
      if (point === null) return;
      activePointersRef.current.set(e.pointerId, { ...point });

      const pressure = e.buttons & 2 ? 0 : e.pressure || 1;
      sendAction({
        type: "touch_raw",
        action: TouchAction.DOWN,
        pointerId: e.pointerId,
        x: point.x,
        y: point.y,
        pressure,
        actionButton: 0,
        buttons: e.buttons,
      });

      // Long press
      longPressFiredRef.current = false;
      longPressStartRef.current = { x: e.clientX, y: e.clientY };
      longPressTimerRef.current = setTimeout(() => {
        if (longPressStartRef.current === null) return;
        sendAction({
          type: "touch_raw",
          action: TouchAction.UP,
          pointerId: e.pointerId,
          x: point.x,
          y: point.y,
          pressure: 0,
          actionButton: 0,
          buttons: 0,
        });
        longPressFiredRef.current = true;
        sendAction({
          type: "long_press",
          x: point.x,
          y: point.y,
          durationMs: 500,
        });
      }, 500);
    },
    [isConnected, mapPointerToDevice, sendAction],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (longPressTimerRef.current !== null && longPressStartRef.current) {
        const dx = e.clientX - longPressStartRef.current.x;
        const dy = e.clientY - longPressStartRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 8) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          longPressStartRef.current = null;
        }
      }

      if (!activePointersRef.current.has(e.pointerId)) return;
      const point = mapPointerToDevice(e.clientX, e.clientY);
      if (point === null) return;
      const activePtr = activePointersRef.current.get(e.pointerId);
      if (activePtr) {
        activePtr.x = point.x;
        activePtr.y = point.y;
      }

      const pressure = e.buttons & 2 ? 0 : e.pressure || 1;
      pendingMoveRef.current.set(e.pointerId, {
        x: point.x,
        y: point.y,
        pressure,
        buttons: e.buttons,
      });
      if (moveRafRef.current === null) {
        moveRafRef.current = requestAnimationFrame(flushPendingMoves);
      }
    },
    [mapPointerToDevice, flushPendingMoves],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      pendingMoveRef.current.delete(e.pointerId);
      if (pendingMoveRef.current.size === 0 && moveRafRef.current !== null) {
        cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = null;
      }
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressStartRef.current = null;

      if (longPressFiredRef.current) {
        activePointersRef.current.delete(e.pointerId);
        longPressFiredRef.current = false;
        return;
      }

      activePointersRef.current.delete(e.pointerId);
      const point = mapPointerToDevice(e.clientX, e.clientY);
      if (point === null) return;
      sendAction({
        type: "touch_raw",
        action: TouchAction.UP,
        pointerId: e.pointerId,
        x: point.x,
        y: point.y,
        pressure: 0,
        actionButton: 0,
        buttons: 0,
      });
      longPressFiredRef.current = false;
    },
    [mapPointerToDevice, sendAction],
  );

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
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="w-full rounded-lg cursor-pointer select-none"
              style={{
                aspectRatio: `${frame.screenWidth ?? frame.width}/${frame.screenHeight ?? frame.height}`,
                touchAction: "none",
              }}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
