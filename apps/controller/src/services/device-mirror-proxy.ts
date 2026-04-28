import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { mirrorClientActionSchema } from "@nexu/shared";
import { WebSocket, WebSocketServer } from "ws";
import { logger } from "../lib/logger.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

const MIRROR_PATH_PREFIX = "/api/v1/devices/";
const MIRROR_PATH_SUFFIX = "/mirror";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function isPrivateAddress(remote: string): boolean {
  if (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1"
  ) {
    return true;
  }
  // Accept RFC-1918 private addresses so that the Vite dev proxy
  // and desktop webview on the same LAN can reach mirror sessions.
  const ipv4 = remote.startsWith("::ffff:") ? remote.slice(7) : remote;
  return (
    ipv4.startsWith("192.168.") ||
    ipv4.startsWith("10.") ||
    ipv4 === "172.16.0.0" ||
    // 172.16.0.0/12 — check the full second octet range
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ipv4)
  );
}

export class DeviceMirrorProxy {
  private readonly wss: WebSocketServer;

  constructor(private readonly configStore: NexuConfigStore) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Attach HTTP server upgrade handler. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = req.url ?? "";
    if (
      !url.startsWith(MIRROR_PATH_PREFIX) ||
      !url.endsWith(MIRROR_PATH_SUFFIX)
    ) {
      return false;
    }
    const deviceId = url.slice(
      MIRROR_PATH_PREFIX.length,
      url.length - MIRROR_PATH_SUFFIX.length,
    );
    if (deviceId === "") {
      socket.destroy();
      return true;
    }
    if (!DEVICE_ID_PATTERN.test(deviceId)) {
      logger.warn({ deviceId }, "rejected mirror upgrade: invalid deviceId");
      socket.destroy();
      return true;
    }

    const remote = req.socket.remoteAddress ?? "";
    if (!isPrivateAddress(remote)) {
      logger.warn({ remote, deviceId }, "rejected non-private mirror upgrade");
      socket.destroy();
      return true;
    }

    this.wss.handleUpgrade(req, socket, head, (clientWs) => {
      void this.bridge(clientWs, deviceId);
    });
    return true;
  }

  private async bridge(clientWs: WebSocket, deviceId: string): Promise<void> {
    const config = await this.configStore.getConfig();
    if (!config.deviceControl.enabled) {
      logger.info(
        { deviceId },
        "mirror upgrade rejected: device control disabled",
      );
      clientWs.close(4404, "Device control disabled");
      return;
    }

    logger.info({ deviceId }, "mirror bridge opened");

    // Connect to the /mirror upgrade path on the device-control plugin.
    // The plugin uses `/phone` for device auth and `/mirror` for screen
    // mirror subscriptions.  Connecting to `/mirror` causes the plugin
    // to enter handleMirrorConnection which expects the first message
    // to contain { deviceId } to subscribe to that device's frames.
    const upstream = new WebSocket(
      `ws://127.0.0.1:${config.deviceControl.wsPort}/mirror`,
    );

    upstream.on("open", () => {
      // The /mirror handler expects the first message to carry the
      // deviceId of the device to subscribe to. Include fps hint so
      // the phone agent can adjust its screenshot interval.
      upstream.send(JSON.stringify({ deviceId, fps: 20 }));
    });

    upstream.on("message", (data) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      clientWs.send(typeof data === "string" ? data : data.toString());
    });

    clientWs.on("message", (raw) => {
      if (upstream.readyState !== WebSocket.OPEN) return;
      try {
        const parsed = JSON.parse(raw.toString());
        const action = mirrorClientActionSchema.parse(parsed);
        upstream.send(
          JSON.stringify({
            channel: "mirror",
            type: action.type,
            deviceId,
            params: action,
          }),
        );
      } catch (err) {
        logger.warn(
          {
            error: err instanceof Error ? err.message : String(err),
            deviceId,
          },
          "dropped malformed mirror client frame",
        );
      }
    });

    let torn = false;
    const teardown = (source: "client" | "upstream") => {
      if (torn) return;
      torn = true;
      logger.info({ deviceId, source }, "mirror bridge closed");
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    clientWs.on("close", () => teardown("client"));
    clientWs.on("error", () => teardown("client"));
    upstream.on("close", () => teardown("upstream"));
    upstream.on("error", (err) => {
      logger.warn(
        {
          error: err instanceof Error ? err.message : String(err),
          deviceId,
        },
        "mirror upstream error",
      );
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(4502, "Mirror upstream unavailable");
      }
    });
  }

  close(): void {
    this.wss.close();
  }
}
