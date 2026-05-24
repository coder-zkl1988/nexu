import { mirrorFrameHeaderSchema } from "@nexu/shared";
import type { MirrorClientAction, MirrorSnapshotFrame } from "@nexu/shared";
import mqtt from "mqtt";
import { useCallback, useEffect, useRef, useState } from "react";

type MirrorStatus = "connecting" | "open" | "closed";

function parseFrame(payload: Uint8Array): MirrorSnapshotFrame | null {
  const sepIdx = payload.indexOf(0x0a); // '\n'
  if (sepIdx < 0) return null;
  try {
    const headerJson = new TextDecoder().decode(payload.subarray(0, sepIdx));
    const header = mirrorFrameHeaderSchema.parse(JSON.parse(headerJson));
    const jpegBytes = payload.subarray(sepIdx + 1);
    let base64 = "";
    for (let i = 0; i < jpegBytes.length; i++) {
      base64 += String.fromCharCode(jpegBytes[i]);
    }
    return {
      channel: "mirror",
      type: "realtime",
      screenshot: btoa(base64),
      format: "jpeg",
      width: header.w,
      height: header.h,
      timestamp: header.ts,
      currentApp: header.app,
      deviceStatus: header.status,
    };
  } catch {
    return null;
  }
}

export function useMirrorSocket(
  deviceId: string | null,
  mqttHost?: string,
  mqttPort?: number,
) {
  const [frame, setFrame] = useState<MirrorSnapshotFrame | null>(null);
  const [status, setStatus] = useState<MirrorStatus>(
    deviceId === null ? "closed" : "connecting",
  );
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const cancelledRef = useRef(false);

  const host = mqttHost ?? window.location.hostname;
  const port = mqttPort ?? 18883;

  useEffect(() => {
    if (deviceId === null) {
      setFrame(null);
      setStatus("closed");
      clientRef.current = null;
      return;
    }

    cancelledRef.current = false;
    const url = `ws://${host}:${port}`;
    const client = mqtt.connect(url, {
      clientId: `nexu-mirror-${Date.now()}`,
      clean: true,
      connectTimeout: 5000,
    });
    clientRef.current = client;
    setStatus("connecting");

    // rAF-based frame dropping: only latest frame per animation frame
    let pendingFrame: MirrorSnapshotFrame | null = null;
    let rafId: number | null = null;

    function flushFrame() {
      rafId = null;
      if (pendingFrame !== null) {
        setFrame(pendingFrame);
        pendingFrame = null;
      }
    }

    client.on("connect", () => {
      if (cancelledRef.current) return;
      client.subscribe(`phone/${deviceId}/frame`, { qos: 0 });
    });

    client.on("message", (_topic: string, payload: Buffer) => {
      if (cancelledRef.current) return;
      const frame = parseFrame(new Uint8Array(payload));
      if (frame) {
        pendingFrame = frame;
        if (rafId === null) rafId = requestAnimationFrame(flushFrame);
        setStatus("open");
      }
    });

    client.on("close", () => {
      if (cancelledRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      pendingFrame = null;
      setStatus("closed");
    });

    client.on("error", () => {
      if (cancelledRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      pendingFrame = null;
      setStatus("closed");
    });

    return () => {
      cancelledRef.current = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      client.end();
      clientRef.current = null;
    };
  }, [deviceId, host, port]);

  const reconnect = useCallback(() => {
    if (deviceId === null) return;
    clientRef.current?.end();
    clientRef.current = null;

    cancelledRef.current = false;
    const url = `ws://${host}:${port}`;
    const client = mqtt.connect(url, {
      clientId: `nexu-mirror-${Date.now()}`,
      clean: true,
      connectTimeout: 5000,
    });
    clientRef.current = client;
    setStatus("connecting");

    let pendingFrame: MirrorSnapshotFrame | null = null;
    let rafId: number | null = null;

    function flushFrame() {
      rafId = null;
      if (pendingFrame !== null) {
        setFrame(pendingFrame);
        pendingFrame = null;
      }
    }

    client.on("connect", () => {
      if (cancelledRef.current) return;
      client.subscribe(`phone/${deviceId}/frame`, { qos: 0 });
    });

    client.on("message", (_topic: string, payload: Buffer) => {
      if (cancelledRef.current) return;
      const frame = parseFrame(new Uint8Array(payload));
      if (frame) {
        pendingFrame = frame;
        if (rafId === null) rafId = requestAnimationFrame(flushFrame);
        setStatus("open");
      }
    });

    client.on("close", () => {
      if (cancelledRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      setStatus("closed");
    });
    client.on("error", () => {
      if (cancelledRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      setStatus("closed");
    });
  }, [deviceId, host, port]);

  const sendAction = useCallback(
    (action: MirrorClientAction) => {
      const client = clientRef.current;
      if (client === null || !client.connected) return;
      client.publish(
        `phone/${deviceId}/mirror_cmd`,
        JSON.stringify({ type: action.type, params: action }),
        { qos: 0 },
      );
    },
    [deviceId],
  );

  return { frame, status, sendAction, reconnect };
}
