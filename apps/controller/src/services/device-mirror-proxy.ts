import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { logger } from "../lib/logger.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

type Channel = "video" | "control" | "audio" | "unknown";

interface ParsedChannel {
  deviceId: string;
  channel: Channel;
}

/**
 * Parse the request URL into { deviceId, channel }.
 *
 * Expected paths:
 *   /api/v1/devices/{deviceId}/mirror   → video channel
 *   /api/v1/devices/{deviceId}/control  → control channel
 *
 * Returns null when the URL doesn't match either pattern.
 */
function parseChannel(url: string): ParsedChannel | null {
  const prefix = "/api/v1/devices/";
  if (!url.startsWith(prefix)) return null;

  const rest = url.slice(prefix.length);

  if (rest.endsWith("/mirror")) {
    const deviceId = rest.slice(0, rest.length - "/mirror".length);
    if (deviceId === "" || deviceId.includes("/")) return null;
    return { deviceId, channel: "video" };
  }

  if (rest.endsWith("/control")) {
    const deviceId = rest.slice(0, rest.length - "/control".length);
    if (deviceId === "" || deviceId.includes("/")) return null;
    return { deviceId, channel: "control" };
  }

  if (rest.endsWith("/audio")) {
    const deviceId = rest.slice(0, rest.length - "/audio".length);
    if (deviceId === "" || deviceId.includes("/")) return null;
    return { deviceId, channel: "audio" };
  }

  return null;
}

/**
 * DeviceMirrorProxy manages WebSocket connections between the Nexu web frontend
 * and the upstream tabby-control plugin (port 18790 by default).
 *
 * It provides two separate endpoints per device:
 *   - `/mirror`  → video frames (binary H.264, server→client only)
 *   - `/control` → control messages (bidirectional JSON/binary)
 *
 * Upstream, both channels connect to the tabby-control plugin's single `/mirror`
 * endpoint. The control bridge filters out binary (video) frames so they only
 * flow through the video bridge.
 */
export class DeviceMirrorProxy {
  private readonly wss: WebSocketServer;

