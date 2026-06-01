import { logger } from "../lib/logger.js";
import type { DeviceControlService } from "./device-control-service.js";
import {
  type DeviceChangeEvent,
  deviceEventEmitter,
} from "./device-event-emitter.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const AVAILABILITY_CHECK_INTERVAL_MS = 10_000;
/** Consecutive failures before declaring the plugin offline. */
const OFFLINE_THRESHOLD = 3;

export class DevicePollingService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private availabilityHandle: ReturnType<typeof setInterval> | null = null;
  private previousDeviceIds = new Set<string>();
  private polling = false;
  private disposed = false;
  /** Consecutive isAvailable() failures — resets to 0 on success. */
  private consecutiveFailures = 0;

  constructor(
    private readonly deviceControlService: DeviceControlService,
    private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.intervalHandle) return;

    logger.info(
      { pollIntervalMs: this.pollIntervalMs },
      "device-polling-service: starting",
    );

    // Initial poll
    void this.poll();

    this.intervalHandle = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    this.intervalHandle.unref?.();

    // Separate slower check for plugin availability — starts/stops the main poll
    this.availabilityHandle = setInterval(() => {
      void this.checkAvailability();
    }, AVAILABILITY_CHECK_INTERVAL_MS);
    this.availabilityHandle.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.availabilityHandle) {
      clearInterval(this.availabilityHandle);
      this.availabilityHandle = null;
    }
    this.previousDeviceIds.clear();
    this.consecutiveFailures = 0;
    logger.info({}, "device-polling-service: stopped");
  }

  private async checkAvailability(): Promise<void> {
    if (this.disposed) return;
    try {
      const available = await this.deviceControlService.isAvailable();
      if (available) {
        this.consecutiveFailures = 0;
        if (!this.intervalHandle) {
          // Plugin came back — resume polling
          this.intervalHandle = setInterval(() => {
            void this.poll();
          }, this.pollIntervalMs);
          this.intervalHandle.unref?.();
          logger.debug(
            {},
            "device-polling-service: plugin online, resumed polling",
          );
        }
      } else {
        this.consecutiveFailures++;
        if (
          this.consecutiveFailures >= OFFLINE_THRESHOLD &&
          this.intervalHandle
        ) {
          // Plugin genuinely offline — stop polling, emit disconnected for known
          // devices. We emit BEFORE clearing so the set is still populated.
          for (const id of this.previousDeviceIds) {
            deviceEventEmitter.emitChange({
              type: "device_disconnected",
              deviceId: id,
            });
          }
          this.previousDeviceIds.clear();
          clearInterval(this.intervalHandle);
          this.intervalHandle = null;
          logger.debug(
            { consecutiveFailures: this.consecutiveFailures },
            "device-polling-service: plugin offline, paused polling",
          );
        }
      }
    } catch {
      // Treat exception as a failure — don't crash the timer loop.
      this.consecutiveFailures++;
      if (
        this.consecutiveFailures >= OFFLINE_THRESHOLD &&
        this.intervalHandle
      ) {
        for (const id of this.previousDeviceIds) {
          deviceEventEmitter.emitChange({
            type: "device_disconnected",
            deviceId: id,
          });
        }
        this.previousDeviceIds.clear();
        clearInterval(this.intervalHandle);
        this.intervalHandle = null;
        logger.debug(
          { consecutiveFailures: this.consecutiveFailures },
          "device-polling-service: plugin offline (exception path), paused polling",
        );
      }
    }
  }

  private async poll(): Promise<void> {
    if (this.polling || this.disposed) return;
    this.polling = true;
    try {
      // Availability is managed by checkAvailability() — no need to call
      // isAvailable() here. A stale poll after going offline is harmless; the
      // next checkAvailability() will clean up.
      const list = await this.deviceControlService.listDevices();
      const currentIds = new Set(list.devices.map((d) => d.deviceId));

      // Detect newly connected devices
      for (const id of currentIds) {
        if (!this.previousDeviceIds.has(id)) {
          const event: DeviceChangeEvent = {
            type: "device_connected",
            deviceId: id,
          };
          deviceEventEmitter.emitChange(event);
          logger.debug(
            { deviceId: id },
            "device-polling-service: device connected",
          );
        }
      }

      // Detect disconnected devices
      for (const id of this.previousDeviceIds) {
        if (!currentIds.has(id)) {
          const event: DeviceChangeEvent = {
            type: "device_disconnected",
            deviceId: id,
          };
          deviceEventEmitter.emitChange(event);
          logger.debug(
            { deviceId: id },
            "device-polling-service: device disconnected",
          );
        }
      }

      this.previousDeviceIds = currentIds;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "device-polling-service: poll failed",
      );
    } finally {
      this.polling = false;
    }
  }
}
