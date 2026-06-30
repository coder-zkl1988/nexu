import type {
  CancelTaskBody,
  DeviceExecuteTaskBody,
  DeviceInfo,
  DeviceListResponse,
  DevicePushMediaBody,
  DevicePushMediaResponse,
  TaskResult,
} from "@nexu/shared";
import { logger } from "../lib/logger.js";
import type { DeviceTaskHistoryStore } from "../store/device-task-history-store.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

interface RpcErrorDetail {
  code: string;
  message: string;
}

type RpcResponse<T> =
  | { result: T; error?: undefined }
  | { error: RpcErrorDetail; result?: undefined };

const DEFAULT_RPC_TIMEOUT_MS = 10_000;
const DEFAULT_LIST_TIMEOUT_MS = 5_000;

export class DeviceControlRpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeviceControlRpcError";
  }
}

export class DeviceControlService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly taskHistoryStore: DeviceTaskHistoryStore,
  ) {}

  private healthAbortController: AbortController | null = null;

  private async getRpcPort(): Promise<number> {
    const config = await this.configStore.getConfig();
    return config.deviceControl.rpcPort;
  }

  private async rpc<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  ): Promise<T> {
    const port = await this.getRpcPort();
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `Device control RPC failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as RpcResponse<T>;

    if (data.error !== undefined) {
      throw new DeviceControlRpcError(data.error.code, data.error.message);
    }

    return data.result as T;
  }

  /**
   * Push the signed-in user's VLM gateway credential to the tabby-control plugin
   * so it's handed to phones on connect. Called on startup and whenever the
   * cloud login state changes. Best-effort: if the plugin isn't up, ignore.
   */
  async pushVlmCredential(): Promise<void> {
    let credential: { apiUrl: string; apiKey: string; model: string } | null =
      null;
    try {
      credential = await this.configStore.getVlmGatewayCredential();
    } catch {
      credential = null;
    }
    try {
      await this.rpc("device_set_vlm_credential", { credential });
    } catch {
      // Plugin not running / RPC unavailable — phones will fall back to local
      // VLM settings until the next push succeeds.
    }
  }

  /**
   * Push the VLM credential once the tabby-control RPC is reachable. The plugin
   * comes up with no credential after every OpenClaw (re)start, so this polls
   * `isAvailable()` and pushes on first success. Best-effort: gives up silently
   * after `maxAttempts`. Used by cold start and after every gateway restart.
   */
  async pushVlmCredentialWhenReady(
    maxAttempts = 10,
    intervalMs = 2000,
  ): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const up = await this.isAvailable().catch(() => false);
      if (up) {
        await this.pushVlmCredential();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async isAvailable(): Promise<boolean> {
    // Cancel any in-flight health check
    this.healthAbortController?.abort();
    const ac = new AbortController();
    this.healthAbortController = ac;

    // Auto-timeout after 5 seconds
    const timeout = setTimeout(() => ac.abort(), 5000);
    // Don't prevent process exit
    if (typeof timeout === "object" && "unref" in timeout) {
      (
        timeout as ReturnType<typeof setTimeout> & { unref: () => void }
      ).unref();
    }

    try {
      const port = await this.getRpcPort();
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: ac.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
      if (this.healthAbortController === ac) {
        this.healthAbortController = null;
      }
    }
  }

  async listDevices(): Promise<DeviceListResponse> {
    const port = await this.getRpcPort();
    const response = await fetch(`http://127.0.0.1:${port}/devices`, {
      signal: AbortSignal.timeout(DEFAULT_LIST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to list devices: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as DeviceListResponse;
  }

  async getDevice(deviceId: string): Promise<DeviceInfo | null> {
    return this.rpc<DeviceInfo | null>("device.get_status", { deviceId });
  }

  async executeTask(
    deviceId: string,
    body: DeviceExecuteTaskBody,
  ): Promise<{ result: TaskResult }> {
    const taskTimeout = body.timeout ?? 120_000;
    const dispatchedAt = new Date().toISOString();
    const result = await this.rpc<TaskResult>(
      "device.execute_task",
      { deviceId, task: body.task, timeoutMs: taskTimeout },
      taskTimeout + 5_000,
    );
    try {
      await this.taskHistoryStore.append({
        deviceId,
        taskId: result.taskId,
        task: body.task,
        maxSteps: body.maxSteps,
        dispatchedAt,
        completedAt: new Date().toISOString(),
        result,
      });
    } catch (err) {
      // History persistence is best-effort; never fail the user's task.
      logger.warn(
        {
          error: err instanceof Error ? err.message : String(err),
          deviceId,
          taskId: result.taskId,
        },
        "failed to persist device task history",
      );
    }
    return { result };
  }

  async cancelTask(
    deviceId: string,
    body: CancelTaskBody,
  ): Promise<{ cancelled: boolean; message?: string }> {
    return this.rpc<{ cancelled: boolean; message?: string }>(
      "device.cancel_task",
      { deviceId, taskId: body.taskId },
    );
  }

  /**
   * Push images into the device gallery one at a time. Each image is sent over
   * the device WS and confirmed independently so one failure doesn't abort the
   * batch; returns a per-image result for the caller to act on.
   */
  async pushMedia(
    deviceId: string,
    body: DevicePushMediaBody,
  ): Promise<DevicePushMediaResponse> {
    const results: DevicePushMediaResponse["results"] = [];
    for (const image of body.images) {
      try {
        const result = await this.rpc<
          DevicePushMediaResponse["results"][number]
        >(
          "device.push_media",
          {
            deviceId,
            filename: image.filename,
            mimeType: image.mimeType,
            dataBase64: image.dataBase64,
          },
          35_000,
        );
        results.push(result);
      } catch (err) {
        results.push({
          mediaId: "",
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { results };
  }
}
