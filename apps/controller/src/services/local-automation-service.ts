import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ControllerEnv } from "../app/env.js";
import { supportsPeekabooPlatform } from "../lib/computer-use-platform.js";
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

async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  let metadata = await lstat(directoryPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(
      `Computer Use socket directory is unsafe: ${directoryPath}`,
    );
  }
  const userId = typeof process.getuid === "function" ? process.getuid() : null;
  if (userId !== null && metadata.uid !== userId) {
    throw new Error(
      `Computer Use socket directory has the wrong owner: ${directoryPath}`,
    );
  }
  if ((metadata.mode & 0o777) !== 0o700) {
    await chmod(directoryPath, 0o700);
    metadata = await lstat(directoryPath);
  }
  if ((metadata.mode & 0o777) !== 0o700) {
    throw new Error(
      `Computer Use socket directory is not private: ${directoryPath}`,
    );
  }
}

const peekabooPermissionResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    source: z.string().optional(),
    permissions: z.array(
      z.object({
        name: z.string(),
        isGranted: z.boolean(),
        isRequired: z.boolean(),
      }),
    ),
  }),
});

const peekabooDaemonStatusSchema = z.object({
  success: z.boolean(),
  data: z.object({ running: z.boolean() }),
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

export type ComputerUseUnavailableReason =
  | "missing-sidecar"
  | "unsupported-os"
  | "runtime-path-too-long";

export type LocalAutomationStatus = {
  previewEnabled: boolean;
  browserExtensionAvailable: boolean;
  browserExtensionPath: string | null;
  computerUseAvailable: boolean;
  computerUseUnavailableReason: ComputerUseUnavailableReason | null;
  computerUseBinaryPath: string | null;
  computerUseBackend: "peekaboo" | "cua-driver" | null;
  computerUsePermissionState: ComputerUsePermissionState;
  computerUsePermissions: Array<{
    name: string;
    granted: boolean;
    required: boolean;
  }>;
};

export class LocalAutomationUnavailableError extends Error {}

export { supportsPeekabooPlatform };

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

  async requestScreenRecordingPermission(): Promise<void> {
    return this.enqueueOperation(async () => {
      const computerUseBin = await this.preparePeekabooPermissionRequest();
      const bridgeSocket = this.requirePeekabooBridgeSocket();
      await this.runCommand(
        computerUseBin,
        [
          "permissions",
          "request-screen-recording",
          "--bridge-socket",
          bridgeSocket,
          "--json",
        ],
        {
          env: this.getPeekabooEnvironment(bridgeSocket),
          timeout: 20_000,
        },
      );
    });
  }

  async requestAccessibilityPermission(): Promise<void> {
    return this.enqueueOperation(() =>
      this.requestLocalPeekabooPermission("request-accessibility"),
    );
  }

  async requestEventSynthesizingPermission(): Promise<void> {
    return this.enqueueOperation(() =>
      this.requestLocalPeekabooPermission("request-event-synthesizing"),
    );
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
    if (
      this.env.computerUseBackend === "peekaboo" &&
      this.env.computerUseBridgeSocket === null
    ) {
      return "runtime-path-too-long";
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
    if (unavailableReason === "runtime-path-too-long") {
      throw new LocalAutomationUnavailableError(
        "Computer Use cannot create a private bridge socket within the macOS path limit",
      );
    }
  }

  private async readComputerUsePermissions(): Promise<{
    state: Exclude<ComputerUsePermissionState, "disabled">;
    permissions: LocalAutomationStatus["computerUsePermissions"];
  }> {
    if (!this.isComputerUseAvailable() || !this.env.computerUseBin) {
      return { state: "unavailable", permissions: [] };
    }
    if (this.env.computerUseBackend === "cua-driver") {
      return {
        state: (await this.isCuaDaemonRunning()) ? "ready" : "unavailable",
        permissions: [],
      };
    }
    if (this.env.computerUseBackend !== "peekaboo") {
      return { state: "unknown", permissions: [] };
    }

    try {
      const bridgeSocket = this.requirePeekabooBridgeSocket();
      const daemonResult = await this.runCommand(
        this.env.computerUseBin,
        ["daemon", "status", "--bridge-socket", bridgeSocket, "--json"],
        { timeout: 5_000 },
      );
      const daemon = peekabooDaemonStatusSchema.parse(
        JSON.parse(daemonResult.stdout),
      );
      if (!daemon.success || !daemon.data.running) {
        return { state: "unavailable", permissions: [] };
      }

      const result = await this.runCommand(
        this.env.computerUseBin,
        ["permissions", "status", "--bridge-socket", bridgeSocket, "--json"],
        { timeout: 5_000 },
      );
      const parsed = peekabooPermissionResponseSchema.parse(
        JSON.parse(result.stdout),
      );
      const permissions = parsed.data.permissions.map((permission) => {
        const isInputPermission =
          permission.name.trim().toLowerCase() === "event synthesizing";
        return {
          name: permission.name,
          granted: permission.isGranted,
          required: permission.isRequired || isInputPermission,
        };
      });
      const ready =
        parsed.success &&
        parsed.data.source === "bridge" &&
        permissions.every(
          (permission) => !permission.required || permission.granted,
        );
      return {
        state: ready ? "ready" : "permission-required",
        permissions,
      };
    } catch {
      return { state: "unknown", permissions: [] };
    }
  }

  private async setComputerUseBackendRunning(running: boolean): Promise<void> {
    if (!this.env.computerUseBin || !existsSync(this.env.computerUseBin)) {
      return;
    }

    if (this.env.computerUseBackend === "cua-driver") {
      await this.setCuaDaemonRunning(running);
      return;
    }
    if (this.env.computerUseBackend !== "peekaboo") {
      return;
    }

    const bridgeSocket = this.env.computerUseBridgeSocket;
    if (bridgeSocket === null) {
      if (running) {
        this.assertComputerUseAvailable();
      }
      return;
    }
    await ensurePrivateDirectory(path.dirname(bridgeSocket));
    await this.runCommand(
      this.env.computerUseBin,
      [
        "daemon",
        running ? "start" : "stop",
        "--bridge-socket",
        bridgeSocket,
        "--json",
      ],
      {
        env: this.getPeekabooEnvironment(bridgeSocket),
        timeout: 10_000,
      },
    );
  }

  private async preparePeekabooPermissionRequest(): Promise<string> {
    this.assertLocalAutomationPreviewEnabled();
    const config = await this.configStore.getLocalAutomationConfig();
    if (!config.computerUse.enabled) {
      throw new LocalAutomationUnavailableError("Computer Use is disabled");
    }
    if (
      this.env.computerUseBackend !== "peekaboo" ||
      !this.env.computerUseBin
    ) {
      throw new LocalAutomationUnavailableError(
        "System permission requests require Peekaboo",
      );
    }
    this.assertComputerUseAvailable();
    await this.setComputerUseBackendRunning(true);
    return this.env.computerUseBin;
  }

  private async requestLocalPeekabooPermission(
    subcommand: "request-accessibility" | "request-event-synthesizing",
  ): Promise<void> {
    const computerUseBin = await this.preparePeekabooPermissionRequest();
    const bridgeSocket = this.requirePeekabooBridgeSocket();
    await this.runCommand(
      computerUseBin,
      ["agent", "permission", subcommand, "--no-remote", "--json"],
      {
        env: this.getPeekabooEnvironment(bridgeSocket),
        timeout: 20_000,
      },
    );
  }

  private requirePeekabooBridgeSocket(): string {
    const bridgeSocket = this.env.computerUseBridgeSocket;
    if (bridgeSocket === null) {
      throw new LocalAutomationUnavailableError(
        "Computer Use cannot create a private bridge socket within the macOS path limit",
      );
    }
    return bridgeSocket;
  }

  private getPeekabooEnvironment(bridgeSocket: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PEEKABOO_DAEMON_SOCKET: bridgeSocket,
    };
  }

  private getCuaEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      CUA_DRIVER_EMBEDDED: "1",
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
      await this.runCommand(
        this.env.computerUseBin,
        ["status", "--socket", this.env.computerUseCuaSocket],
        { env: this.getCuaEnvironment(), timeout: 2_000 },
      );
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
        await this.runCommand(
          this.env.computerUseBin,
          ["stop", "--socket", this.env.computerUseCuaSocket],
          { env: this.getCuaEnvironment(), timeout: 10_000 },
        );
        stopSucceeded = true;
      } finally {
        this.releaseCuaDaemonProcess(managedProcess, !stopSucceeded);
      }
      return;
    }

    if (await this.isCuaDaemonRunning()) {
      if (this.cuaDaemonProcess !== null) {
        return;
      }
      await this.runCommand(
        this.env.computerUseBin,
        ["stop", "--socket", this.env.computerUseCuaSocket],
        { env: this.getCuaEnvironment(), timeout: 10_000 },
      );
    } else if (this.cuaDaemonProcess !== null) {
      this.releaseCuaDaemonProcess(this.cuaDaemonProcess, true);
      this.cuaDaemonProcess = null;
    }
    if (!this.env.computerUseCuaSocket.startsWith("\\\\.\\pipe\\")) {
      await mkdir(path.dirname(this.env.computerUseCuaSocket), {
        recursive: true,
      });
    }

    let child: ReturnType<ProcessStarter>;
    try {
      child = this.startProcess(
        this.env.computerUseBin,
        [
          "serve",
          "--embedded",
          "--parent-liveness-stdio",
          "--socket",
          this.env.computerUseCuaSocket,
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

    await this.runCommand(
      this.env.computerUseBin,
      ["stop", "--socket", this.env.computerUseCuaSocket],
      { env: this.getCuaEnvironment(), timeout: 10_000 },
    ).catch(() => undefined);
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
