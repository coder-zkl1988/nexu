import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import type { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import { getOpenClawCommandSpec } from "../runtime/slimclaw-runtime-resolution.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { LocalAutomationConfig } from "../store/schemas.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

const execFileAsync = promisify(execFile);

type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout: number;
};

type CommandRunner = (
  command: string,
  args: string[],
  options: CommandOptions,
) => Promise<{ stdout: string; stderr?: string }>;

type ProcessStarter = (
  command: string,
  args: string[],
  options: {
    detached: false;
    env: NodeJS.ProcessEnv;
    stdio: ["pipe", "ignore", "ignore"];
    windowsHide: true;
  },
) => {
  stdin: {
    end(): void;
    on(event: "error", listener: (error: Error) => void): unknown;
  } | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): void;
};

export type LocalAutomationTiming = {
  cuaDaemonStartTimeoutMs: number;
  cuaDaemonPollIntervalMs: number;
};

const defaultCommandRunner: CommandRunner = async (command, args, options) => {
  const result = await execFileAsync(command, args, options);
  return { stdout: result.stdout, stderr: result.stderr };
};

const defaultProcessStarter: ProcessStarter = (command, args, options) =>
  spawn(command, args, options);

const CUA_DAEMON_START_TIMEOUT_MS = 10_000;
const CUA_DAEMON_POLL_INTERVAL_MS = 250;
const COMPUTER_USE_STOP_ATTEMPTS = 2;
const DEFAULT_LOCAL_AUTOMATION_TIMING: LocalAutomationTiming = {
  cuaDaemonStartTimeoutMs: CUA_DAEMON_START_TIMEOUT_MS,
  cuaDaemonPollIntervalMs: CUA_DAEMON_POLL_INTERVAL_MS,
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// `cua-driver permissions status --json`. The booleans reflect the daemon's own
// TCC identity (com.trycua.driver), which is why the daemon must already be
// running: asked from this process the answer would describe the controller,
// not the driver. `daemon_running: false` comes back with `status: "unknown"`
// and no booleans, so both shapes have to parse.
const cuaPermissionStatusSchema = z.object({
  accessibility: z.boolean().optional(),
  screen_recording: z.boolean().optional(),
  daemon_running: z.boolean().optional(),
  status: z.string().optional(),
});

const browserPairingResponseSchema = z.object({
  pairingString: z.string().min(1),
  relayPort: z.number().int().positive(),
});

export type ComputerUsePermissionState =
  | "ready"
  | "permission-required"
  | "unavailable"
  | "unknown"
  | "disabled";

export type ComputerUseUnavailableReason = "missing-sidecar" | "unsupported-os";

export type LocalAutomationStatus = {
  previewEnabled: boolean;
  browserExtensionAvailable: boolean;
  browserExtensionPath: string | null;
  computerUseAvailable: boolean;
  computerUseUnavailableReason: ComputerUseUnavailableReason | null;
  computerUseBinaryPath: string | null;
  computerUseBackend: "cua-driver" | null;
  computerUsePermissionState: ComputerUsePermissionState;
  computerUsePermissions: Array<{
    name: string;
    granted: boolean;
    required: boolean;
  }>;
};

export class LocalAutomationUnavailableError extends Error {}

export class LocalAutomationService {
  private operationQueue: Promise<void> = Promise.resolve();
  private cuaDaemonProcess: ReturnType<ProcessStarter> | null = null;

  constructor(
    private readonly env: ControllerEnv,
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
    private readonly openclawProcess: OpenClawProcessManager,
    private readonly runCommand: CommandRunner = defaultCommandRunner,
    private readonly startProcess: ProcessStarter = defaultProcessStarter,
    private readonly timing: LocalAutomationTiming = DEFAULT_LOCAL_AUTOMATION_TIMING,
  ) {}

  async prepare(): Promise<void> {
    return this.enqueueOperation(() => this.prepareOperation());
  }

  private async prepareOperation(): Promise<void> {
    const config = await this.configStore.getLocalAutomationConfig();
    if (!this.isLocalAutomationPreviewEnabled()) {
      await this.stopBackend();
      return;
    }
    if (
      config.computerUse.enabled &&
      this.getComputerUseUnavailableReason() !== null
    ) {
      return;
    }
    try {
      await this.setComputerUseBackendRunning(config.computerUse.enabled);
    } catch (error: unknown) {
      const startError = error instanceof Error ? error.message : String(error);
      await this.stopBackend();
      try {
        await this.configStore.setLocalAutomationConfig({
          computerUse: { enabled: false },
        });
      } catch (failClosedError: unknown) {
        logger.error(
          {
            backend: this.env.computerUseBackend,
            error:
              failClosedError instanceof Error
                ? failClosedError.message
                : String(failClosedError),
            startError,
          },
          "local automation backend could not fail closed",
        );
        throw new LocalAutomationUnavailableError(
          "Computer Use failed to start and could not be disabled",
        );
      }
      logger.warn(
        {
          backend: this.env.computerUseBackend,
          error: startError,
          retry: "enable-computer-use",
        },
        "local automation backend prepare failed and was disabled",
      );
    }
  }

  async stop(): Promise<void> {
    return this.enqueueOperation(() => this.stopBackend());
  }

  private async stopBackend(): Promise<void> {
    try {
      await this.stopBackendOrThrow();
    } catch {
      // Shutdown and failed-start cleanup are best effort. Interactive disable
      // uses stopBackendOrThrow() directly so the UI cannot report success.
    }
  }

  private async stopBackendOrThrow(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= COMPUTER_USE_STOP_ATTEMPTS; attempt++) {
      try {
        await this.setComputerUseBackendRunning(false);
        return;
      } catch (error: unknown) {
        lastError = error;
      }
    }

    logger.warn(
      {
        attempts: COMPUTER_USE_STOP_ATTEMPTS,
        backend: this.env.computerUseBackend,
        error:
          lastError instanceof Error ? lastError.message : String(lastError),
      },
      "local automation backend cleanup failed",
    );
    throw new LocalAutomationUnavailableError(
      "Computer Use is disabled, but its backend could not be stopped",
    );
  }

  async getStatus(
    config?: LocalAutomationConfig,
  ): Promise<LocalAutomationStatus> {
    const localAutomation =
      config ?? (await this.configStore.getLocalAutomationConfig());
    const browserExtensionPath = this.resolveBrowserExtensionPath();
    const permissionStatus =
      this.isLocalAutomationPreviewEnabled() &&
      localAutomation.computerUse.enabled
        ? await this.readComputerUsePermissions()
        : { state: "disabled" as const, permissions: [] };
    const unavailableReason = this.getComputerUseUnavailableReason();

    return {
      previewEnabled: this.isLocalAutomationPreviewEnabled(),
      browserExtensionAvailable:
        browserExtensionPath !== null && existsSync(browserExtensionPath),
      browserExtensionPath,
      computerUseAvailable: unavailableReason === null,
      computerUseUnavailableReason: unavailableReason,
      computerUseBinaryPath: this.env.computerUseBin,
      computerUseBackend: this.env.computerUseBackend,
      computerUsePermissionState: permissionStatus.state,
      computerUsePermissions: permissionStatus.permissions,
    };
  }

  async updateConfig(
    patch: Partial<LocalAutomationConfig>,
  ): Promise<LocalAutomationConfig> {
    return this.enqueueOperation(() => this.applyConfigUpdate(patch));
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async applyConfigUpdate(
    patch: Partial<LocalAutomationConfig>,
  ): Promise<LocalAutomationConfig> {
    const previous = await this.configStore.getLocalAutomationConfig();
    if (
      !this.isLocalAutomationPreviewEnabled() &&
      (patch.browser?.enabled === true || patch.computerUse?.enabled === true)
    ) {
      throw new LocalAutomationUnavailableError(
        "Local automation preview is disabled in this build",
      );
    }
    const enablingComputerUse =
      patch.computerUse?.enabled === true && !previous.computerUse.enabled;
    const computerUseDisableRequested = patch.computerUse?.enabled === false;
    const requestedAutomationChange =
      (patch.browser?.enabled !== undefined &&
        patch.browser.enabled !== previous.browser.enabled) ||
      (patch.computerUse?.enabled !== undefined &&
        patch.computerUse.enabled !== previous.computerUse.enabled);
    let backendStartAttempted = false;
    let configWriteAttempted = false;

    let next: LocalAutomationConfig;
    try {
      if (enablingComputerUse) {
        this.assertComputerUseAvailable();
        backendStartAttempted = true;
        await this.setComputerUseBackendRunning(true);
      }
      configWriteAttempted = true;
      next = await this.configStore.setLocalAutomationConfig(patch);
      await this.syncService.syncAll();

      const browserChanged = previous.browser.enabled !== next.browser.enabled;
      const computerUseChanged =
        previous.computerUse.enabled !== next.computerUse.enabled;
      if (browserChanged || computerUseChanged) {
        await this.openclawProcess.restart("local-automation-changed");
      }
    } catch (error: unknown) {
      let rollbackSynced = false;
      if (configWriteAttempted) {
        try {
          await this.configStore.setLocalAutomationConfig(previous);
          await this.syncService.syncAll();
          rollbackSynced = true;
        } catch (rollbackError: unknown) {
          logger.error(
            {
              error:
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError),
            },
            "local automation config rollback failed",
          );
        }
      }
      if (rollbackSynced && requestedAutomationChange) {
        try {
          await this.openclawProcess.restart("local-automation-rollback");
        } catch (rollbackError: unknown) {
          logger.error(
            {
              error:
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError),
            },
            "local automation OpenClaw rollback restart failed",
          );
        }
      }
      if (backendStartAttempted) {
        await this.stopBackend();
      }
      throw error;
    }

    // Access is already revoked in config and OpenClaw before daemon cleanup.
    // A cleanup failure must be visible without rolling those protections back.
    if (computerUseDisableRequested) {
      await this.stopBackendOrThrow();
    }
    return next;
  }

  async createBrowserPairing(): Promise<{
    pairingString: string;
    relayPort: number;
  }> {
    return this.enqueueOperation(() => this.createBrowserPairingOperation());
  }

  private async createBrowserPairingOperation(): Promise<{
    pairingString: string;
    relayPort: number;
  }> {
    this.assertLocalAutomationPreviewEnabled();
    const config = await this.configStore.getLocalAutomationConfig();
    if (!config.browser.enabled) {
      throw new LocalAutomationUnavailableError("Browser control is disabled");
    }

    const spec = getOpenClawCommandSpec(this.env);
    const result = await this.runCommand(
      spec.command,
      [...spec.argsPrefix, "browser", "extension", "pair", "--json"],
      {
        cwd: this.env.openclawStateDir,
        env: {
          ...process.env,
          ...spec.extraEnv,
          OPENCLAW_CONFIG_PATH: this.env.openclawConfigPath,
          OPENCLAW_STATE_DIR: this.env.openclawStateDir,
        },
        timeout: 10_000,
      },
    ).catch(() => {
      throw new LocalAutomationUnavailableError(
        "OpenClaw browser pairing failed",
      );
    });
    const pairingOutput = result.stdout.trim() || result.stderr?.trim();
    if (!pairingOutput) {
      throw new LocalAutomationUnavailableError(
        "OpenClaw did not return browser pairing data",
      );
    }
    try {
      return browserPairingResponseSchema.parse(JSON.parse(pairingOutput));
    } catch {
      throw new LocalAutomationUnavailableError(
        "OpenClaw returned invalid browser pairing data",
      );
    }
  }

  /**
   * `cua-driver permissions grant` requests Accessibility, Screen Recording and
   * (on Tahoe) direct-capture consent in one pass, attributing the dialogs to
   * CuaDriver.app via LaunchServices. There is no per-permission entry point,
   * and none of the three is separately useful: the driver reports itself as
   * unavailable until all are granted.
   */
  async requestComputerUsePermissions(): Promise<void> {
    return this.enqueueOperation(async () => {
      this.assertLocalAutomationPreviewEnabled();
      const config = await this.configStore.getLocalAutomationConfig();
      if (!config.computerUse.enabled) {
        throw new LocalAutomationUnavailableError("Computer Use is disabled");
      }
      this.assertComputerUseAvailable();
      if (!this.env.computerUseBin) {
        throw new LocalAutomationUnavailableError(
          "Computer Use sidecar is not installed",
        );
      }
      // The grant flow answers through a running daemon, so start it first.
      await this.setComputerUseBackendRunning(true);
      await this.runCommand(this.env.computerUseBin, ["permissions", "grant"], {
        env: this.getCuaEnvironment(),
        timeout: 120_000,
      });
    });
  }

  private resolveBrowserExtensionPath(): string | null {
    if (this.env.openclawBuiltinExtensionsDir === null) {
      return null;
    }
    const candidates = [
      path.join(
        this.env.openclawBuiltinExtensionsDir,
        "browser",
        "chrome-extension",
      ),
      path.join(
        path.dirname(this.env.openclawBuiltinExtensionsDir),
        "dist",
        "extensions",
        "browser",
        "chrome-extension",
      ),
    ];
    return (
      candidates.find((candidate) => existsSync(candidate)) ??
      candidates[0] ??
      null
    );
  }

  private isComputerUseAvailable(): boolean {
    return this.getComputerUseUnavailableReason() === null;
  }

  private isLocalAutomationPreviewEnabled(): boolean {
    return this.env.localAutomationPreviewEnabled === true;
  }

  private assertLocalAutomationPreviewEnabled(): void {
    if (!this.isLocalAutomationPreviewEnabled()) {
      throw new LocalAutomationUnavailableError(
        "Local automation preview is disabled in this build",
      );
    }
  }

  private getComputerUseUnavailableReason(): ComputerUseUnavailableReason | null {
    if (
      !this.env.computerUseBackend ||
      !this.env.computerUseBin ||
      !path.isAbsolute(this.env.computerUseBin) ||
      !existsSync(this.env.computerUseBin)
    ) {
      return "missing-sidecar";
    }
    if (this.env.computerUsePlatformSupported === false) {
      return "unsupported-os";
    }
    return null;
  }

  private assertComputerUseAvailable(): void {
    const unavailableReason = this.getComputerUseUnavailableReason();
    if (unavailableReason === "unsupported-os") {
      throw new LocalAutomationUnavailableError(
        "Computer Use requires a supported operating system",
      );
    }
    if (unavailableReason === "missing-sidecar") {
      throw new LocalAutomationUnavailableError(
        "Computer Use sidecar is not installed",
      );
    }
  }

  private async readComputerUsePermissions(): Promise<{
    state: Exclude<ComputerUsePermissionState, "disabled">;
    permissions: LocalAutomationStatus["computerUsePermissions"];
  }> {
    if (
      !this.isComputerUseAvailable() ||
      !this.env.computerUseBin ||
      this.env.computerUseBackend !== "cua-driver"
    ) {
      return { state: "unavailable", permissions: [] };
    }
    // Windows needs no TCC grants, so a reachable daemon is the whole check.
    if (process.platform !== "darwin") {
      return {
        state: (await this.isCuaDaemonRunning()) ? "ready" : "unavailable",
        permissions: [],
      };
    }

    try {
      const result = await this.runCommand(
        this.env.computerUseBin,
        ["permissions", "status", "--json"],
        { env: this.getCuaEnvironment(), timeout: 5_000 },
      );
      const parsed = cuaPermissionStatusSchema.parse(
        JSON.parse(result.stdout) as unknown,
      );
      if (parsed.daemon_running === false || parsed.status === "unknown") {
        // The driver refuses to answer for anyone but itself, so an absent
        // daemon means unknown grants — not missing ones.
        return { state: "unavailable", permissions: [] };
      }
      const permissions = [
        { name: "Accessibility", granted: parsed.accessibility === true },
        { name: "Screen Recording", granted: parsed.screen_recording === true },
      ].map((permission) => ({ ...permission, required: true }));
      return {
        state: permissions.every((permission) => permission.granted)
          ? "ready"
          : "permission-required",
        permissions,
      };
    } catch {
      return { state: "unknown", permissions: [] };
    }
  }

  private async setComputerUseBackendRunning(running: boolean): Promise<void> {
    if (
      !this.env.computerUseBin ||
      !existsSync(this.env.computerUseBin) ||
      this.env.computerUseBackend !== "cua-driver"
    ) {
      return;
    }
    await this.setCuaDaemonRunning(running);
  }

  /**
   * Environment for daemon and CLI invocations.
   *
   * Deliberately omits `CUA_DRIVER_EMBEDDED`. That flag belongs to the MCP
   * proxy (`mcp --embedded`, set in the compiled MCP server config). Setting it
   * on the daemon makes it run embedded, where it does not register as the
   * standalone daemon `permissions status` looks for — the driver then answers
   * `daemon_running: false` even while `status` reports it running, and the
   * settings UI shows "unavailable" with every grant already in place.
   *
   * Windows still gets embedded behaviour, but through the explicit
   * `serve --embedded --parent-liveness-stdio` arguments, which is what binds
   * the daemon's lifetime to the controller.
   */
  private getCuaEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      CUA_DRIVER_HOST_BUNDLE_ID: "io.tabby.desktop",
      CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
      CUA_DRIVER_TELEMETRY_HOME: path.join(
        this.env.nexuHomeDir,
        "runtime",
        "cua-driver",
      ),
    };
  }

  private async isCuaDaemonRunning(): Promise<boolean> {
    if (!this.env.computerUseBin) {
      return false;
    }
    try {
      await this.runCommand(this.env.computerUseBin, ["status"], {
        env: this.getCuaEnvironment(),
        timeout: 2_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async setCuaDaemonRunning(running: boolean): Promise<void> {
    if (!this.env.computerUseBin) {
      return;
    }

    if (!running) {
      const managedProcess = this.cuaDaemonProcess;
      this.cuaDaemonProcess = null;
      let stopSucceeded = false;
      try {
        await this.runCommand(this.env.computerUseBin, ["stop"], {
          env: this.getCuaEnvironment(),
          timeout: 10_000,
        });
        stopSucceeded = true;
      } catch (error: unknown) {
        // `cua-driver stop` exits non-zero when nothing is running. The goal
        // state is "stopped", which is already true, so treating that as a
        // failure made disabling report an error and spammed cleanup warnings.
        if (await this.isCuaDaemonRunning()) {
          throw error;
        }
        stopSucceeded = true;
      } finally {
        this.releaseCuaDaemonProcess(managedProcess, !stopSucceeded);
      }
      return;
    }

    if (await this.isCuaDaemonRunning()) {
      // The driver is a shared per-user service on its own default socket, so
      // a reachable daemon is reusable whoever started it. Stopping and
      // relaunching it raced the socket teardown and made enabling fail
      // intermittently with no diagnostic.
      if (this.env.computerUseAppBundle) {
        return;
      }
      if (this.cuaDaemonProcess !== null) {
        return;
      }
      await this.runCommand(this.env.computerUseBin, ["stop"], {
        env: this.getCuaEnvironment(),
        timeout: 10_000,
      });
    } else if (this.cuaDaemonProcess !== null) {
      this.releaseCuaDaemonProcess(this.cuaDaemonProcess, true);
      this.cuaDaemonProcess = null;
    }
    if (this.env.computerUseAppBundle) {
      await this.startCuaDaemonFromAppBundle(this.env.computerUseAppBundle);
      return;
    }

    let child: ReturnType<ProcessStarter>;
    try {
      child = this.startProcess(
        this.env.computerUseBin,
        [
          "serve",
          "--embedded",
          "--parent-liveness-stdio",
          "--permission-mode",
          "standard",
        ],
        {
          detached: false,
          env: this.getCuaEnvironment(),
          stdio: ["pipe", "ignore", "ignore"],
          windowsHide: true,
        },
      );
    } catch (error: unknown) {
      throw new LocalAutomationUnavailableError(
        `Unable to start CUA Driver: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const processState: { spawnError: Error | null } = { spawnError: null };
    child.once("error", (error) => {
      processState.spawnError = error;
    });
    child.stdin?.on("error", () => undefined);
    this.cuaDaemonProcess = child;

    const deadline = Date.now() + this.timing.cuaDaemonStartTimeoutMs;
    while (Date.now() < deadline) {
      if (processState.spawnError) {
        break;
      }
      if (await this.isCuaDaemonRunning()) {
        return;
      }
      await delay(this.timing.cuaDaemonPollIntervalMs);
    }

    await this.runCommand(this.env.computerUseBin, ["stop"], {
      env: this.getCuaEnvironment(),
      timeout: 10_000,
    }).catch(() => undefined);
    if (this.cuaDaemonProcess === child) {
      this.cuaDaemonProcess = null;
    }
    this.releaseCuaDaemonProcess(child, true);

    const spawnError = processState.spawnError;
    throw new LocalAutomationUnavailableError(
      spawnError
        ? `CUA Driver failed to start: ${spawnError.message}`
        : "CUA Driver daemon did not become ready",
    );
  }

  /**
   * macOS only. Launching through LaunchServices makes CuaDriver.app its own
   * responsible process, so TCC attributes Accessibility and Screen Recording
   * to com.trycua.driver instead of to the controller. `open` detaches, so
   * there is no child handle to hold and shutdown goes through `stop`.
   */
  private async startCuaDaemonFromAppBundle(appBundle: string): Promise<void> {
    await this.runCommand(
      "/usr/bin/open",
      [
        "-n",
        "-g",
        "-a",
        appBundle,
        "--args",
        "serve",
        "--permission-mode",
        "standard",
      ],
      { env: this.getCuaEnvironment(), timeout: 15_000 },
    ).catch((error: unknown) => {
      throw new LocalAutomationUnavailableError(
        `Unable to launch CuaDriver.app: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    const deadline = Date.now() + this.timing.cuaDaemonStartTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.isCuaDaemonRunning()) {
        return;
      }
      await delay(this.timing.cuaDaemonPollIntervalMs);
    }

    // `open` detaches, so a daemon that dies on startup leaves nothing behind
    // to explain itself. Ask the driver directly instead of failing with a
    // bare timeout that cannot be diagnosed after the fact.
    const diagnosis = await this.runCommand(
      this.env.computerUseBin ?? "",
      ["status"],
      { env: this.getCuaEnvironment(), timeout: 5_000 },
    ).then(
      (result) => result.stdout.trim() || result.stderr?.trim() || "",
      (error: unknown) => (error instanceof Error ? error.message : ""),
    );
    logger.warn(
      { appBundle, diagnosis, timeoutMs: this.timing.cuaDaemonStartTimeoutMs },
      "CUA Driver daemon did not become ready",
    );
    throw new LocalAutomationUnavailableError(
      diagnosis
        ? `CUA Driver daemon did not become ready: ${diagnosis}`
        : "CUA Driver daemon did not become ready",
    );
  }

  private releaseCuaDaemonProcess(
    child: ReturnType<ProcessStarter> | null,
    force: boolean,
  ): void {
    if (child === null) {
      return;
    }
    child.stdin?.end();
    if (force) {
      child.kill("SIGTERM");
    }
  }
}
