import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapController } from "../src/app/bootstrap.js";
import type { ControllerContainer } from "../src/app/container.js";

describe("bootstrapController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes external runtime config before connecting to the gateway", async () => {
    vi.useFakeTimers();

    const syncAllImmediate = vi.fn().mockResolvedValue({
      configPushed: true,
      configChanged: true,
    });
    const connect = vi.fn();
    const container = {
      runtimeState: { bootPhase: "idle" },
      env: {
        nexuHomeDir: "/tmp/nexu",
        openclawOwnershipMode: "external",
        openclawBaseUrl: "ws://127.0.0.1:18789",
        openclawConfigPath: "/tmp/openclaw.json",
        openclawStateDir: "/tmp/openclaw",
        openclawSkillsDir: "/tmp/openclaw/skills",
        openclawWorkspaceTemplatesDir: "/tmp/openclaw/templates",
        openclawLogDir: "/tmp/openclaw/logs",
        platformTemplatesDir: null,
      },
      openclawProcess: {
        prepare: vi.fn().mockResolvedValue(undefined),
        managesProcess: vi.fn().mockReturnValue(false),
        noteControlledRestartExpected: vi.fn(),
      },
      localAutomationService: {
        prepare: vi.fn().mockResolvedValue(undefined),
      },
      openclawSyncService: {
        ensureRuntimeModelPlugin: vi.fn().mockResolvedValue(undefined),
        syncAllImmediate,
        beginSettling: vi.fn(),
      },
      configStore: {
        prepareDesktopCloudModelsForBootstrap: vi
          .fn()
          .mockResolvedValue(undefined),
      },
      modelProviderService: {
        ensureValidDefaultModel: vi.fn().mockResolvedValue(undefined),
      },
      skillhubService: { bootstrap: vi.fn() },
      installDefaultExpertsFn: vi.fn().mockResolvedValue(undefined),
      channelFallbackService: { start: vi.fn() },
      wsClient: {
        onGatewayShutdown: vi.fn(),
        connect,
        isConnected: vi.fn().mockReturnValue(true),
      },
      controlPlaneHealth: {
        bootstrapProbe: vi.fn().mockResolvedValue({ ok: true }),
      },
      scheduleService: { bootstrap: vi.fn().mockResolvedValue(undefined) },
      startBackgroundLoops: vi.fn().mockReturnValue(() => {}),
    } as unknown as ControllerContainer;

    const bootstrap = bootstrapController(container);
    await vi.advanceTimersByTimeAsync(5_000);
    await bootstrap;

    expect(syncAllImmediate).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
    expect(syncAllImmediate.mock.invocationCallOrder[0]).toBeLessThan(
      connect.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
