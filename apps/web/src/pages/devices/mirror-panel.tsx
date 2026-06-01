import { type DeviceMessage, TouchAction } from "@nexu/shared";
import { RefreshCw, Send, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeviceInfo } from "./device-card";
import { MirrorGLRenderer } from "./mirror-renderer";
import { useMirrorControl } from "./use-mirror-control";
import { registerMirrorRenderer, useMirrorSocket } from "./use-mirror-ws";

interface Props {
  device: DeviceInfo;
  onClose: () => void;
  wsHost?: string;
  wsPort?: number;
}

export function MirrorPanel({ device, onClose, wsHost, wsPort }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MirrorGLRenderer | null>(null);
  const [textInput, setTextInput] = useState("");
  const [showSwipe, setShowSwipe] = useState(false);
  const [swipeLine, setSwipeLine] = useState({ x1: 0, y1: 0, x2: 0, y2: 0 });
  const activePointersRef = useRef<
    Map<
      number,
      {
        x: number;
        y: number;
        startDeviceX: number;
        startDeviceY: number;
      }
    >
  >(new Map());
  const visualPointerRef = useRef<{
    id: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [_deviceClipboard, setDeviceClipboard] = useState<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const _lastSyncedClipboardRef = useRef<string>("");
  const [isSwitching, setIsSwitching] = useState(false);
  const prevDeviceIdRef = useRef(device.deviceId);

  // Video channel: H.264 frames → base64 snapshots
  const {
    frame,
    status: videoStatus,
    reconnect: reconnectVideo,
  } = useMirrorSocket(device.deviceId, wsHost, wsPort);

  useEffect(() => {
    if (prevDeviceIdRef.current !== device.deviceId) {
      setIsSwitching(true);
      prevDeviceIdRef.current = device.deviceId;
    }
  }, [device.deviceId]);

  useEffect(() => {
    if (frame && isSwitching) {
      setIsSwitching(false);
    }
  }, [frame, isSwitching]);

  // Control channel: user interactions (click, swipe, text, key)
  const {
    status: controlStatus,
    sendAction,
    reconnect: reconnectControl,
  } = useMirrorControl(
    device.deviceId,
    wsHost,
    wsPort,
    frame?.screenWidth ?? frame?.width,
    frame?.screenHeight ?? frame?.height,
    useCallback((msg: DeviceMessage) => {
      if (msg.type === "clipboard") {
        setDeviceClipboard(msg.text);
        // Auto-copy to system clipboard
        navigator.clipboard.writeText(msg.text).catch(() => {});
        _lastSyncedClipboardRef.current = msg.text;
      }
    }, []),
  );

  // Combined status: both channels must be open
  const isConnected = videoStatus === "open" && controlStatus === "open";
  const status = isConnected
    ? "open"
    : videoStatus === "connecting" || controlStatus === "connecting"
      ? "connecting"
      : "closed";

  const reconnect = useCallback(() => {
    reconnectVideo();
    reconnectControl();
  }, [reconnectVideo, reconnectControl]);

  // Initialize WebGL renderer and register with decoder
  useEffect(() => {
    if (canvasEl) {
      // Destroy previous renderer if switching devices
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
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
  }, [canvasEl, device.deviceId]);

  // Update canvas size when frame dimensions change
  useEffect(() => {
    if (frame && rendererRef.current && canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      rendererRef.current.resize(rect.width, rect.height);
    }
  }, [frame, canvasEl]);

  // PC Clipboard Auto-Push: on window focus, read PC clipboard and push to device
  useEffect(() => {
    if (!isConnected || !frame?.width || !frame?.height) return;

    const handleFocus = async () => {
      try {
        const pcText = await navigator.clipboard.readText();
        if (pcText && pcText !== _lastSyncedClipboardRef.current) {
          _lastSyncedClipboardRef.current = pcText;
          sendAction({
            type: "set_clipboard",
            text: pcText,
            paste: false,
            sequence: Date.now(),
          });
        }
      } catch {
        // Clipboard API denied — ignore silently
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [isConnected, frame?.width, frame?.height, sendAction]);

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
    (e: React.PointerEvent) => {
      if (!isConnected) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const point = mapPointerToDevice(e.clientX, e.clientY);
      if (point === null) return;
      activePointersRef.current.set(e.pointerId, {
        ...point,
        startDeviceX: point.x,
        startDeviceY: point.y,
      });

      // Right-click → hover (pressure=0)
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

      // Start long press detection
      longPressFiredRef.current = false;
      longPressStartRef.current = { x: e.clientX, y: e.clientY };
      longPressTimerRef.current = setTimeout(() => {
        const start = longPressStartRef.current;
        if (start === null) return;
        // Close the initial touch_raw DOWN with a matching UP before sending semantic long_press
        // This prevents an orphaned DOWN in the Android gesture buffer
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

      // Visual swipe indicator: track first pointer only
      if (activePointersRef.current.size === 1) {
        visualPointerRef.current = {
          id: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
        };
        setShowSwipe(false);
      }
    },
    [isConnected, mapPointerToDevice, sendAction],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Cancel long press if moved significantly
      if (longPressTimerRef.current !== null && longPressStartRef.current) {
        const dx = e.clientX - longPressStartRef.current.x;
        const dy = e.clientY - longPressStartRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 8) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          longPressStartRef.current = null;
        }
      }
      const active = activePointersRef.current.get(e.pointerId);
      if (active === undefined) return;
      const point = mapPointerToDevice(e.clientX, e.clientY);
      if (point === null) return;
      Object.assign(active, { x: point.x, y: point.y });

      // Visual swipe indicator for the tracked pointer
      const visual = visualPointerRef.current;
      if (visual && visual.id === e.pointerId) {
        setShowSwipe(true);
        setSwipeLine({
          x1: visual.startX,
          y1: visual.startY,
          x2: e.clientX,
          y2: e.clientY,
        });
      }

      // Only send MOVE if pointer is captured (i.e., button held)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        const pressure = e.buttons & 2 ? 0 : e.pressure || 1;
        sendAction({
          type: "touch_raw",
          action: TouchAction.MOVE,
          pointerId: e.pointerId,
          x: point.x,
          y: point.y,
          pressure,
          actionButton: 0,
          buttons: e.buttons,
        });
      }
    },
    [mapPointerToDevice, sendAction],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      // Clear long press timer
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressStartRef.current = null;

      if (longPressFiredRef.current) {
        // Long press already handled the complete gesture on device
        // Skip the UP event to avoid spurious Click on Android
        if (e.target instanceof HTMLElement) {
          try {
            e.target.releasePointerCapture(e.pointerId);
          } catch {}
        }
        activePointersRef.current.delete(e.pointerId);
        longPressFiredRef.current = false;
        return;
      }

      e.currentTarget.releasePointerCapture(e.pointerId);
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

      // Clear visual indicator if this was the tracked pointer
      const visual = visualPointerRef.current;
      if (visual && visual.id === e.pointerId) {
        visualPointerRef.current = null;
      }

      if (activePointersRef.current.size === 0) {
        setShowSwipe(false);
      }
      longPressFiredRef.current = false;
    },
    [sendAction, mapPointerToDevice],
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
    longPressFiredRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Already released
    }

    activePointersRef.current.delete(e.pointerId);

    const visual = visualPointerRef.current;
    if (visual && visual.id === e.pointerId) {
      visualPointerRef.current = null;
    }

    if (activePointersRef.current.size === 0) {
      setShowSwipe(false);
    }
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!isConnected || !frame) return;
      const point = mapPointerToDevice(e.clientX, e.clientY);
      if (point === null) return;
      // Normalize wheel delta to scroll values (-1 to 1)
      const vScroll = Math.max(-1, Math.min(1, -e.deltaY / 100));
      const hScroll = Math.max(-1, Math.min(1, e.deltaX / 100));
      sendAction({ type: "scroll", x: point.x, y: point.y, hScroll, vScroll });
    },
    [isConnected, frame, mapPointerToDevice, sendAction],
  );

  const handleSendText = useCallback(() => {
    const text = textInput.trim();
    if (!text) return;
    sendAction({ type: "input_text", text });
    setTextInput("");
  }, [textInput, sendAction]);

  const statusLabel =
    status === "connecting"
      ? t("devices.mirror.statusConnecting")
      : status === "closed"
        ? t("devices.mirror.statusClosed")
        : status === "open"
          ? t("devices.mirror.statusOpen")
          : status;

  return (
    <aside
      aria-labelledby={titleId}
      className="flex flex-col h-full bg-surface-0 border-l border-border"
    >
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="min-w-0" id={titleId}>
          <div className="text-[14px] font-semibold text-text-primary">
            {t("devices.mirror.title")}
          </div>
          <div className="text-[12px] text-text-muted mt-0.5 truncate">
            {device.name || device.model || device.deviceId}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
              status === "open"
                ? "text-green-600"
                : status === "closed"
                  ? "text-red-500"
                  : "text-text-muted"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status === "open"
                  ? "bg-green-500"
                  : status === "closed"
                    ? "bg-red-500"
                    : "bg-text-muted animate-pulse"
              }`}
            />
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
            aria-label={t("devices.mirror.close")}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex items-start justify-center px-1 py-2">
        {frame === null && !isSwitching ? (
          isConnected ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-[12px] text-text-muted">
              <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              <span>{t("devices.mirror.waitingFrame")}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <div className="flex justify-center items-center w-14 h-14 rounded-2xl bg-surface-2">
                <span className="text-2xl">📱</span>
              </div>
              <div className="text-[13px] text-text-muted text-center max-w-[200px]">
                {status === "closed"
                  ? t("devices.mirror.closedHint")
                  : t("devices.mirror.connectingHint")}
              </div>
              {status === "closed" && (
                <button
                  type="button"
                  onClick={reconnect}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-accent rounded-lg border border-border hover:bg-surface-2 transition-colors"
                >
                  <RefreshCw size={12} />
                  {t("devices.mirror.retry")}
                </button>
              )}
            </div>
          )
        ) : (
          <div className="relative inline-block select-none">
            <canvas
              ref={setCanvasEl}
              className="max-w-full h-auto rounded-lg shadow-md"
              style={{
                aspectRatio: `${frame?.screenWidth ?? frame?.streamWidth ?? frame?.width ?? 9}/${frame?.screenHeight ?? frame?.streamHeight ?? frame?.height ?? 16}`,
                maxHeight: "calc(100vh - 220px)",
                opacity: isConnected && !isSwitching ? 1 : 0.5,
                touchAction: "none",
              }}
              onPointerDown={isConnected ? handlePointerDown : undefined}
              onPointerMove={isConnected ? handlePointerMove : undefined}
              onPointerUp={isConnected ? handlePointerUp : undefined}
              onPointerCancel={isConnected ? handlePointerCancel : undefined}
              onWheel={isConnected ? handleWheel : undefined}
            />
            {!isConnected && !isSwitching && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/40">
                <div className="text-[13px] text-white font-medium">
                  {t("devices.mirror.closedHint")}
                </div>
                <button
                  type="button"
                  onClick={reconnect}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white rounded-lg border border-white/30 hover:bg-white/10 transition-colors"
                >
                  <RefreshCw size={12} />
                  {t("devices.mirror.retry")}
                </button>
              </div>
            )}
            {isSwitching && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/20">
                <div className="text-[11px] text-white/70">
                  {t("devices.mirror.switching") ?? "Switching..."}
                </div>
              </div>
            )}
            {showSwipe && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: "100%", height: "100%" }}
                role="img"
                aria-label={t("devices.mirror.swipeIndicator")}
              >
                <line
                  x1={swipeLine.x1}
                  y1={swipeLine.y1}
                  x2={swipeLine.x2}
                  y2={swipeLine.y2}
                  stroke="#0058BC"
                  strokeWidth="2"
                  strokeDasharray="4 2"
                  opacity={0.6}
                />
              </svg>
            )}
          </div>
        )}
      </div>

      {frame !== null && (
        <div className="shrink-0 border-t border-border">
          <div className="px-4 py-2 border-b border-border flex items-center gap-2">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendText();
                if (e.key === "Escape") setTextInput("");
              }}
              placeholder="输入文字发送到手机…"
              className="flex-1 text-[12px] bg-surface-0 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-accent placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={handleSendText}
              disabled={!textInput.trim()}
              className="p-1.5 rounded-md text-accent hover:bg-accent/10 disabled:opacity-30 transition-colors"
            >
              <Send size={14} />
            </button>
          </div>

          <div className="px-4 py-2 text-[11px] text-text-muted flex items-center justify-between">
            <span>
              {frame.screenWidth ?? frame.width}×
              {frame.screenHeight ?? frame.height}
            </span>
            {frame.currentApp && (
              <span className="truncate ml-2">{frame.currentApp}</span>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
