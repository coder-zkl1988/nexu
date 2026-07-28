import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import type { OpenClawProcessManager } from "../src/runtime/openclaw-process.js";
import {
  LocalAutomationService,
  LocalAutomationUnavailableError,
  supportsPeekabooPlatform,
} from "../src/services/local-automation-service.js";
import type { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import type { NexuConfigStore } from "../src/store/nexu-config-store.js";
import type { LocalAutomationConfig } from "../src/store/schemas.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createHarness(
  initial: LocalAutomationConfig,
  backend: "peekaboo" | "cua-driver" = "peekaboo",
  options: {
    timing?: {
      cuaDaemonStartTimeoutMs: number;
      cuaDaemonPollIntervalMs: number;
    };
    platformSupported?: boolean;
    previewEnabled?: boolean;
    eventSynthesizingGranted?: boolean;
    bridgeSocket?: string | null;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "nexu-local-automation-"));
  roots.push(root);
  const binaryPath = path.join(root, backend);
  const extensionPath = path.join(
    root,
    "extensions",
    "browser",
    "chrome-extension",
  );
  await writeFile(binaryPath, "fixture");
  await mkdir(extensionPath, { recursive: true });

  let config = initial;
  const getLocalAutomationConfig = vi.fn(async () => config);
  const configStore = {
    getLocalAutomationConfig,
    setLocalAutomationConfig: vi.fn(
      async (patch: Partial<LocalAutomationConfig>) => {
        config = {
          browser: { ...config.browser, ...patch.browser },
          computerUse: { ...config.computerUse, ...patch.computerUse },
        };
        return config;
      },
    ),
  } as unknown as NexuConfigStore;
  const syncAll = vi.fn().mockResolvedValue({ configChanged: true });
  const restart = vi.fn().mockResolvedValue(undefined);
  const runCommand = vi.fn(
    async (_command: string, args: string[], _options: object) => {
      if (args[0] === "daemon" && args[1] === "status") {
        return {
          stdout: JSON.stringify({
            success: true,
            data: { running: true },
          }),
        };
      }
      if (args[0] === "permissions") {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              source: "bridge",
              permissions: [
                {
                  name: "Screen Recording",
                  isGranted: true,
                  isRequired: true,
                },
                {
                  name: "Accessibility",
                  isGranted: true,
                  isRequired: true,
                },
                {
                  name: "Event Synthesizing",
                  isGranted: options.eventSynthesizingGranted ?? true,
                  isRequired: false,
                },
              ],
            },
          }),
        };
      }
      return { stdout: JSON.stringify({ success: true }) };
    },
  );
  const unref = vi.fn();
  const kill = vi.fn(() => true);
  const once = vi.fn();
  const stdinEnd = vi.fn();
  const stdin = {
    end: stdinEnd,
    on: vi.fn(),
  };
  stdin.on.mockReturnValue(stdin);
  const startProcess = vi.fn(() => ({ kill, once, stdin, unref }));
  const env = {
    nexuHomeDir: root,
    localAutomationPreviewEnabled: options.previewEnabled ?? true,
    computerUseBackend: backend,
    computerUsePlatformSupported: options.platformSupported ?? true,
    computerUseBin: binaryPath,
    computerUseBridgeSocket:
      options.bridgeSocket === undefined
        ? path.join(root, "runtime", "daemon.sock")
        : options.bridgeSocket,
    computerUseCuaSocket: path.join(root, "runtime", "cua-driver.sock"),
    openclawBuiltinExtensionsDir: path.join(root, "extensions"),
    openclawBin: path.join(root, "openclaw.mjs"),
    openclawStateDir: path.join(root, "openclaw-state"),
    openclawConfigPath: path.join(root, "openclaw.json"),
  } as ControllerEnv;
  const service = new LocalAutomationService(
    env,
    configStore,
    { syncAll } as unknown as OpenClawSyncService,
    { restart } as unknown as OpenClawProcessManager,
    runCommand,
    startProcess,
    options.timing,
  );

  return {
    root,
    service,
    getConfig: () => config,
    getLocalAutomationConfig,
    runCommand,
    startProcess,
    kill,
    once,
    stdinEnd,
    unref,
    syncAll,
    restart,
    env,
  };
}

