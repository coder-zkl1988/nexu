import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevicesPage } from "../src/pages/devices";

const apiMocks = vi.hoisted(() => ({
  getDevices: vi.fn(),
  getRuntimeConfig: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-desktop-cloud-status", () => ({
  useDesktopCloudStatus: () => ({
    data: { connected: true },
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-cloud-connect", () => ({
  useCloudConnect: () => ({
    cloudConnecting: false,
    handleCloudConnect: vi.fn(),
  }),
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Devices: (...args: unknown[]) => apiMocks.getDevices(...args),
  getApiV1RuntimeConfig: (...args: unknown[]) =>
    apiMocks.getRuntimeConfig(...args),
}));

vi.mock("../src/pages/devices/device-card", () => ({
  DeviceCard: ({ device }: { device: { deviceId: string } }) => (
    <div data-testid={`device-card-${device.deviceId}`} />
  ),
}));

vi.mock("../src/pages/devices/mirror-panel", () => ({
  MirrorPanel: () => <div data-testid="mirror-panel" />,
}));

/**
 * Stand-in for EventSource that can simulate the "zombie stream" failure mode:
 * the connection stays open from the browser's point of view but no events
 * (and no error) ever arrive — exactly what the dev Vite proxy leaves behind
 * when the controller dies mid-stream without closing the client socket.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  closed = false;

  private listeners = new Map<string, Array<(e: { data: string }) => void>>();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (e: { data: string }) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) {
      cb({ data: JSON.stringify(data) });
    }
  }
}

function renderDevicesPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DevicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  apiMocks.getRuntimeConfig.mockResolvedValue({ data: {} });
  apiMocks.getDevices.mockResolvedValue({
    data: { devices: [{ deviceId: "dev-1" }] },
  });
});

describe("DevicesPage device stream watchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("detects a silent (zombie) stream, reconnects, and applies the fresh snapshot", async () => {
    vi.useFakeTimers();
    renderDevicesPage();

    // Initial REST load renders the card.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("device-card-dev-1")).toBeTruthy();
    expect(FakeEventSource.instances.length).toBe(1);

    // Zombie period: the stream delivers nothing at all — no ping, no error.
    // The server pings every 15s, so >45s of silence means the stream is dead.
    // Advance past the 60s watchdog tick (45s is exactly at the threshold and
    // does not strictly exceed it).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(2);

    // The fresh connection re-delivers a device_list snapshot — the page
    // self-heals without a manual refresh.
    act(() => {
      FakeEventSource.instances[1]?.emit("device_list", { devices: [] });
    });
    expect(screen.queryByTestId("device-card-dev-1")).toBeNull();
  });

  it("keeps a healthy stream alive across ping cycles", async () => {
    vi.useFakeTimers();
    renderDevicesPage();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("device-card-dev-1")).toBeTruthy();

    // Deliver pings like the server does; the watchdog must not reconnect.
    for (let tick = 0; tick < 8; tick++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      act(() => {
        FakeEventSource.instances[0]?.emit("ping", {});
      });
    }

    expect(FakeEventSource.instances.length).toBe(1);
    expect(FakeEventSource.instances[0]?.closed).toBe(false);
    expect(screen.getByTestId("device-card-dev-1")).toBeTruthy();
  });
});
