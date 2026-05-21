import type { OpenClawGatewayService } from "../services/openclaw-gateway-service.js";
import type { OpenClawProcessManager } from "./openclaw-process.js";
import type { OpenClawWsClient } from "./openclaw-ws-client.js";
import { type ControllerRuntimeState, isBootPhasePreReady } from "./state.js";

export type ControlPlaneHealthPhase =
  | "disconnected"
  | "connecting"
  | "ready"
  | "degraded";

export interface ControlPlaneHealthResult {
  ok: boolean;
  phase: ControlPlaneHealthPhase;
  checkedAt: string;
  latencyMs: number | null;
  wsConnected: boolean;
  checks: {
    health: boolean;
    status: boolean;
    configGet: boolean;
  };
  errors: {
    health: string | null;
    status: string | null;
    configGet: string | null;
  };
  lastError: string | null;
}

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export class ControlPlaneHealthService {
  constructor(
    private readonly gatewayService: OpenClawGatewayService,
    private readonly wsClient: OpenClawWsClient,
    private readonly runtimeState: ControllerRuntimeState,
    private readonly processManager?: OpenClawProcessManager,
  ) {}

  /**
   * Lightweight bootstrap probe that only checks `health` — not `status` or
   * `config.get`.  OpenClaw >=2026.5.18 overlaps channel-sidecar startup with
   * the gateway listen loop, so `status` and `config.get` can take 30–60 s
   * during the first readiness window while sidecars initialise.  `health` is
   * the correct single-signal readiness gate for the bootstrap stabilisation
   * loop.
   */
  async bootstrapProbe(options?: {
    timeoutMs?: number;
  }): Promise<ControlPlaneHealthResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    const wsConnected = this.wsClient.isConnected();

    if (!wsConnected) {
      const processAlive = this.processManager?.isAlive() ?? false;
      const phase: ControlPlaneHealthPhase =
        isBootPhasePreReady(this.runtimeState.bootPhase) || processAlive
          ? "connecting"
          : "disconnected";

      return {
        ok: false,
        phase,
        checkedAt,
        latencyMs: null,
        wsConnected: false,
        checks: { health: false, status: false, configGet: false },
        errors: {
          health: "openclaw gateway not connected",
          status: "openclaw gateway not connected",
          configGet: "openclaw gateway not connected",
        },
        lastError: "openclaw gateway not connected",
      };
    }

    const timeoutMs = options?.timeoutMs ?? 30_000;

    try {
      await this.gatewayService.getGatewayHealthSnapshot({
        timeoutMs,
      });
      return {
        ok: true,
        phase: "ready",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        wsConnected,
        checks: { health: true, status: true, configGet: true },
        errors: { health: null, status: null, configGet: null },
        lastError: null,
      };
    } catch (err) {
      return {
        ok: false,
        phase: "degraded",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        wsConnected,
        checks: {
          health: false,
          status: false,
          configGet: false,
        },
        errors: {
          health: getErrorMessage(err),
          status: null,
          configGet: null,
        },
        lastError: getErrorMessage(err),
      };
    }
  }

  async probe(options?: {
    timeoutMs?: number;
  }): Promise<ControlPlaneHealthResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    const wsConnected = this.wsClient.isConnected();

    if (!wsConnected) {
      const processAlive = this.processManager?.isAlive() ?? false;
      const phase: ControlPlaneHealthPhase =
        isBootPhasePreReady(this.runtimeState.bootPhase) || processAlive
          ? "connecting"
          : "disconnected";

      return {
        ok: false,
        phase,
        checkedAt,
        latencyMs: null,
        wsConnected: false,
        checks: {
          health: false,
          status: false,
          configGet: false,
        },
        errors: {
          health: "openclaw gateway not connected",
          status: "openclaw gateway not connected",
          configGet: "openclaw gateway not connected",
        },
        lastError: "openclaw gateway not connected",
      };
    }

    const [health, status, configGet] = await Promise.allSettled([
      this.gatewayService.getGatewayHealthSnapshot({
        timeoutMs: options?.timeoutMs,
      }),
      this.gatewayService.getGatewayStatusSummary({
        timeoutMs: options?.timeoutMs,
      }),
      this.gatewayService.getGatewayConfigSnapshot({
        timeoutMs: options?.timeoutMs,
      }),
    ]);

    const healthOk = health.status === "fulfilled";
    const statusOk = status.status === "fulfilled";
    const configGetOk = configGet.status === "fulfilled";
    const ok = healthOk && statusOk && configGetOk;
    const errors = {
      health:
        health.status === "rejected" ? getErrorMessage(health.reason) : null,
      status:
        status.status === "rejected" ? getErrorMessage(status.reason) : null,
      configGet:
        configGet.status === "rejected"
          ? getErrorMessage(configGet.reason)
          : null,
    };

    return {
      ok,
      phase: ok ? "ready" : "degraded",
      checkedAt,
      latencyMs: Date.now() - startedAt,
      wsConnected,
      checks: {
        health: healthOk,
        status: statusOk,
        configGet: configGetOk,
      },
      errors,
      lastError: errors.health ?? errors.status ?? errors.configGet,
    };
  }
}
