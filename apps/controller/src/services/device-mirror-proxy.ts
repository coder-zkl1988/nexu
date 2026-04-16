import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { mirrorClientActionSchema } from "@nexu/shared";
import { WebSocket, WebSocketServer } from "ws";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

const MIRROR_PATH_PREFIX = "/api/v1/devices/";
const MIRROR_PATH_SUFFIX = "/mirror";

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

    this.wss.handleUpgrade(req, socket, head, (clientWs) => {
      void this.bridge(clientWs, deviceId);
    });
    return true;
  }

  private async bridge(clientWs: WebSocket, deviceId: string): Promise<void> {
    const config = await this.configStore.getConfig();
    if (!config.deviceControl.enabled) {
      clientWs.close(4404, "Device control disabled");
      return;
    }

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
      } catch {
        // Silently drop malformed client frames.
      }
    });

    const teardown = () => {
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
