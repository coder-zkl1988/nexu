import type {
  CreateScheduleInput,
  ScheduleResponse,
  UpdateScheduleInput,
} from "@nexu/shared";
import { logger } from "../lib/logger.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import {
  type OpenClawCronGateway,
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
  ) {}

  async bootstrap(): Promise<void> {
    const config = await this.configStore.getConfig();
    const schedules = config.schedules ?? [];

    for (const s of schedules) {
      if (s.externalId || !s.enabled) continue;
      try {
        const externalId = await this.cronGateway.createJob({
          name: s.name,
          agentId: s.botId,
          enabled: s.enabled,
          cron: s.cron,
          timezone: s.timezone,
          prompt: s.prompt,
          channelType: s.channelType,
          channelId: s.channelId,
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
          if (match && uiIds.has(match[1]!)) continue;
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
      const externalId = await this.cronGateway.createJob({
        name: schedule.name,
        agentId: schedule.botId,
        enabled: schedule.enabled,
        cron: schedule.cron,
        timezone: schedule.timezone,
        prompt: schedule.prompt,
        channelType: schedule.channelType,
        channelId: schedule.channelId,
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
        const externalId = await this.cronGateway.createJob({
          name: updated.name,
          agentId: updated.botId,
          enabled: updated.enabled,
          cron: updated.cron,
          timezone: updated.timezone,
          prompt: updated.prompt,
          channelType: updated.channelType,
          channelId: updated.channelId,
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
