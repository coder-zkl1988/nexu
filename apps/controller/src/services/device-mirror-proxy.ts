import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { logger } from "../lib/logger.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

type Channel = "video" | "control" | "audio" | "unknown";

interface ParsedChannel {
  deviceId: string;
  channel: Channel;
  /**
   * Requested video fps, from a `?fps=` query param on the /mirror endpoint.
   * Only meaningful for channel "video" — undefined means "caller didn't specify,
   * use bridgeVideo's default." Lets callers distinguish a passive device-list
   * thumbnail (low fps) from an explicitly opened live mirror view (high fps) —
   * both hit the same /mirror endpoint and were previously indistinguishable.
   */
  fps?: number;
}

/**
 * Parse the request URL into { deviceId, channel, fps }.
 *
 * Expected paths:
 *   /api/v1/devices/{deviceId}/mirror   → video channel (optional ?fps=N)
 *   /api/v1/devices/{deviceId}/control  → control channel
 *
 * Returns null when the URL doesn't match either pattern.
 */
function parseChannel(url: string): ParsedChannel | null {
  const prefix = "/api/v1/devices/";
  if (!url.startsWith(prefix)) return null;

  const queryIdx = url.indexOf("?");
  const pathname = queryIdx === -1 ? url : url.slice(0, queryIdx);
  const query = queryIdx === -1 ? "" : url.slice(queryIdx + 1);
  const fpsParam = new URLSearchParams(query).get("fps");
  const fps =
    fpsParam !== null && Number.isFinite(Number(fpsParam))
      ? Number(fpsParam)
      : undefined;

  const rest = pathname.slice(prefix.length);

  if (rest.endsWith("/mirror")) {
    const deviceId = rest.slice(0, rest.length - "/mirror".length);
    if (deviceId === "" || deviceId.includes("/")) return null;
    return { deviceId, channel: "video", fps };
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

/** Marker every mirror-channel text frame starts with. */
const MIRROR_CHANNEL_MARKER = '"channel":"mirror"';

/**
 * Only the head of the payload is scanned. STABLE's JPEG-over-JSON fallback
 * frames are hundreds of KB of base64; decoding one in full just to classify it
 * is exactly the cost this check exists to avoid.
 */
const MIRROR_MARKER_SCAN_BYTES = 64;

/**
 * True when a TEXT frame belongs to the video (mirror) channel rather than the
 * control channel.
 *
 * The plugin emits every mirror-channel message as `{"channel":"mirror",…}`
 * (tabby-control `ws-server.ts` always puts `channel` first and spreads the
 * payload after it), while control traffic is either binary or a channel-less
 * `{"type":"error",…}`.
 *
 * Fails OPEN: if the marker is not found within the scanned head the frame is
 * treated as a control message and forwarded. Dropping a real control message
 * would be worse than forwarding a video frame.
 */
export function isMirrorChannelTextFrame(data: string | Buffer): boolean {
  const head =
    typeof data === "string"
      ? data.slice(0, MIRROR_MARKER_SCAN_BYTES)
      : data.subarray(0, MIRROR_MARKER_SCAN_BYTES).toString("utf8");
  return head.includes(MIRROR_CHANNEL_MARKER);
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
 * endpoint. The control bridge therefore sees the video channel's traffic too,
 * and filters it out — binary H.264 by frame type, and mirror-channel TEXT
 * frames (STABLE's JPEG-over-JSON fallback) by `isMirrorChannelTextFrame`.
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

    const { deviceId, channel, fps } = parsed;

    this.wss.handleUpgrade(req, socket, head, (clientWs) => {
      if (channel === "video") {
        void this.bridgeVideo(clientWs, deviceId, fps);
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
   *   - Subscribes with `{ deviceId, fps }` — fps defaults to 30 (full live-view
   *     quality) unless the caller passed a lower value via `?fps=` on the
   *     upgrade URL (e.g. the device-list thumbnail asks for a cheap low-fps
   *     preview so the phone doesn't need to treat it as a real mirror-view
   *     open request)
   *   - Forwards ALL upstream messages (binary H.264 frames + JSON notifications) to client
   *   - Ignores client messages (they go through the control channel)
   */
  private async bridgeVideo(
    clientWs: WebSocket,
    deviceId: string,
    fps?: number,
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
      upstream.send(
        JSON.stringify({ deviceId, fps: fps ?? 30, adaptive: true }),
      );
    });

    // Forward upstream→client:
    //   - Text frames → forward as text (JSON notifications AND STABLE-mode
    //     JPEG frames — the phone streams `{"channel":"mirror","type":"realtime",
    //     "screenshot":...}` as WS text when it has no MediaProjection)
    //   - Binary frames: only forward H.264 video (frameType 0x01, always >100B)
    //     Skip CLIPBOARD (0x00), audio (0x02), and small 0x01 frames (ACK device messages)
    //     — those belong on the control/audio channels
    //
    // Text detection MUST use the isBinary flag: the Node `ws` library never
    // delivers text frames as JS strings (they arrive as Buffer/ArrayBuffer
    // like everything else), so a `typeof data === "string"` check silently
    // classifies every JSON frame as binary — and its first byte '{' (0x7B)
    // then fails the 0x01 H.264 filter, dropping the entire STABLE stream.
    upstream.on("message", (data, isBinary) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      if (!isBinary) {
        // Re-send as a string so the browser receives a TEXT frame — sending
        // the raw Buffer would flip it to binary and break the client's
        // `event.data instanceof ArrayBuffer` H.264-vs-JSON dispatch.
        const text =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Buffer.from(data as ArrayBuffer).toString("utf8");
        clientWs.send(text);
        return;
      }
      if (
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
    //   - Text frames → forward as text (JSON notifications). Detected via the
    //     isBinary flag — the `ws` library never delivers text frames as JS
    //     strings, so a typeof check would misroute them into the binary filter.
    //   - Binary frames with frameType === 0x02 (audio/Opus) → forward
    //   - Other binary frames → discard
    upstream.on("message", (data, isBinary) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      if (!isBinary) {
        const text =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Buffer.from(data as ArrayBuffer).toString("utf8");
        clientWs.send(text);
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
    //   - Text frames → forward as text (JSON device messages). Detected via
    //     the isBinary flag — the `ws` library never delivers text frames as
    //     JS strings, so a typeof check would misroute them into the binary
    //     filter and drop them.
    //     Mirror-channel text frames are skipped: the upstream is the plugin's
    //     single /mirror socket, so this bridge also sees STABLE's
    //     JPEG-over-JSON video fallback. Those belong to the video bridge —
    //     forwarding them here would make the browser JSON.parse a few hundred
    //     KB of base64 per frame only for useMirrorControl to drop it, on the
    //     exact awaiting-authorization path that is already the slowest.
    //   - Binary frames: use byte-0 frameType + size to distinguish device control from video
    //     - CLIPBOARD (0x00): always forward regardless of size
    //     - ACK (0x01): only if small (<100B) — video frames also start with 0x01 but are always large
    //   - Large binary frames >100B with 0x01 → discard (video goes through video bridge)
    upstream.on("message", (data, isBinary) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      if (!isBinary) {
        // Classify before decoding: isMirrorChannelTextFrame only reads the head.
        const payload =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data as ArrayBuffer);
        if (isMirrorChannelTextFrame(payload)) return;
        clientWs.send(
          typeof payload === "string" ? payload : payload.toString("utf8"),
        );
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
    //     Detected via the isBinary flag — `ws` delivers browser TEXT frames
    //     as Buffers, so a typeof check would misroute JSON actions (input_text,
    //     swipe, set_clipboard...) into the raw-binary passthrough.
    //   - Binary → forward as-is (binary control protocol frames).
    //     tabby-control will forward them to the Android device.
    clientWs.on("message", (raw, isBinary) => {
      if (upstream.readyState !== WebSocket.OPEN) {
        logger.warn(
          { deviceId, upstreamState: upstream.readyState },
          "control bridge: client msg DROPPED — upstream not OPEN",
        );
        return;
      }

      if (!isBinary) {
        try {
          const text =
            typeof raw === "string"
              ? raw
              : Buffer.isBuffer(raw)
                ? raw.toString("utf8")
                : Buffer.from(raw as ArrayBuffer).toString("utf8");
          const parsed: Record<string, unknown> = JSON.parse(text);
          upstream.send(
            JSON.stringify({
              channel: "mirror",
              type: parsed.type,
              deviceId,
              params: parsed,
            }),
          );
          logger.debug(
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
        logger.debug(
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
