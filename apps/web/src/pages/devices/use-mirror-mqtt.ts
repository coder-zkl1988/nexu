import { mirrorFrameHeaderSchema } from "@nexu/shared";
import type { MirrorClientAction, MirrorSnapshotFrame } from "@nexu/shared";
import mqtt from "mqtt";
import { useCallback, useEffect, useRef, useState } from "react";

type MirrorStatus = "connecting" | "open" | "closed";

function parseFrame(
  payload: Uint8Array,
  deviceId: string,
): MirrorSnapshotFrame | null {
  const sepIdx = payload.indexOf(0x0a); // '\n'
  if (sepIdx < 0) return null;
  try {
    const headerJson = new TextDecoder().decode(payload.subarray(0, sepIdx));
    const header = mirrorFrameHeaderSchema.parse(JSON.parse(headerJson));
    const jpegBytes = payload.subarray(sepIdx + 1);
    // Chunked binary→base64 to avoid O(n^2) string concat with per-byte +=
    const CHUNK = 8192;
    const parts: string[] = [];
    for (let i = 0; i < jpegBytes.length; i += CHUNK) {
      parts.push(String.fromCharCode(...jpegBytes.subarray(i, i + CHUNK)));
    }
    const screenshot = btoa(parts.join(""));
    return {
      channel: "mirror",
      type: "realtime",
      deviceId,
      screenshot,
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

type MqttClient = mqtt.MqttClient;

function startClient(
  host: string,
  port: number,
  deviceId: string,
  onFrame: (f: MirrorSnapshotFrame) => void,
  onStatus: (s: MirrorStatus) => void,
): { client: MqttClient; stop: () => void } {
  const url = `ws://${host}:${port}`;
  const client = mqtt.connect(url, {
    clientId: `nexu-mirror-${Date.now()}`,
    clean: true,
    connectTimeout: 5000,
  });
  onStatus("connecting");

  let pendingFrame: MirrorSnapshotFrame | null = null;
  let rafId: number | null = null;

  function flushFrame() {
    rafId = null;
    if (pendingFrame !== null) {
      onFrame(pendingFrame);
      pendingFrame = null;
    }
  }

  client.on("connect", () => {
    client.subscribe(`phone/${deviceId}/frame`, { qos: 0 });
  });

  client.on("message", (_topic: string, payload: Buffer) => {
    const frame = parseFrame(new Uint8Array(payload), deviceId);
    if (frame) {
      pendingFrame = frame;
      if (rafId === null) rafId = requestAnimationFrame(flushFrame);
      onStatus("open");
    }
  });

  client.on("close", () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    onStatus("closed");
  });

  client.on("error", () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    onStatus("closed");
  });

  return {
    client,
    stop: () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      client.end();
    },
  };
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
  const clientRef = useRef<MqttClient | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);

  const host = mqttHost ?? window.location.hostname;
  const port = mqttPort ?? 18883;

  const connect = useCallback(() => {
    if (deviceId === null) return;

    stopRef.current?.();
    cancelledRef.current = false;

    const { client, stop } = startClient(
      host,
      port,
      deviceId,
      setFrame,
      setStatus,
    );
    clientRef.current = client;
    stopRef.current = stop;
  }, [deviceId, host, port]);

  useEffect(() => {
    if (deviceId === null) {
      setFrame(null);
      setStatus("closed");
      clientRef.current = null;
      return;
    }

    connect();

    return () => {
      cancelledRef.current = true;
      stopRef.current?.();
      clientRef.current = null;
    };
  }, [deviceId, host, port, connect]);

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

  return { frame, status, sendAction, reconnect: connect };
}
