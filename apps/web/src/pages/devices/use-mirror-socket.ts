import type { MirrorClientAction, MirrorSnapshotFrame } from "@nexu/shared";
import { useCallback, useEffect, useRef, useState } from "react";

type MirrorStatus = "connecting" | "subscribing" | "open" | "closed";

function buildWsUrl(deviceId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/devices/${encodeURIComponent(deviceId)}/mirror`;
}

export function useMirrorSocket(deviceId: string | null) {
  const [frame, setFrame] = useState<MirrorSnapshotFrame | null>(null);
  const [status, setStatus] = useState<MirrorStatus>(
    deviceId === null ? "closed" : "connecting",
  );
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (deviceId === null) {
      setFrame(null);
      setStatus("closed");
      wsRef.current = null;
      return;
    }

    let cancelled = false;
    const url = buildWsUrl(deviceId);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.addEventListener("open", () => {
      if (cancelled) return;
      setStatus("subscribing");
    });

    ws.addEventListener("message", (event) => {
      if (cancelled) return;
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as {
          channel?: string;
          type?: string;
        };
        if (parsed.channel === "mirror") {
          setFrame(parsed as MirrorSnapshotFrame);
          setStatus("open");
        }
        if (parsed.type === "connected") {
          setStatus("open");
        }
      } catch {
        // drop malformed frame
      }
    });

    ws.addEventListener("close", () => {
      if (cancelled) return;
      wsRef.current = null;
      setStatus("closed");
    });

    ws.addEventListener("error", () => {
      if (cancelled) return;
      wsRef.current = null;
      setStatus("closed");
    });

    return () => {
      cancelled = true;
      ws.close();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [deviceId]);

  const reconnect = useCallback(() => {
    if (deviceId === null) return;
    const oldWs = wsRef.current;
    if (oldWs) {
      oldWs.close();
      wsRef.current = null;
    }

    const url = buildWsUrl(deviceId);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.addEventListener("open", () => {
      setStatus("subscribing");
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as {
          channel?: string;
          type?: string;
        };
        if (parsed.channel === "mirror") {
          setFrame(parsed as MirrorSnapshotFrame);
          setStatus("open");
        }
        if (parsed.type === "connected") {
          setStatus("open");
        }
      } catch {
        // drop malformed frame
      }
    });

    ws.addEventListener("close", () => {
      wsRef.current = null;
      setStatus("closed");
    });

    ws.addEventListener("error", () => {
      wsRef.current = null;
      setStatus("closed");
    });
  }, [deviceId]);

  const sendAction = useCallback((action: MirrorClientAction) => {
    const ws = wsRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(action));
  }, []);

  return { frame, status, sendAction, reconnect };
}
