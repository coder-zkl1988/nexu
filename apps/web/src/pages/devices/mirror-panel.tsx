import { RefreshCw, Send, X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeviceInfo } from "./device-card";
import { useMirrorSocket } from "./use-mirror-mqtt";

interface Props {
  device: DeviceInfo;
  onClose: () => void;
}

export function MirrorPanel({ device, onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [textInput, setTextInput] = useState("");
  const [showSwipe, setShowSwipe] = useState(false);
  const [swipeLine, setSwipeLine] = useState({ x1: 0, y1: 0, x2: 0, y2: 0 });
  const swipeRef = useRef<{
    startX: number;
    startY: number;
    deviceStartX: number;
    deviceStartY: number;
  } | null>(null);

  const { frame, status, sendAction, reconnect } = useMirrorSocket(
    device.deviceId,
  );

  const mapPointerToDevice = useCallback(
    (clientX: number, clientY: number) => {
      const img = imgRef.current;
      if (img === null || frame === null) return null;
      const rect = img.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width;
      const relY = (clientY - rect.top) / rect.height;
      if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;
      return {
        x: Math.round(relX * frame.width),
        y: Math.round(relY * frame.height),
      };
    },
    [frame],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const point = mapPointerToDevice(e.clientX, e.clientY);
      if (point === null) return;
      e.preventDefault();
      swipeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        deviceStartX: point.x,
        deviceStartY: point.y,
      };
      setShowSwipe(false);
    },
    [mapPointerToDevice],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const s = swipeRef.current;
    if (s === null) return;
    setShowSwipe(true);
    setSwipeLine({ x1: s.startX, y1: s.startY, x2: e.clientX, y2: e.clientY });
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const s = swipeRef.current;
      setShowSwipe(false);

      if (s === null) return;

      swipeRef.current = null;

      const endPoint = mapPointerToDevice(e.clientX, e.clientY);
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (endPoint === null || distance < 8) {
        sendAction({ type: "click", x: s.deviceStartX, y: s.deviceStartY });
        return;
      }

      sendAction({
        type: "swipe",
        startX: s.deviceStartX,
        startY: s.deviceStartY,
        endX: endPoint.x,
        endY: endPoint.y,
        durationMs: Math.min(Math.round(distance / 2), 500),
      });
    },
    [mapPointerToDevice, sendAction],
  );

  const handleSendText = useCallback(() => {
    const text = textInput.trim();
    if (!text) return;
    sendAction({ type: "input_text", text });
    setTextInput("");
  }, [textInput, sendAction]);

  const isConnected = status === "open" || status === "subscribing";

  const statusLabel =
    status === "connecting" || status === "subscribing"
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
        {isConnected && frame === null ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-[12px] text-text-muted">
            <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            <span>{t("devices.mirror.waitingFrame")}</span>
          </div>
        ) : frame !== null ? (
          <div className="relative inline-block select-none">
            <img
              ref={imgRef}
              src={`data:image/${frame.format ?? "png"};base64,${frame.screenshot}`}
              alt={t("devices.mirror.title")}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                swipeRef.current = null;
                setShowSwipe(false);
              }}
              className="max-w-full rounded-lg shadow-md"
              draggable={false}
              style={{
                aspectRatio: `${frame.width}/${frame.height}`,
                maxHeight: "calc(100vh - 220px)",
              }}
            />
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
              {frame.width}×{frame.height}
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
