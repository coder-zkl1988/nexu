import { useEffect, useRef, useState } from "react";

function buildMirrorUrl(deviceId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/devices/${encodeURIComponent(deviceId)}/mirror`;
}

export function useDeviceSnapshot(deviceId: string | null): string | null {
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!deviceId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    const ws = new WebSocket(buildMirrorUrl(deviceId));
    wsRef.current = ws;

    ws.addEventListener("message", (event) => {
      if (cancelled) return;
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as {
          channel?: string;
          screenshot?: string;
        };
        if (parsed.channel === "mirror" && parsed.screenshot) {
          setSnapshot(parsed.screenshot);
        }
      } catch {
        // ignore malformed
      }
    });

    return () => {
      cancelled = true;
      ws.close();
      wsRef.current = null;
    };
  }, [deviceId]);

  return snapshot;
}
