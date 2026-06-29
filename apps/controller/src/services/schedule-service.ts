import type {
  ChannelType,
  CreateScheduleInput,
  ScheduleResponse,
  UpdateScheduleInput,
} from "@nexu/shared";
import { resolveOpenClawChannelKey } from "../lib/channel-binding-compiler.js";
import { logger } from "../lib/logger.js";
import type { SessionsRuntime } from "../runtime/sessions-runtime.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import {
  type OpenClawCronGateway,
  deliveryTargetFromSessionKey,
  mapCronJobToScheduleItem,
} from "./openclaw-cron-gateway.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

function buildDedupKey(s: ScheduleResponse): string {
  return `${s.botId}|${s.name}|${s.cron}`;
}

export class ScheduleService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly cronGateway: OpenClawCronGateway,
    private readonly syncService: OpenClawSyncService,
    private readonly sessionsRuntime: SessionsRuntime,
  ) {}

  /**
   * Resolve the announce delivery target for a channel automation by picking
   * the most-recently-active real conversation on that bot+channel and
   * extracting its peer from the session key. This lets UI automations push
   * to "the latest conversation" without the user pasting a raw chatId.
   * Returns undefined when no eligible session exists (or channelType unset).
   */
  private async resolveLatestChannelTarget(
    botId: string,
    channelType?: string,
    channelId?: string,
  ): Promise<string | undefined> {
    if (!channelType) return undefined;
    // Session channelType is inconsistent across channels: Feishu sessions use
    // the channel-type name ("feishu") while WeChat sessions use the plugin id
    // ("openclaw-weixin") even though the schedule/channels API says "wechat".
    // Match against both the raw type and its OpenClaw plugin key.
    const openclawKey = resolveOpenClawChannelKey(channelType as ChannelType);
    const channelMatches = (sct?: string | null): boolean =>
      sct === channelType || sct === openclawKey;
    let target: string | undefined;
    try {
      const sessions = await this.sessionsRuntime.listSessions();
      const candidates = sessions
        .filter((s) => s.botId === botId && channelMatches(s.channelType))
        .map((s) => ({
          to: deliveryTargetFromSessionKey(s.sessionKey ?? ""),
          at: s.lastMessageAt ? Date.parse(s.lastMessageAt) : 0,
        }))
        .filter((c): c is { to: string; at: number } => c.to !== null)
        .sort((a, b) => b.at - a.at);
      target = candidates[0]?.to;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "schedule_resolve_delivery_target_failed",
      );
    }
    // WeChat: OpenClaw lowercases the session id, but the outbound contextToken
    // is keyed by the original-case @im.wechat id. Recover the correct case so
    // the token lookup hits (otherwise the push is silently dropped).
    if (target?.endsWith("@im.wechat") && channelId) {
      target = await this.cronGateway.resolveWechatDeliveryTarget(
        channelId,
        target,
      );
    }
    if (!target) {
      logger.warn(
        { botId, channelType },
        "schedule_no_channel_session_for_delivery_target",
      );
    }
    return target;
  }

  async bootstrap(): Promise<void> {
    const config = await this.configStore.getConfig();
    const schedules = config.schedules ?? [];

    for (const s of schedules) {
      if (s.externalId || !s.enabled) continue;
      try {
        const deliveryTo = await this.resolveLatestChannelTarget(
          s.botId,
          s.channelType,
          s.channelId,
        );
        const externalId = await this.cronGateway.createJob({
          name: s.name,
          agentId: s.botId,
          enabled: s.enabled,
          cron: s.cron,
          timezone: s.timezone,
          prompt: s.prompt,
          channelType: s.channelType,
          channelId: s.channelId,
          deliveryTo,
          scheduleId: s.id,
        });
        await this.configStore.setScheduleExternalId(s.id, externalId);
      } catch (err) {
        logger.warn(
          {
            scheduleId: s.id,
            error: err instanceof Error ? err.message : String(err),
          },
          "schedule_bootstrap_register_failed",
        );
      }
    }
  }

  async listSchedules(): Promise<ScheduleResponse[]> {
    const config = await this.configStore.getConfig();
    const uiSchedules: ScheduleResponse[] = config.schedules ?? [];
    const uiIds = new Set(uiSchedules.map((s) => s.id));
    const uiDedupKeys = new Set(uiSchedules.map(buildDedupKey));

    // Fetch agent-created cron jobs for each active bot
    const activeBots = config.bots.filter((b) => b.status === "active");
    const agentSchedules: ScheduleResponse[] = [];

    for (const bot of activeBots) {
      const jobs = await this.cronGateway.listJobs(bot.id);
      for (const job of jobs) {
        const item = mapCronJobToScheduleItem(job);
        if (!item) continue;

        // Primary dedup: nexuScheduleId in description
        if (item.description) {
          const match = item.description.match(/nexuScheduleId:(\S+)/);
          const scheduleId = match?.[1];
          if (scheduleId && uiIds.has(scheduleId)) continue;
        }

        // Fallback dedup: same botId + name + cron
        if (uiDedupKeys.has(buildDedupKey(item))) continue;

        agentSchedules.push(item);
      }
    }

    return [...uiSchedules, ...agentSchedules];
  }

  async createSchedule(input: CreateScheduleInput): Promise<ScheduleResponse> {
    const schedule = await this.configStore.createSchedule(input);

    // Register directly with OpenClaw so the cron job runs immediately
    // without waiting for the agent to process SCHEDULE.md.
    try {
      const deliveryTo = await this.resolveLatestChannelTarget(
        schedule.botId,
        schedule.channelType,
        schedule.channelId,
      );
      const externalId = await this.cronGateway.createJob({
        name: schedule.name,
        agentId: schedule.botId,
        enabled: schedule.enabled,
        cron: schedule.cron,
        timezone: schedule.timezone,
        prompt: schedule.prompt,
        channelType: schedule.channelType,
        channelId: schedule.channelId,
        deliveryTo,
        scheduleId: schedule.id,
      });
      // Store the externalId for future updates/deletes
      await this.configStore.setScheduleExternalId(schedule.id, externalId);
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "schedule_cron_register_failed_job_will_be_registered_on_sync",
      );
    }

    this.syncService.syncAll().catch(() => {});
    return schedule;
  }

  async updateSchedule(
    id: string,
    input: UpdateScheduleInput,
  ): Promise<ScheduleResponse | null> {
    // Resolve the schedule to determine source
    const existing = await this.findSchedule(id);
    if (!existing) return null;

    if (existing.source === "agent" && existing.externalId) {
      // Agent-created: route to OpenClaw via RPC
      if (input.enabled !== undefined) {
        await this.cronGateway.updateJob(existing.externalId, {
          enabled: input.enabled,
        });
      }
      // Return a merged view (existing fields + enabled change)
      return {
        ...existing,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date().toISOString(),
      };
    }

    // UI-created: update config store + sync + refresh cron job
    const updated = await this.configStore.updateSchedule(id, input);
    if (updated) {
      if (updated.externalId) {
        try {
          await this.cronGateway.removeJob(updated.externalId);
        } catch {
          // Non-fatal: old job may already be gone
        }
      }
      try {
        const deliveryTo = await this.resolveLatestChannelTarget(
          updated.botId,
          updated.channelType,
          updated.channelId,
        );
        const externalId = await this.cronGateway.createJob({
          name: updated.name,
          agentId: updated.botId,
          enabled: updated.enabled,
          cron: updated.cron,
          timezone: updated.timezone,
          prompt: updated.prompt,
          channelType: updated.channelType,
          channelId: updated.channelId,
          deliveryTo,
          scheduleId: updated.id,
        });
        await this.configStore.setScheduleExternalId(updated.id, externalId);
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "schedule_cron_update_failed",
        );
      }
      this.syncService.syncAll().catch(() => {});
    }
    return updated;
  }

  async deleteSchedule(id: string): Promise<boolean> {
    const existing = await this.findSchedule(id);

    if (existing?.source === "agent" && existing.externalId) {
      try {
        await this.cronGateway.removeJob(existing.externalId);
        return true;
      } catch {
        return false;
      }
    }

    // UI-created: delete from config and remove cron job
    const success = await this.configStore.deleteSchedule(id);
    if (success) {
      if (existing?.externalId) {
        try {
          await this.cronGateway.removeJob(existing.externalId);
        } catch {
          // Non-fatal: gateway may be disconnected
        }
      }
      this.syncService.syncAll().catch(() => {});
    }
    if (success) {
      this.syncService.syncAll().catch(() => {});
    }
    return success;
  }

  async listRuns(
    scheduleId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<{
    entries: import("./openclaw-cron-gateway.js").CronRunEntry[];
    total: number;
    hasMore: boolean;
  } | null> {
    const schedule = await this.findSchedule(scheduleId);
    if (!schedule?.externalId) return null;
    const result = await this.cronGateway.getRuns(schedule.externalId, opts);
    return {
      entries: result.entries,
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  private async findSchedule(id: string): Promise<ScheduleResponse | null> {
    // Check NexuConfig first
    const config = await this.configStore.getConfig();
    const uiMatch = (config.schedules ?? []).find((s) => s.id === id);
    if (uiMatch) return uiMatch;

    // Check agent schedules
    const allSchedules = await this.listSchedules();
    return allSchedules.find((s) => s.id === id) ?? null;
  }
}
