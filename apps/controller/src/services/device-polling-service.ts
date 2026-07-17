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
/**
 * How often to re-push desktop-owned state (VLM credential + telemetry
 * consent) to the plugin. The plugin holds this state in memory only, so any
 * OpenClaw restart the controller didn't initiate (tools/dev, manual kill,
 * crash) silently wipes it — this reconcile loop bounds that window.
 */
const DESKTOP_STATE_RECONCILE_INTERVAL_MS = 60_000;

export class DevicePollingService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private availabilityHandle: ReturnType<typeof setInterval> | null = null;
  private reconcileHandle: ReturnType<typeof setInterval> | null = null;
  private reconciling = false;
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

    // Periodic reconcile of desktop-owned plugin state (VLM credential +
    // telemetry consent) — see DESKTOP_STATE_RECONCILE_INTERVAL_MS.
    this.reconcileHandle = setInterval(() => {
      void this.reconcileDesktopState();
    }, DESKTOP_STATE_RECONCILE_INTERVAL_MS);
    this.reconcileHandle.unref?.();
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
    if (this.reconcileHandle) {
      clearInterval(this.reconcileHandle);
      this.reconcileHandle = null;
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
          // A comeback usually means OpenClaw restarted and the plugin lost
          // its in-memory desktop state — re-push right away instead of
          // waiting for the next reconcile tick.
          void this.reconcileDesktopState();
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

  private async reconcileDesktopState(): Promise<void> {
    if (this.disposed || this.reconciling) return;
    // Skip while the plugin is offline; the online-comeback path in
    // checkAvailability() pushes as soon as it is reachable again.
    if (!this.intervalHandle) return;
    this.reconciling = true;
    try {
      await this.deviceControlService.pushVlmCredential();
      await this.deviceControlService.pushTelemetryConsent();
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "device-polling-service: desktop state reconcile failed",
      );
    } finally {
      this.reconciling = false;
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
