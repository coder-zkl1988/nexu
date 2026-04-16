import type { MirrorClientAction, MirrorSnapshotFrame } from "@nexu/shared";
import { useEffect, useRef, useState } from "react";

type Status = "connecting" | "open" | "closed";

export function useMirrorSocket(deviceId: string | null) {
  const [frame, setFrame] = useState<MirrorSnapshotFrame | null>(null);
  const [status, setStatus] = useState<Status>("closed");
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

    ws.addEventListener("open", () => setStatus("open"));
    ws.addEventListener("close", () => setStatus("closed"));
    ws.addEventListener("error", () => setStatus("closed"));
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as { channel?: string };
        if (parsed.channel !== "mirror") return;
        setFrame(parsed as MirrorSnapshotFrame);
      } catch {
        // drop malformed frame
      }
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [deviceId]);

  const sendAction = (action: MirrorClientAction) => {
    const ws = wsRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(action));
  };

  return { frame, status, sendAction };
}