describe("LocalAutomationService", () => {
  it("fails closed outside preview while allowing stale settings to be disabled", async () => {
    const disabledHarness = await createHarness(
      {
        browser: { enabled: false },
        computerUse: { enabled: false },
      },
      "peekaboo",
      { previewEnabled: false },
    );

    await expect(
      disabledHarness.service.updateConfig({ browser: { enabled: true } }),
    ).rejects.toThrow("preview is disabled");
    await expect(
      disabledHarness.service.updateConfig({ computerUse: { enabled: true } }),
    ).rejects.toThrow("preview is disabled");
    await expect(
      disabledHarness.service.createBrowserPairing(),
    ).rejects.toThrow("preview is disabled");
    await expect(
      disabledHarness.service.requestAccessibilityPermission(),
    ).rejects.toThrow("preview is disabled");
    expect(disabledHarness.syncAll).not.toHaveBeenCalled();
    expect((await disabledHarness.service.getStatus()).previewEnabled).toBe(
      false,
    );

    const staleHarness = await createHarness(
      {
        browser: { enabled: true },
        computerUse: { enabled: true },
      },
      "peekaboo",
      { previewEnabled: false },
    );
    await staleHarness.service.prepare();
    await staleHarness.service.updateConfig({
      browser: { enabled: false },
      computerUse: { enabled: false },
    });

    expect(staleHarness.getConfig()).toEqual({
      browser: { enabled: false },
      computerUse: { enabled: false },
    });
    expect(staleHarness.startProcess).not.toHaveBeenCalled();
  });

  it("fails closed when the Preview capability flag is absent", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: false },
    });
    Reflect.deleteProperty(harness.env, "localAutomationPreviewEnabled");

    await expect(
      harness.service.updateConfig({ browser: { enabled: true } }),
    ).rejects.toThrow("preview is disabled");
    expect((await harness.service.getStatus()).previewEnabled).toBe(false);
  });

  it("reads OpenClaw browser pairing JSON from stderr", async () => {
    const harness = await createHarness({
      browser: { enabled: true },
      computerUse: { enabled: false },
    });
    harness.runCommand.mockResolvedValueOnce({
      stdout: "",
      stderr: JSON.stringify({
        pairingString: "ws://127.0.0.1:18792/extension#secret",
        relayPort: 18792,
        remote: false,
      }),
    });

    await expect(harness.service.createBrowserPairing()).resolves.toEqual({
      pairingString: "ws://127.0.0.1:18792/extension#secret",
      relayPort: 18792,
    });
  });

  it("rejects invalid browser pairing output without echoing it", async () => {
    const harness = await createHarness({
      browser: { enabled: true },
      computerUse: { enabled: false },
    });
    harness.runCommand.mockResolvedValueOnce({
      stdout: "",
      stderr: "invalid-secret-bearing-output",
    });

    await expect(harness.service.createBrowserPairing()).rejects.toThrow(
      "OpenClaw returned invalid browser pairing data",
    );
  });

  it("redacts pairing output when the OpenClaw command fails", async () => {
    const harness = await createHarness({
      browser: { enabled: true },
      computerUse: { enabled: false },
    });
    const secret = "ws://127.0.0.1:18792/extension#pairing-secret";
    harness.runCommand.mockRejectedValueOnce(
      new Error(`Command failed with stderr: ${secret}`),
    );

    const error: unknown = await harness.service.createBrowserPairing().then(
      () => null,
      (pairingError: unknown) => pairingError,
    );

    expect(error).toBeInstanceOf(LocalAutomationUnavailableError);
    if (!(error instanceof Error)) {
      throw new Error("Expected browser pairing to reject with an Error");
    }
    expect(error.message).toBe("OpenClaw browser pairing failed");
    expect(error.message).not.toContain(secret);
  });

  it("starts Peekaboo before enabling MCP and restarts OpenClaw", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: false },
    });
    const socketDirectory = path.join(harness.root, "runtime");
    await mkdir(socketDirectory);
    await chmod(socketDirectory, 0o755);

    const next = await harness.service.updateConfig({
      computerUse: { enabled: true },
    });

    expect(next.computerUse.enabled).toBe(true);
    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["daemon", "start"]),
      expect.any(Object),
    );
    expect((await stat(socketDirectory)).mode & 0o777).toBe(0o700);
    expect(harness.syncAll).toHaveBeenCalledOnce();
    expect(harness.restart).toHaveBeenCalledWith("local-automation-changed");
  });

  it("rejects a symlinked Peekaboo socket directory", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: false },
    });
    const targetDirectory = path.join(harness.root, "socket-target");
    await mkdir(targetDirectory);
    await symlink(targetDirectory, path.join(harness.root, "runtime"), "dir");

    await expect(
      harness.service.updateConfig({ computerUse: { enabled: true } }),
    ).rejects.toThrow("Computer Use socket directory is unsafe");
    expect(harness.getConfig().computerUse.enabled).toBe(false);
  });

  it("stops a partially started Peekaboo daemon when enable fails", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: false },
    });
    harness.runCommand.mockRejectedValueOnce(new Error("startup timed out"));

    await expect(
      harness.service.updateConfig({ computerUse: { enabled: true } }),
    ).rejects.toThrow("startup timed out");

    expect(harness.getConfig().computerUse.enabled).toBe(false);
    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["daemon", "stop"]),
      expect.any(Object),
    );
    expect(harness.syncAll).not.toHaveBeenCalled();
  });

  it("reports an unavailable long runtime path without starting Peekaboo", async () => {
    const harness = await createHarness(
      {
        browser: { enabled: false },
        computerUse: { enabled: false },
      },
      "peekaboo",
      { bridgeSocket: null },
    );

    const status = await harness.service.getStatus();
    expect(status.computerUseAvailable).toBe(false);
    expect(status.computerUseUnavailableReason).toBe("runtime-path-too-long");
    await expect(
      harness.service.updateConfig({ computerUse: { enabled: true } }),
    ).rejects.toThrow("private bridge socket");
    await expect(harness.service.prepare()).resolves.toBeUndefined();
    expect(harness.runCommand).not.toHaveBeenCalled();
  });

  it("restores persisted config and stops the daemon when sync fails", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: false },
    });
    harness.syncAll
      .mockRejectedValueOnce(new Error("sync failed"))
      .mockResolvedValueOnce({ configChanged: true });

    await expect(
      harness.service.updateConfig({ computerUse: { enabled: true } }),
    ).rejects.toThrow("sync failed");

    expect(harness.getConfig().computerUse.enabled).toBe(false);
    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["daemon", "stop"]),
      expect.any(Object),
    );
    expect(harness.syncAll).toHaveBeenCalledTimes(2);
  });

  it("reports ready only when the dedicated Peekaboo bridge is running", async () => {
    const harness = await createHarness({
      browser: { enabled: true },
      computerUse: { enabled: true },
    });

    const status = await harness.service.getStatus();

    expect(status.browserExtensionAvailable).toBe(true);
    expect(status.computerUseAvailable).toBe(true);
    expect(status.computerUseUnavailableReason).toBeNull();
    expect(status.computerUsePermissionState).toBe("ready");
    expect(status.computerUsePermissions).toEqual([
      { name: "Screen Recording", granted: true, required: true },
      { name: "Accessibility", granted: true, required: true },
      { name: "Event Synthesizing", granted: true, required: true },
    ]);
  });

  it("requires Event Synthesizing before reporting input as ready", async () => {
    const harness = await createHarness(
      {
        browser: { enabled: false },
        computerUse: { enabled: true },
      },
      "peekaboo",
      { eventSynthesizingGranted: false },
    );

    const status = await harness.service.getStatus();

    expect(status.computerUsePermissionState).toBe("permission-required");
    expect(status.computerUsePermissions).toContainEqual({
      name: "Event Synthesizing",
      granted: false,
      required: true,
    });
  });

  it("requests Screen Recording permission through the dedicated Peekaboo bridge", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: true },
    });

    await harness.service.requestScreenRecordingPermission();

    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      [
        "permissions",
        "request-screen-recording",
        "--bridge-socket",
        expect.stringContaining("daemon.sock"),
        "--json",
      ],
      expect.objectContaining({
        env: expect.objectContaining({
          PEEKABOO_DAEMON_SOCKET: expect.stringContaining("daemon.sock"),
        }),
      }),
    );
  });

  it("requests Accessibility and background input from the signed Peekaboo process", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: true },
    });

    await harness.service.requestAccessibilityPermission();
    await harness.service.requestEventSynthesizingPermission();

    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      ["agent", "permission", "request-accessibility", "--no-remote", "--json"],
      expect.any(Object),
    );
    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      [
        "agent",
        "permission",
        "request-event-synthesizing",
        "--no-remote",
        "--json",
      ],
      expect.any(Object),
    );
  });

  it("reconciles the persisted switch during controller bootstrap", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: true },
    });

    await harness.service.prepare();

    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["daemon", "start"]),
      expect.any(Object),
    );
  });

  it("fails closed when bootstrap cannot start Computer Use and allows an explicit retry", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: true },
    });
    harness.runCommand.mockRejectedValueOnce(new Error("startup failed"));

    await harness.service.prepare();

    expect(harness.getConfig().computerUse.enabled).toBe(false);
    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["daemon", "stop"]),
      expect.any(Object),
    );
    expect(harness.syncAll).not.toHaveBeenCalled();

    await harness.service.updateConfig({ computerUse: { enabled: true } });

    expect(harness.getConfig().computerUse.enabled).toBe(true);
    expect(harness.syncAll).toHaveBeenCalledOnce();
  });

  it("starts and stops a dedicated CUA daemon before exposing its MCP proxy", async () => {
    const harness = await createHarness(
      {
        browser: { enabled: false },
        computerUse: { enabled: false },
      },
      "cua-driver",
    );
    harness.runCommand.mockRejectedValueOnce(new Error("not running"));

    await harness.service.updateConfig({ computerUse: { enabled: true } });

    expect(harness.startProcess).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        "serve",
        "--embedded",
        "--parent-liveness-stdio",
        "--socket",
        expect.stringContaining("cua-driver.sock"),
        "--permission-mode",
        "standard",
      ]),
      expect.objectContaining({
        detached: false,
        env: expect.objectContaining({
          CUA_DRIVER_EMBEDDED: "1",
          CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
        }),
        stdio: ["pipe", "ignore", "ignore"],
      }),
    );
    expect(harness.unref).not.toHaveBeenCalled();
    expect((await harness.service.getStatus()).computerUsePermissionState).toBe(
      "ready",
    );

    await harness.service.updateConfig({ computerUse: { enabled: false } });

    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      ["stop", "--socket", expect.stringContaining("cua-driver.sock")],
      expect.objectContaining({
        env: expect.objectContaining({
          CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
        }),
      }),
    );
    expect(harness.stdinEnd).toHaveBeenCalledOnce();
  });

  it("attempts an idempotent CUA stop even when status probing fails", async () => {
    const harness = await createHarness(
      {
        browser: { enabled: false },
        computerUse: { enabled: true },
      },
      "cua-driver",
    );
    harness.runCommand.mockImplementation(
      async (_command: string, args: string[]) => {
        if (args[0] === "status") {
          throw new Error("status timed out");
        }
        return { stdout: JSON.stringify({ success: true }) };
      },
    );

    await harness.service.stop();

    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      ["stop", "--socket", expect.stringContaining("cua-driver.sock")],
      expect.any(Object),
    );
  });

  it("replaces an unowned CUA daemon with a parent-bound process", async () => {
    const harness = await createHarness(
      {
        browser: { enabled: false },
        computerUse: { enabled: false },
      },
      "cua-driver",
    );

    await harness.service.updateConfig({ computerUse: { enabled: true } });

    const stopCallOrder = harness.runCommand.mock.invocationCallOrder.find(
      (_, index) => harness.runCommand.mock.calls[index]?.[1]?.[0] === "stop",
    );
    expect(stopCallOrder).toBeDefined();
    expect(stopCallOrder).toBeLessThan(
      harness.startProcess.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
    expect(harness.startProcess).toHaveBeenCalledOnce();
  });

  it("serializes concurrent automation updates so config and backend stay aligned", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: true },
    });
    let resolveFirstSync: ((value: { configChanged: boolean }) => void) | null =
      null;
    const firstSync = new Promise<{ configChanged: boolean }>((resolve) => {
      resolveFirstSync = resolve;
    });
    let syncCallCount = 0;
    harness.syncAll.mockImplementation(async () => {
      syncCallCount += 1;
      if (syncCallCount === 1) {
        return firstSync;
      }
      return { configChanged: true };
    });

    const disable = harness.service.updateConfig({
      computerUse: { enabled: false },
    });
    await vi.waitFor(() => {
      expect(harness.getConfig().computerUse.enabled).toBe(false);
    });
    expect(harness.getLocalAutomationConfig).toHaveBeenCalledTimes(1);
    const enable = harness.service.updateConfig({
      computerUse: { enabled: true },
    });
    expect(harness.getLocalAutomationConfig).toHaveBeenCalledTimes(1);
    resolveFirstSync?.({ configChanged: true });

    await Promise.all([disable, enable]);

    const daemonCommands = harness.runCommand.mock.calls
      .map((call) => call[1] as string[])
      .filter((args) => args[0] === "daemon");
    expect(harness.getConfig().computerUse.enabled).toBe(true);
    expect(daemonCommands.at(-1)?.[1]).toBe("start");
  });

  it("serializes permission requests with disable so the daemon stays stopped", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: true },
    });
    let releaseDaemonStart: (() => void) | null = null;
    const daemonStartGate = new Promise<void>((resolve) => {
      releaseDaemonStart = resolve;
    });
    let markDaemonStart: (() => void) | null = null;
    const daemonStartObserved = new Promise<void>((resolve) => {
      markDaemonStart = resolve;
    });
    const lifecycleEvents: string[] = [];
    harness.runCommand.mockImplementation(
      async (_command: string, args: string[]) => {
        if (args[0] === "daemon" && args[1] === "start") {
          lifecycleEvents.push("start-begin");
          markDaemonStart?.();
          await daemonStartGate;
          lifecycleEvents.push("start-complete");
        } else if (args[0] === "daemon" && args[1] === "stop") {
          lifecycleEvents.push("stop");
        } else if (args[0] === "permissions") {
          lifecycleEvents.push("permission");
        }
        return { stdout: JSON.stringify({ success: true }) };
      },
    );

    const permission = harness.service.requestScreenRecordingPermission();
    await daemonStartObserved;
    const disable = harness.service.updateConfig({
      computerUse: { enabled: false },
    });

    await Promise.resolve();
    expect(harness.getConfig().computerUse.enabled).toBe(true);
    releaseDaemonStart?.();
    await Promise.all([permission, disable]);

    expect(harness.getConfig().computerUse.enabled).toBe(false);
    expect(lifecycleEvents).toEqual([
      "start-begin",
      "start-complete",
      "permission",
      "stop",
    ]);
  });

  it("does not disable browser control while pairing is still in flight", async () => {
    const harness = await createHarness({
      browser: { enabled: true },
      computerUse: { enabled: false },
    });
    let releasePairing: (() => void) | null = null;
    const pairingGate = new Promise<void>((resolve) => {
      releasePairing = resolve;
    });
    let markPairingStarted: (() => void) | null = null;
    const pairingStarted = new Promise<void>((resolve) => {
      markPairingStarted = resolve;
    });
    harness.runCommand.mockImplementation(
      async (_command: string, args: string[]) => {
        if (args.includes("pair")) {
          markPairingStarted?.();
          await pairingGate;
          return {
            stdout: JSON.stringify({
              pairingString: "ws://127.0.0.1:18792/extension#secret",
              relayPort: 18792,
            }),
          };
        }
        return { stdout: JSON.stringify({ success: true }) };
      },
    );

    const pairing = harness.service.createBrowserPairing();
    await pairingStarted;
    const disable = harness.service.updateConfig({
      browser: { enabled: false },
    });

    await Promise.resolve();
    expect(harness.getConfig().browser.enabled).toBe(true);
    releasePairing?.();
    await expect(pairing).resolves.toEqual({
      pairingString: "ws://127.0.0.1:18792/extension#secret",
      relayPort: 18792,
    });
    await disable;
    expect(harness.getConfig().browser.enabled).toBe(false);
  });

  it("cleans up a CUA process that never becomes ready", async () => {
    const harness = await createHarness(
      {
        browser: { enabled: false },
        computerUse: { enabled: false },
      },
      "cua-driver",
      {
        timing: {
          cuaDaemonStartTimeoutMs: 20,
          cuaDaemonPollIntervalMs: 1,
        },
      },
    );
    harness.runCommand.mockRejectedValue(new Error("not running"));

    await expect(
      harness.service.updateConfig({ computerUse: { enabled: true } }),
    ).rejects.toThrow("did not become ready");

    expect(harness.runCommand).toHaveBeenCalledWith(
      expect.any(String),
      ["stop", "--socket", expect.stringContaining("cua-driver.sock")],
      expect.any(Object),
    );
    expect(harness.kill).toHaveBeenCalledWith("SIGTERM");
    expect(harness.getConfig().computerUse.enabled).toBe(false);
  });

  it("retries backend shutdown while keeping MCP access revoked", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: true },
    });
    harness.runCommand.mockRejectedValueOnce(new Error("stop failed"));

    await harness.service.updateConfig({ computerUse: { enabled: false } });

    expect(harness.getConfig().computerUse.enabled).toBe(false);
    expect(harness.syncAll).toHaveBeenCalledOnce();
    expect(harness.restart).toHaveBeenCalledWith("local-automation-changed");
    expect(harness.runCommand).toHaveBeenCalledTimes(2);
  });

  it("reports persistent backend shutdown failure without restoring MCP access", async () => {
    const harness = await createHarness({
      browser: { enabled: false },
      computerUse: { enabled: true },
    });
    harness.runCommand.mockRejectedValue(new Error("stop failed"));

    await expect(
      harness.service.updateConfig({ computerUse: { enabled: false } }),
    ).rejects.toThrow("backend could not be stopped");

    expect(harness.getConfig().computerUse.enabled).toBe(false);
    expect(harness.syncAll).toHaveBeenCalledOnce();
    expect(harness.restart).toHaveBeenCalledTimes(1);
    expect(harness.restart).toHaveBeenCalledWith("local-automation-changed");
    expect(harness.runCommand).toHaveBeenCalledTimes(2);

    harness.runCommand.mockResolvedValue({
      stdout: JSON.stringify({ success: true }),
    });
    await expect(
      harness.service.updateConfig({ computerUse: { enabled: false } }),
    ).resolves.toEqual({
      browser: { enabled: false },
      computerUse: { enabled: false },
    });

    expect(harness.getConfig().computerUse.enabled).toBe(false);
    expect(harness.restart).toHaveBeenCalledTimes(1);
    expect(harness.runCommand).toHaveBeenCalledTimes(3);
  });

  it("does not start or expose unsupported persisted Peekaboo config", async () => {
    const harness = await createHarness(
      {
        browser: { enabled: false },
        computerUse: { enabled: true },
      },
      "peekaboo",
      { platformSupported: false },
    );

    await harness.service.prepare();
    const status = await harness.service.getStatus();
    await harness.service.updateConfig({ computerUse: { enabled: false } });

    expect(status.computerUseUnavailableReason).toBe("unsupported-os");
    expect(harness.getConfig().computerUse.enabled).toBe(false);
    expect(harness.runCommand).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["daemon", "start"]),
      expect.any(Object),
    );
  });

  it("requires macOS 15 or later for Peekaboo", () => {
    expect(supportsPeekabooPlatform("darwin", "23.6.0")).toBe(false);
    expect(supportsPeekabooPlatform("darwin", "24.0.0")).toBe(true);
    expect(supportsPeekabooPlatform("win32", "10.0.0")).toBe(false);
  });
});
