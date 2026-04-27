import type { MirrorClientAction, MirrorSnapshotFrame } from "@nexu/shared";
import { useCallback, useEffect, useRef, useState } from "react";

type MirrorStatus = "connecting" | "subscribing" | "open" | "closed";

export function useMirrorSocket(deviceId: string | null) {
  const [frame, setFrame] = useState<MirrorSnapshotFrame | null>(null);
  const [status, setStatus] = useState<MirrorStatus>("closed");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (deviceId === null) {
      return;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/v1/devices/${encodeURIComponent(deviceId)}/mirror`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.addEventListener("open", () => {
      setStatus("subscribing");
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as { channel?: string; type?: string };
        if (parsed.channel === "mirror") {
          setFrame(parsed as MirrorSnapshotFrame);
          setStatus("open");
        }
        // The upstream sends a { type: "connected" } message when
        // the device session is established — transition to "open"
        // so the user knows the connection is live (but frames may
        // still arrive once the device starts pushing screenshots).
        if (parsed.type === "connected") {
          setStatus("open");
        }
      } catch {
        // drop malformed frame
      }
    });
    ws.addEventListener("close", () => setStatus("closed"));
    ws.addEventListener("error", () => setStatus("closed"));

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [deviceId]);

  const sendAction = useCallback((action: MirrorClientAction) => {
    const ws = wsRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(action));
  }, []);

  return { frame, status, sendAction };
}