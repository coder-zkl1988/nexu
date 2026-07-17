import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceControlService } from "../src/services/device-control-service.js";
import { DevicePollingService } from "../src/services/device-polling-service.js";
import type { DeviceTaskHistoryStore } from "../src/store/device-task-history-store.js";
import type { NexuConfigStore } from "../src/store/nexu-config-store.js";

const CREDENTIAL = {
  apiUrl: "https://link.example/v1/",
  apiKey: "sk-test",
  model: "tabby-phone",
  reasoningEffort: "low",
};

function makeService(
  getVlmGatewayCredential: () => Promise<typeof CREDENTIAL | null>,
) {
  const configStore = {
    getConfig: vi.fn().mockResolvedValue({ deviceControl: { rpcPort: 4310 } }),
    getVlmGatewayCredential: vi
      .fn()
      .mockImplementation(getVlmGatewayCredential),
    getDesktopCrashReportsEnabled: vi.fn().mockResolvedValue(true),
  } as unknown as NexuConfigStore;
  return new DeviceControlService(configStore, {
    append: vi.fn(),
  } as unknown as DeviceTaskHistoryStore);
}

describe("DeviceControlService.pushVlmCredential", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pushes the credential when the read succeeds", async () => {
    const service = makeService(async () => CREDENTIAL);
    await service.pushVlmCredential();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      method: "device_set_vlm_credential",
      params: { credential: CREDENTIAL },
    });
  });

  it("pushes null when the user is genuinely logged out", async () => {
    const service = makeService(async () => null);
    await service.pushVlmCredential();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.params).toEqual({ credential: null });
  });

  it("skips the push entirely when the credential read fails", async () => {
    // Regression: a transient config read failure must NOT clear the plugin's
    // good in-memory credential (observed as "VLM credential cleared" with no
    // login change, followed by hours of phones lacking a model credential).
    const service = makeService(async () => {
      throw new Error("config read failed");
    });
    await service.pushVlmCredential();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DevicePollingService desktop-state reconcile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makePollingService() {
    const deviceControlService = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listDevices: vi.fn().mockResolvedValue({ devices: [] }),
      pushVlmCredential: vi.fn().mockResolvedValue(undefined),
      pushTelemetryConsent: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DevicePollingService(
      deviceControlService as unknown as DeviceControlService,
    );
    return { service, deviceControlService };
  }

  it("re-pushes VLM credential and telemetry consent every 60s while online", async () => {
    const { service, deviceControlService } = makePollingService();
    service.start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(deviceControlService.pushVlmCredential).toHaveBeenCalledTimes(1);
    expect(deviceControlService.pushTelemetryConsent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(deviceControlService.pushVlmCredential).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  it("re-pushes immediately when the plugin comes back online", async () => {
    const { service, deviceControlService } = makePollingService();
    // Offline long enough to trip OFFLINE_THRESHOLD (3 checks x 10s).
    deviceControlService.isAvailable.mockResolvedValue(false);
    service.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deviceControlService.pushVlmCredential).not.toHaveBeenCalled();

    // Plugin comes back (e.g. OpenClaw restarted outside the controller) —
    // the next availability check should trigger a push without waiting for
    // the 60s reconcile tick.
    deviceControlService.isAvailable.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deviceControlService.pushVlmCredential).toHaveBeenCalledTimes(1);
    expect(deviceControlService.pushTelemetryConsent).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  it("skips the reconcile tick while the plugin is offline", async () => {
    const { service, deviceControlService } = makePollingService();
    deviceControlService.isAvailable.mockResolvedValue(false);
    service.start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(deviceControlService.pushVlmCredential).not.toHaveBeenCalled();

    service.dispose();
  });
});
