import {
  type DeviceMessage,
  decodeDeviceMessage,
  encodeMirrorAction,
} from "@nexu/shared";
import type { MirrorClientAction } from "@nexu/shared";
import { useCallback, useEffect, useRef, useState } from "react";

type ControlStatus = "connecting" | "open" | "closed";

/**
 * Separate hook for the control WebSocket channel.
 *
 * Video frames come through use-mirror-ws (video channel).
 * Control actions (click, swipe, text, key) go through this hook.
 *
 * URL resolution:
 *   - If wsHost + wsPort are provided → direct connection to ws://{wsHost}:{wsPort}/mirror
 *     (for testing against tabby-control directly, backward-compatible)
 *   - Otherwise → go through the controller proxy:
 *     ws://{window.location.host}/api/v1/devices/{deviceId}/control
 *
 * Action sending:
 *   - All actions (click, swipe, input_text, press_key, scroll) are sent as JSON
 */
export function useMirrorControl(
  deviceId: string | null,
  wsHost?: string,
  wsPort?: number,
  screenWidth?: number,
  screenHeight?: number,
  onDeviceMessage?: (msg: DeviceMessage) => void,
) {
  const [status, setStatus] = useState<ControlStatus>(
    deviceId === null ? "closed" : "connecting",
  );
  const [reconnectKey, setReconnectKey] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const onDeviceMessageRef = useRef(onDeviceMessage);
  onDeviceMessageRef.current = onDeviceMessage;

  const host =
    wsHost ??
    (typeof window === "undefined" ? "localhost" : window.location.hostname);
  const port = wsPort ?? 18790;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reconnectKey triggers reconnection
  useEffect(() => {
    if (deviceId === null) {
      setStatus("closed");
      wsRef.current = null;
      return;
    }

    // If wsHost/wsPort are provided, connect directly (backward compat).
    // Otherwise, go through the controller proxy.
    const url =
      wsHost !== undefined || wsPort !== undefined
        ? `ws://${host}:${port}/mirror`
        : `ws://${window.location.host}/api/v1/devices/${encodeURIComponent(deviceId)}/control`;

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => setStatus("open");
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("closed");

    // Handle device→client messages (clipboard, acks, lifecycle events)
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        // Legacy JSON device messages (backward compat)
        try {
          const msg = JSON.parse(event.data);
          if (onDeviceMessageRef.current && msg.type) {
            onDeviceMessageRef.current(msg as DeviceMessage);
          }
        } catch {
          // ignore malformed
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Binary device messages (new protocol)
        const decoded = decodeDeviceMessage(event.data);
        if (decoded !== null && onDeviceMessageRef.current) {
          onDeviceMessageRef.current(decoded);
        }
      }
    };

    setStatus("connecting");

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [deviceId, host, port, reconnectKey]);

  const sendAction = useCallback(
    (action: MirrorClientAction) => {
      const ws = wsRef.current;
      if (ws === null || ws.readyState !== WebSocket.OPEN) {
        console.warn(
          "[mirror-control] sendAction DROPPED — ws:",
          ws === null ? "null" : `readyState=${ws.readyState}`,
          "action:",
          action.type,
        );
        return;
      }

      if (action.type === "touch_raw") {
        const sw = screenWidth ?? 1080;
        const sh = screenHeight ?? 2400;
        const frames = encodeMirrorAction(action, sw, sh);
        console.log(
          "[mirror-control] sendAction → binary, frames:",
          frames.length,
          "type:",
          action.type,
          "dims:",
          sw,
          "x",
          sh,
        );
        for (const frame of frames) {
          ws.send(frame);
        }
      } else {
        console.log("[mirror-control] sendAction → JSON, type:", action.type);
        ws.send(JSON.stringify(action));
      }
    },
    [screenWidth, screenHeight],
  );

  const reconnect = useCallback(() => {
    setStatus("connecting");
    setReconnectKey((k) => k + 1);
  }, []);

  return { status, sendAction, reconnect };
}
