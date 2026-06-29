import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import type { AnalyticsService } from "../services/analytics-service.js";
import type { OpenClawSyncService } from "../services/openclaw-sync-service.js";
import type { ControlPlaneHealthService } from "./control-plane-health.js";
import type { OpenClawProcessManager } from "./openclaw-process.js";
import type { OpenClawWsClient } from "./openclaw-ws-client.js";
import {
  type ControllerRuntimeState,
  recomputeRuntimeStatus,
} from "./state.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startSyncLoop(params: {
  env: ControllerEnv;
  state: ControllerRuntimeState;
  syncService: OpenClawSyncService;
}): () => void {
  let stopped = false;

  const run = async () => {
    while (!stopped) {
      try {
        await params.syncService.syncAll();
        const now = new Date().toISOString();
        params.state.configSyncStatus = "active";
        params.state.skillsSyncStatus = "active";
        params.state.templatesSyncStatus = "active";
        params.state.lastConfigSyncAt = now;
        params.state.lastSkillsSyncAt = now;
        params.state.lastTemplatesSyncAt = now;
        recomputeRuntimeStatus(params.state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.state.configSyncStatus = "degraded";
        params.state.skillsSyncStatus = "degraded";
        params.state.templatesSyncStatus = "degraded";
        recomputeRuntimeStatus(params.state);
        logger.warn({ error: message }, "controller sync loop failed");
      }

      await sleep(params.env.runtimeSyncIntervalMs);
    }
  };

  void run();
  return () => {
    stopped = true;
  };
}

export function startHealthLoop(params: {
  env: ControllerEnv;
  state: ControllerRuntimeState;
  controlPlaneHealth: ControlPlaneHealthService;
  processManager?: OpenClawProcessManager;
  wsClient?: OpenClawWsClient;
}): () => void {
  let stopped = false;

  const run = async () => {
    while (!stopped) {
      const prevGateway = params.state.gatewayStatus;
      const result = await params.controlPlaneHealth.bootstrapProbe();
      params.state.lastGatewayProbeAt = result.checkedAt;
      if (result.phase === "ready") {
        params.state.gatewayStatus = "active";
        params.state.lastGatewayError = null;
        if (prevGateway !== "active") {
          params.wsClient?.retryNow();
        }
      } else if (result.phase === "degraded") {
        params.state.gatewayStatus = "degraded";
        params.state.lastGatewayError =
          result.lastError ?? "control_plane_degraded";
      } else {
        if (result.phase === "connecting") {
          params.state.gatewayStatus = "starting";
          params.state.lastGatewayError =
            result.lastError ?? "control_plane_connecting";
        } else {
          params.state.gatewayStatus = "unhealthy";
          params.state.lastGatewayError =
            result.lastError ?? "control_plane_disconnected";
          // Force an immediate WS reconnect. After a gateway restart (e.g.
          // connecting a WeChat channel triggers a full gateway restart) the WS
          // drops; once the gateway is reachable again the controller must
          // reconnect, but the "ready"-transition retryNow() above is
          // unreachable while the WS is down, so without this the reconnect just
          // waits out the exponential backoff and the UI lingers in "重启中".
          // retryNow() cancels that backoff and reconnects now. (restartForHealth
          // only acts in managed dev mode when the child process itself has
          // exited; in the packaged build launchd owns the gateway restart.)
          params.wsClient?.retryNow();
          params.processManager?.restartForHealth();
        }
      }
      recomputeRuntimeStatus(params.state);
      await sleep(params.env.runtimeHealthIntervalMs);
    }
  };

  void run();
  return () => {
    stopped = true;
  };
}

export function startAnalyticsLoop(params: {
  env: ControllerEnv;
  analyticsService: AnalyticsService;
}): () => void {
  let stopped = false;

  const run = async () => {
    while (!stopped) {
      try {
        await params.analyticsService.poll();
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          "controller analytics loop failed",
        );
      }

      await sleep(params.env.runtimeSyncIntervalMs);
    }
  };

  void run();
  return () => {
    stopped = true;
  };
}
