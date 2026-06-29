/**
 * channel-health-watchdog.ts
 *
 * Periodically polls per-channel live status and self-heals connection-level
 * failures that OpenClaw does not recover from on its own (e.g. a Feishu/
 * WeChat listener whose long-lived connection died during a network outage
 * and never reconnected — the exact failure that left bound channels silently
 * unresponsive for days).
 *
 * Two failure classes, two responses:
 *  - **connection-dead** (channel errored/disconnected, no credential signal):
 *    recoverable by restarting the gateway → auto-restart with a circuit
 *    breaker (debounce + cooldown + rolling cap) so a persistently-broken
 *    channel can't drive a restart loop.
 *  - **credential-dead** (session expired / logged out, e.g. WeChat errcode
 *    -14): a restart cannot fix a dead login → log only; the user must
 *    re-bind. Already surfaced in the UI via /channels/live-status.
 *
 * Known v1 blind spot: a Feishu WebSocket that dies *silently* (plugin still
 * reports running=true, no lastError) is NOT detectable via channels.status —
 * Feishu is treated as implicitly-ready. Such cases still need a manual
 * restart. See the channel-no-reply debugging notes.
 *
 * Decision logic (classification + debounce + circuit breaker) is extracted
 * into ChannelHealthEvaluator so it can be unit-tested without timers or I/O.
 */

import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import type { ChannelService } from "../services/channel-service.js";
import type {
  ChannelLiveStatusEntry,
  OpenClawGatewayService,
} from "../services/openclaw-gateway-service.js";
import type { OpenClawProcessManager } from "./openclaw-process.js";

const POLL_INTERVAL_MS = 60_000;
/** Consecutive connection-dead polls required before a restart fires. */
export const UNHEALTHY_THRESHOLD = 3;
/** Minimum gap between watchdog-initiated restarts. */
export const RESTART_COOLDOWN_MS = 15 * 60_000;
/** Rolling window + cap to bound restart frequency. */
export const RESTART_WINDOW_MS = 60 * 60_000;
export const MAX_RESTARTS_PER_WINDOW = 3;

/** lastError substrings that mean the login/credential is dead (restart won't help). */
const CREDENTIAL_DEAD_PATTERNS = [
  "session expired",
  "not configured",
  "logged out",
  "unauthorized",
  "credential",
  "re-login",
  "relogin",
  "token expired",
];

export type HealthVerdict =
  | "healthy"
  | "transient"
  | "credential-dead"
  | "connection-dead";

export function classifyChannel(entry: ChannelLiveStatusEntry): HealthVerdict {
  if (entry.ready) return "healthy";
  if (entry.status === "connecting" || entry.status === "restarting") {
    return "transient";
  }
  const err = (entry.lastError ?? "").toLowerCase();
  if (CREDENTIAL_DEAD_PATTERNS.some((pattern) => err.includes(pattern))) {
    return "credential-dead";
  }
  // WeChat that paused after errcode -14 reports running=false; a restart
  // re-launches the same dead session, so treat it as credential-dead.
  if (entry.channelType === "wechat" && !entry.running) {
    return "credential-dead";
  }
  if (entry.status === "error" || entry.status === "disconnected") {
    return "connection-dead";
  }
  return "transient";
}

function channelKey(entry: ChannelLiveStatusEntry): string {
  return `${entry.channelType}:${entry.accountId}`;
}

export interface ChannelHealthDecision {
  /** Channels classified as credential-dead this tick (notify only). */
  credentialDead: ChannelLiveStatusEntry[];
  /** Channels classified as connection-dead this tick (with streak count). */
  connectionDead: Array<{ entry: ChannelLiveStatusEntry; streak: number }>;
  /** Whether the gateway should be restarted to recover dead connection(s). */
  shouldRestart: boolean;
  /** True when a restart was warranted but suppressed by the circuit breaker. */
  restartSuppressed: boolean;
}

/**
 * Stateful decision core. Holds per-channel debounce streaks and the rolling
 * restart history (circuit breaker). `evaluate` is pure w.r.t. I/O — callers
 * feed it live status + a timestamp and act on the returned decision.
 */
