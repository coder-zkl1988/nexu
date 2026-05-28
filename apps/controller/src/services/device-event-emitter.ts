import { EventEmitter } from "node:events";

export type DeviceChangeEvent = {
  type: "device_connected" | "device_disconnected" | "device_updated";
  deviceId: string;
};

class DeviceEventEmitter extends EventEmitter {
  private static instance: DeviceEventEmitter;

  static getInstance(): DeviceEventEmitter {
    if (!DeviceEventEmitter.instance) {
      DeviceEventEmitter.instance = new DeviceEventEmitter();
      DeviceEventEmitter.instance.setMaxListeners(100);
    }
    return DeviceEventEmitter.instance;
  }

  emitChange(event: DeviceChangeEvent): void {
    this.emit("change", event);
  }

  onChange(listener: (event: DeviceChangeEvent) => void): () => void {
    this.on("change", listener);
    return () => this.off("change", listener);
  }
}

export const deviceEventEmitter = DeviceEventEmitter.getInstance();
