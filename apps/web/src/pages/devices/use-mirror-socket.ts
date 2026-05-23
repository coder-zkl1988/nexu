import type { MirrorClientAction, MirrorSnapshotFrame } from "@nexu/shared";
import { useCallback, useEffect, useRef, useState } from "react";

type MirrorStatus = "connecting" | "subscribing" | "open" | "closed";

function buildWsUrl(deviceId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/devices/${encodeURIComponent(deviceId)}/mirror`;
}

/**
 * Attach message listeners to a WebSocket. Returns a cleanup function.
 * Uses rAF-based frame dropping: only the latest mirror frame per
 * animation frame is committed to React state, so stale frames are
 * silently discarded instead of queuing up.
 */
function attachListeners(
  ws: WebSocket,
  onStatus: (s: MirrorStatus) => void,
  onFrame: (f: MirrorSnapshotFrame) => void,
  cancelledRef: { value: boolean },
) {
  let pendingFrame: MirrorSnapshotFrame | null = null;
  let rafId: number | null = null;

  function flushFrame() {
    rafId = null;
    if (pendingFrame !== null) {
      onFrame(pendingFrame);
      pendingFrame = null;
    }
  }

  function handleFrame(frame: MirrorSnapshotFrame) {
    pendingFrame = frame;
    if (rafId === null) {
      rafId = requestAnimationFrame(flushFrame);
    }
    // else: rAF already scheduled — just overwrite pendingFrame (drop the old one)
  }

  ws.addEventListener("open", () => {
    if (cancelledRef.value) return;
    onStatus("subscribing");
  });

  ws.addEventListener("message", (event) => {
    if (cancelledRef.value) return;
    if (typeof event.data !== "string") return;
    try {
      const parsed = JSON.parse(event.data) as {
        channel?: string;
        type?: string;
      };
      if (parsed.channel === "mirror") {
        handleFrame(parsed as MirrorSnapshotFrame);
        onStatus("open");
      }
      if (parsed.type === "connected") {
        onStatus("open");
      }
    } catch {
      // drop malformed frame
    }
  });

  ws.addEventListener("close", () => {
    if (cancelledRef.value) return;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingFrame = null;
    onStatus("closed");
  });

  ws.addEventListener("error", () => {
    if (cancelledRef.value) return;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingFrame = null;
    onStatus("closed");
  });

  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingFrame = null;
  };
}

export function useMirrorSocket(deviceId: string | null) {
  const [frame, setFrame] = useState<MirrorSnapshotFrame | null>(null);
  const [status, setStatus] = useState<MirrorStatus>(
    deviceId === null ? "closed" : "connecting",
  );
  const wsRef = useRef<WebSocket | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef<{ value: boolean }>({ value: false });

  useEffect(() => {
    if (deviceId === null) {
      setFrame(null);
      setStatus("closed");
      wsRef.current = null;
      return;
    }

    cancelledRef.current = { value: false };
    const url = buildWsUrl(deviceId);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    detachRef.current = attachListeners(
      ws,
      setStatus,
      setFrame,
      cancelledRef.current,
    );

    return () => {
      cancelledRef.current.value = true;
      detachRef.current?.();
      detachRef.current = null;
      ws.close();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [deviceId]);

  const reconnect = useCallback(() => {
    if (deviceId === null) return;

    // Clean up previous WebSocket and its listeners
    cancelledRef.current.value = true;
    detachRef.current?.();

    const oldWs = wsRef.current;
    if (oldWs) {
      oldWs.close();
      wsRef.current = null;
    }

    const url = buildWsUrl(deviceId);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    cancelledRef.current = { value: false };
    detachRef.current = attachListeners(
      ws,
      setStatus,
      setFrame,
      cancelledRef.current,
    );
  }, [deviceId]);

  const sendAction = useCallback((action: MirrorClientAction) => {
    const ws = wsRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(action));
  }, []);

  return { frame, status, sendAction, reconnect };
}
