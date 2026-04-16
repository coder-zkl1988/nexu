import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { mirrorClientActionSchema } from "@nexu/shared";
import { WebSocket, WebSocketServer } from "ws";
import { logger } from "../lib/logger.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

const MIRROR_PATH_PREFIX = "/api/v1/devices/";
const MIRROR_PATH_SUFFIX = "/mirror";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

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
    const isLoopback =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "::ffff:127.0.0.1";
    if (!isLoopback) {
      logger.warn({ remote, deviceId }, "rejected non-loopback mirror upgrade");
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

    const upstream = new WebSocket(
      `ws://127.0.0.1:${config.deviceControl.wsPort}/phone`,
    );

    upstream.on("open", () => {
      // Subscribe to mirror channel for this device (protocol per ws-server.ts)
      upstream.send(
        JSON.stringify({
          channel: "mirror",
          type: "subscribe",
          deviceId,
        }),
      );
    });

    upstream.on("message", (data) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      // Forward raw frames; browser decodes JSON and filters by channel === "mirror".
      clientWs.send(data);
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