  constructor(private readonly configStore: NexuConfigStore) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  /**
   * Attempt to handle an HTTP upgrade request.
   * Returns `true` if the URL matched a known channel (regardless of success),
   * or `false` if the URL was not recognized (caller should let other handlers try).
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = req.url ?? "";
    const parsed = parseChannel(url);
    if (parsed === null) return false;

    const { deviceId, channel } = parsed;

    this.wss.handleUpgrade(req, socket, head, (clientWs) => {
      if (channel === "video") {
        void this.bridgeVideo(clientWs, deviceId);
      } else if (channel === "audio") {
        void this.bridgeAudio(clientWs, deviceId);
      } else {
        void this.bridgeControl(clientWs, deviceId);
      }
    });
    return true;
  }

  /**
   * Bridge the video stream:
   *   - Connects upstream to the tabby-control `/mirror` endpoint
   *   - Subscribes with `{ deviceId, fps: 30 }`
   *   - Forwards ALL upstream messages (binary H.264 frames + JSON notifications) to client
   *   - Ignores client messages (they go through the control channel)
   */
  private async bridgeVideo(
    clientWs: WebSocket,
    deviceId: string,
  ): Promise<void> {
    const config = await this.configStore.getConfig();
    if (!config.deviceControl.enabled) {
      clientWs.close(4404, "Device control disabled");
      return;
    }

    const upstream = new WebSocket(
      `ws://127.0.0.1:${config.deviceControl.wsPort}/mirror`,
    );
    upstream.binaryType = "arraybuffer";

    upstream.on("open", () => {
      // Subscribe to mirror stream for this device
      upstream.send(JSON.stringify({ deviceId, fps: 30, adaptive: true }));
    });

    // Forward upstream→client:
    //   - String messages → forward as-is (JSON notifications)
    //   - Binary frames: only forward H.264 video (frameType 0x01, always >100B)
    //     Skip CLIPBOARD (0x00), audio (0x02), and small 0x01 frames (ACK device messages)
    //     — those belong on the control/audio channels
    upstream.on("message", (data) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      if (typeof data === "string") {
        clientWs.send(data);
      } else if (
        (Buffer.isBuffer(data) || data instanceof ArrayBuffer) &&
        (Buffer.isBuffer(data) ? data : Buffer.from(data)).length > 0
      ) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf[0] === 0x01 && buf.length > 100) {
          clientWs.send(data);
        }
      }
    });

    // Video channel is downstream-only; discard any client messages
    clientWs.on("message", () => {
      // Discard — video channel doesn't accept upstream messages
    });

    const teardown = (): void => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    clientWs.on("close", teardown);
    clientWs.on("error", teardown);
    upstream.on("close", teardown);
    upstream.on("error", teardown);
  }

  /**
   * Bridge the audio stream:
   *   - Connects upstream to the tabby-control `/mirror` endpoint
   *   - Subscribes with `{ deviceId, audio: true }`
   *   - From upstream:
   *     - String messages → forward as-is (JSON notifications)
   *     - Binary frames with `frameType === 0x02` (audio/Opus) → forward to client
   *     - Binary frames with `frameType !== 0x02` (video, etc.) → discard
   *   - Client messages are discarded (audio is receive-only)
   */
  private async bridgeAudio(
    clientWs: WebSocket,
    deviceId: string,
  ): Promise<void> {
    const config = await this.configStore.getConfig();
    if (!config.deviceControl.enabled) {
      clientWs.close(4404, "Device control disabled");
      return;
    }

    const upstream = new WebSocket(
      `ws://127.0.0.1:${config.deviceControl.wsPort}/mirror`,
    );
    upstream.binaryType = "arraybuffer";

    upstream.on("open", () => {
      upstream.send(JSON.stringify({ deviceId, audio: true }));
    });

    // Forward upstream→client:
    //   - String messages → forward as-is (JSON notifications)
    //   - Binary frames with frameType === 0x02 (audio/Opus) → forward
    //   - Other binary frames → discard
    upstream.on("message", (data) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      if (typeof data === "string") {
        clientWs.send(data);
      } else if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        // Binary frame: byte 0 is frameType (0x02 = Opus audio)
        if (buf.length > 0 && buf[0] === 0x02) {
          clientWs.send(data);
        }
        // All other binary frames (video, etc.) — discard
      }
    });

    // Audio channel is receive-only; discard any client messages
    clientWs.on("message", () => {
      // Discard — audio channel doesn't accept upstream messages
    });

    const teardown = (): void => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    clientWs.on("close", teardown);
    clientWs.on("error", teardown);
    upstream.on("close", teardown);
    upstream.on("error", teardown);
  }

  /**
   * Bridge the control channel:
   *   - Connects upstream to the tabby-control `/mirror` endpoint
   *   - Subscribes with `{ deviceId }`
   *   - Client→upstream: JSON actions wrapped in `{ channel: "mirror", type, params }`
   *   - Upstream→client:
   *     - Text (JSON) → forwarded as-is (device messages: clipboard, acks)
   *     - Small binary frames (clipboard/ack) → forwarded
   *     - Large binary frames → discarded (video goes through video bridge)
   */
  private async bridgeControl(
    clientWs: WebSocket,
    deviceId: string,
  ): Promise<void> {
    const config = await this.configStore.getConfig();
    if (!config.deviceControl.enabled) {
      clientWs.close(4404, "Device control disabled");
      return;
    }

    const upstream = new WebSocket(
      `ws://127.0.0.1:${config.deviceControl.wsPort}/mirror`,
    );
    upstream.binaryType = "arraybuffer";

    upstream.on("open", () => {
      upstream.send(JSON.stringify({ deviceId }));
    });

    // Forward upstream→client:
    //   - String messages → forward as-is (JSON device messages)
    //   - Binary frames: use byte-0 frameType + size to distinguish device control from video
    //     - CLIPBOARD (0x00): always forward regardless of size
    //     - ACK (0x01): only if small (<100B) — video frames also start with 0x01 but are always large
    //   - Large binary frames >100B with 0x01 → discard (video goes through video bridge)
    upstream.on("message", (data) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      if (typeof data === "string") {
        // JSON device messages — forward
        clientWs.send(data);
      } else if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
        const buf = data instanceof ArrayBuffer ? Buffer.from(data) : data;
        if (buf.length > 0) {
          const frameType = buf[0];
          // Forward binary device control messages:
          //   - CLIPBOARD (0x00): always forward regardless of size
          //   - ACK (0x01): only if small (<100B) — video frames also start with 0x01 but are always large
          if (frameType === 0x00 || (frameType === 0x01 && buf.length < 100)) {
            clientWs.send(buf);
          }
        }
      }
    });

    // Forward client→upstream: control actions
    //   - Text (JSON) → wrapped in channel envelope and sent upstream
    //     tabby-control expects: { channel: "mirror", type, deviceId, params }
    //   - Binary → forward as-is (binary control protocol frames).
    //     tabby-control will forward them to the Android device.
    clientWs.on("message", (raw) => {
      if (upstream.readyState !== WebSocket.OPEN) {
        logger.warn(
          { deviceId, upstreamState: upstream.readyState },
          "control bridge: client msg DROPPED — upstream not OPEN",
        );
        return;
      }

      if (typeof raw === "string") {
        try {
          const parsed: Record<string, unknown> = JSON.parse(raw);
          upstream.send(
            JSON.stringify({
              channel: "mirror",
              type: parsed.type,
              deviceId,
              params: parsed,
            }),
          );
          logger.info(
            { deviceId, type: parsed.type },
            "control bridge: text action → upstream",
          );
        } catch {
          // Drop malformed messages
        }
      } else {
        // Binary control frame — forward as-is (transparent bridge).
        // tabby-control will forward it to the Android device.
        const size = Buffer.isBuffer(raw)
          ? raw.length
          : (raw as ArrayBuffer).byteLength;
        const buf = Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw as ArrayBuffer);
        const firstByte = buf[0] ?? 0;
        // Decode touch events for diagnostic logging
        let detail = `firstByte=0x${firstByte.toString(16).padStart(2, "0")}`;
        if (firstByte === 0x03 && size >= 36) {
          // INJECT_TOUCH_EVENT (0x03)
          const touchAction = buf[1] ?? -1; // 0=DOWN, 1=UP, 2=MOVE
          const actionNames = ["DOWN", "UP", "MOVE"] as const;
          const pressure = buf.readUInt16LE(26);
          detail = `TOUCH ${actionNames[touchAction as 0 | 1 | 2] ?? touchAction} pressure=${pressure} size=${size}`;
        }
        logger.info(
          { deviceId, detail },
          "control bridge: binary frame → upstream",
        );
        upstream.send(raw);
      }
    });

    const teardown = (): void => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    clientWs.on("close", teardown);
    clientWs.on("error", teardown);
    upstream.on("close", teardown);
    upstream.on("error", teardown);
  }

  close(): void {
    this.wss.close();
  }
}
