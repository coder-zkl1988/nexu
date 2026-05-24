import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  mirrorClientActionSchema,
  mirrorFrameHeaderSchema,
} from "@nexu/shared";
import mqtt from "mqtt";
import { WebSocket, WebSocketServer } from "ws";
import { logger } from "../lib/logger.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

const MIRROR_PATH_PREFIX = "/api/v1/devices/";
const MIRROR_PATH_SUFFIX = "/mirror";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

const DEFAULT_MQTT_PORT = 18883;

function isPrivateAddress(remote: string): boolean {
  if (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1"
  ) {
    return true;
  }
  const ipv4 = remote.startsWith("::ffff:") ? remote.slice(7) : remote;
  return (
    ipv4.startsWith("192.168.") ||
    ipv4.startsWith("10.") ||
    ipv4 === "172.16.0.0" ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ipv4)
  );
}

export class DeviceMirrorProxy {
  private readonly wss: WebSocketServer;
  private mqttClient: mqtt.MqttClient | null = null;
  private mqttPort: number = DEFAULT_MQTT_PORT;
  private connectingPromise: Promise<mqtt.MqttClient> | null = null;

  constructor(private readonly configStore: NexuConfigStore) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  private async ensureMqtt(): Promise<mqtt.MqttClient> {
    if (this.mqttClient?.connected) return this.mqttClient;
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = (async () => {
      const config = await this.configStore.getConfig();
      this.mqttPort = config.deviceControl.mqttPort ?? DEFAULT_MQTT_PORT;

      this.mqttClient = mqtt.connect(`mqtt://127.0.0.1:${this.mqttPort}`, {
        clientId: `nexu-mirror-${Date.now()}`,
        clean: true,
        connectTimeout: 5000,
      });

      return new Promise<mqtt.MqttClient>((resolve, reject) => {
        this.mqttClient!.once("connect", () => {
          this.connectingPromise = null;
          resolve(this.mqttClient!);
        });
        this.mqttClient!.once("error", (err) => {
          this.connectingPromise = null;
          reject(err);
        });
      });
    })();

    return this.connectingPromise;
  }

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
      clientWs.close(4404, "Device control disabled");
      return;
    }

    let mqtt: mqtt.MqttClient;
    try {
      mqtt = await this.ensureMqtt();
    } catch (err) {
      logger.error({ err }, "MQTT broker unavailable");
      clientWs.close(4502, "MQTT broker unavailable");
      return;
    }

    logger.info({ deviceId }, "MQTT mirror bridge opened");

    const frameTopic = `phone/${deviceId}/frame`;
    const cmdTopic = `phone/${deviceId}/mirror_cmd`;

    mqtt.subscribe(frameTopic, { qos: 0 });

    const handleFrame = (_topic: string, payload: Buffer) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;

      // Split JSON header \n JPEG binary
      const sepIdx = payload.indexOf(0x0a); // '\n'
      if (sepIdx < 0) return;

      try {
        const headerJson = payload.subarray(0, sepIdx).toString();
        const header = mirrorFrameHeaderSchema.parse(JSON.parse(headerJson));
        const jpegBytes = payload.subarray(sepIdx + 1);

        clientWs.send(
          JSON.stringify({
            channel: "mirror",
            type: "realtime",
            screenshot: jpegBytes.toString("base64"),
            format: header.fmt || "jpeg",
            width: header.w,
            height: header.h,
            timestamp: header.ts,
            currentApp: header.app,
            deviceStatus: header.status,
          }),
        );
      } catch {
        // drop malformed frame
      }
    };

    mqtt.on("message", handleFrame);

    clientWs.on("message", (raw) => {
      if (!mqtt.connected) return;
      try {
        const parsed = JSON.parse(raw.toString());
        const action = mirrorClientActionSchema.parse(parsed);
        mqtt.publish(
          cmdTopic,
          JSON.stringify({
            type: action.type,
            params: action,
          }),
          { qos: 0 },
        );
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err), deviceId },
          "dropped malformed mirror client frame",
        );
      }
    });

    let torn = false;
    const teardown = (source: "client" | "mqtt") => {
      if (torn) return;
      torn = true;
      logger.info({ deviceId, source }, "MQTT mirror bridge closed");
      mqtt.off("message", handleFrame);
      mqtt.unsubscribe(frameTopic);
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    };
    clientWs.on("close", () => teardown("client"));
    clientWs.on("error", () => teardown("client"));
  }

  close(): void {
    this.wss.close();
    this.mqttClient?.end();
    this.mqttClient = null;
  }
}
