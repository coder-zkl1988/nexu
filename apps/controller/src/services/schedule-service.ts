import type {
  CreateScheduleInput,
  ScheduleResponse,
  UpdateScheduleInput,
} from "@nexu/shared";
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

    // UI-created: update config store + sync
    const updated = await this.configStore.updateSchedule(id, input);
    if (updated) {
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

    // UI-created: delete from config
    const success = await this.configStore.deleteSchedule(id);
    if (success && existing?.externalId) {
      // Also clean up the corresponding cron job if it was registered
      try {
        await this.cronGateway.removeJob(existing.externalId);
      } catch {
        // Non-fatal: gateway may be disconnected
      }
    }
    if (success) {
      this.syncService.syncAll().catch(() => {});
    }
    return success;
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