export function createChannelHealthEvaluator() {
  const unhealthyStreak = new Map<string, number>();
  let restartHistory: number[] = [];

  function canRestartNow(nowMs: number): boolean {
    restartHistory = restartHistory.filter(
      (ts) => nowMs - ts < RESTART_WINDOW_MS,
    );
    const lastRestart = restartHistory[restartHistory.length - 1];
    if (
      lastRestart !== undefined &&
      nowMs - lastRestart < RESTART_COOLDOWN_MS
    ) {
      return false;
    }
    return restartHistory.length < MAX_RESTARTS_PER_WINDOW;
  }

  function evaluate(
    channels: ChannelLiveStatusEntry[],
    gatewayConnected: boolean,
    nowMs: number,
  ): ChannelHealthDecision {
    const decision: ChannelHealthDecision = {
      credentialDead: [],
      connectionDead: [],
      shouldRestart: false,
      restartSuppressed: false,
    };

    // The dedicated gateway health loop owns full-gateway-down recovery —
    // don't double-act on a transient gateway outage.
    if (!gatewayConnected) {
      unhealthyStreak.clear();
      return decision;
    }

    let connectionDeadToHeal = false;
    for (const entry of channels) {
      const key = channelKey(entry);
      const verdict = classifyChannel(entry);

      if (verdict === "healthy" || verdict === "transient") {
        unhealthyStreak.delete(key);
        continue;
      }
      if (verdict === "credential-dead") {
        unhealthyStreak.delete(key);
        decision.credentialDead.push(entry);
        continue;
      }

      // connection-dead: debounce before counting it toward a restart.
      const streak = (unhealthyStreak.get(key) ?? 0) + 1;
      unhealthyStreak.set(key, streak);
      decision.connectionDead.push({ entry, streak });
      if (streak >= UNHEALTHY_THRESHOLD) {
        connectionDeadToHeal = true;
      }
    }

    if (connectionDeadToHeal) {
      if (canRestartNow(nowMs)) {
        restartHistory.push(nowMs);
        unhealthyStreak.clear(); // fresh grace period after restart
        decision.shouldRestart = true;
      } else {
        decision.restartSuppressed = true;
      }
    }

    return decision;
  }

  return { evaluate };
}

export function startChannelHealthWatchdog(params: {
  env: ControllerEnv;
  channelService: ChannelService;
  gatewayService: OpenClawGatewayService;
  openclawProcess: OpenClawProcessManager;
}): () => void {
  let stopped = false;
  const evaluator = createChannelHealthEvaluator();

  const tick = async (nowMs: number): Promise<void> => {
    // Only channels the user expects to be working (stored status connected).
    const channels = (await params.channelService.listChannels()).filter(
      (channel) => channel.status === "connected",
    );
    if (channels.length === 0) return;

    const live = await params.gatewayService.getAllChannelsLiveStatus(
      channels.map((channel) => ({
        id: channel.id,
        channelType: channel.channelType,
        accountId: channel.accountId,
        storedStatus: channel.status,
      })),
    );

    const decision = evaluator.evaluate(
      live.channels,
      live.gatewayConnected,
      nowMs,
    );

    for (const entry of decision.credentialDead) {
      logger.warn(
        {
          event: "channel_health_credential_dead",
          channelType: entry.channelType,
          accountId: entry.accountId,
          lastError: entry.lastError,
        },
        "channel credential expired — user must re-bind (no auto-restart)",
      );
    }
    for (const { entry, streak } of decision.connectionDead) {
      logger.warn(
        {
          event: "channel_health_connection_dead",
          channelType: entry.channelType,
          accountId: entry.accountId,
          status: entry.status,
          lastError: entry.lastError,
          streak,
          threshold: UNHEALTHY_THRESHOLD,
        },
        "channel connection appears dead",
      );
    }
    if (decision.restartSuppressed) {
      logger.warn(
        { event: "channel_health_restart_suppressed" },
        "channel health restart suppressed by circuit breaker",
      );
    }
    if (decision.shouldRestart) {
      logger.warn(
        { event: "channel_health_restart" },
        "restarting gateway to recover dead channel connection(s)",
      );
      await params.openclawProcess.restart("channel-health-watchdog");
    }
  };

  const run = async () => {
    while (!stopped) {
      try {
        await tick(Date.now());
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "channel health watchdog tick failed",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };

  void run();
  return () => {
    stopped = true;
  };
}
