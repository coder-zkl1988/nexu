import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DeviceInfo } from "./device-card";
import { useMirrorSocket } from "./use-mirror-mqtt";

interface Props {
  device: DeviceInfo;
  open: boolean;
  onClose: () => void;
}

export function MirrorDialog({ device, open, onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { frame, status, sendAction } = useMirrorSocket(
    open ? device.deviceId : null,
  );

  if (!open) return null;

  const mapPointerToDevice = (clientX: number, clientY: number) => {
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
  };

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const point = mapPointerToDevice(e.clientX, e.clientY);
    if (point === null) return;
    sendAction({ type: "click", x: point.x, y: point.y });
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
            // biome-ignore lint/a11y/useKeyWithClickEvents: tap-relay to a phone has no keyboard analog
            <img
              ref={imgRef}
              src={`data:image/png;base64,${frame.screenshot}`}
              alt={t("devices.mirror.title")}
              onClick={handleClick}
              className="w-full rounded-lg cursor-pointer select-none"
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
