import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ScheduleResponse } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import type { OpenClawWsClient } from "../runtime/openclaw-ws-client.js";

// Types matching OpenClaw's CronJob schema (subset we need for reading)
interface CronSchedule {
  kind: "cron" | "at" | "every";
  expr?: string;
  tz?: string;
}

interface CronPayload {
  kind: "systemEvent" | "agentTurn";
  text?: string;
  message?: string;
}

interface CronJob {
  id: string;
  agentId?: string;
  sessionKey?: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  payload: CronPayload;
}

export interface CronJobCreateInput {
  name: string;
  description?: string;
  agentId: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  prompt: string;
  channelType?: string;
  channelId?: string;
  scheduleId: string;
}

interface CronListResult {
  jobs: CronJob[];
  total: number;
}

interface CronStoreFile {
  version: number;
  jobs: CronJob[];
}

export interface CronRunEntry {
  ts: number;
  jobId: string;
  action: "finished";
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  runAtMs?: number;
  durationMs?: number;
  nextRunAtMs?: number;
}

export interface CronRunsResponse {
  entries: CronRunEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export function mapCronJobToScheduleItem(
  job: CronJob,
): ScheduleResponse | null {
  if (job.schedule.kind !== "cron" || !job.schedule.expr) return null;

  const payloadText =
    job.payload.kind === "systemEvent"
      ? (job.payload.text ?? "")
      : job.payload.kind === "agentTurn"
        ? (job.payload.message ?? "")
        : "";

  return {
    id: `agent-${job.id}`,
    botId: job.agentId ?? "",
    name: job.name,
    cron: job.schedule.expr,
    timezone: job.schedule.tz ?? "UTC",
    prompt: payloadText,
    enabled: job.enabled,
    source: "agent",
    sessionKey: job.sessionKey,
    description: job.description,
    externalId: job.id,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
  };
}

export class OpenClawCronGateway {
  constructor(
    private readonly wsClient: OpenClawWsClient,
    private readonly env: ControllerEnv,
  ) {}

  async listJobs(agentId?: string): Promise<CronJob[]> {
    if (this.wsClient.isConnected()) {
      try {
        const result = await this.wsClient.request<CronListResult>(
          "cron.list",
          {
            query: agentId,
            includeDisabled: true,
            limit: 200,
          },
        );
        return result.jobs;
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "cron_gateway_list_failed_falling_back_to_file",
        );
      }
    }

    return this.fallbackReadFile();
  }

  async updateJob(id: string, patch: { enabled?: boolean }): Promise<void> {
    await this.wsClient.request("cron.update", { id, patch });
  }

  async createJob(input: CronJobCreateInput): Promise<string> {
    const result = await this.wsClient.request<{ id: string }>("cron.add", {
      name: input.name,
      description: input.description ?? `nexuScheduleId:${input.scheduleId}`,
      agentId: input.agentId,
      enabled: input.enabled,
      schedule: {
        kind: "cron",
        expr: input.cron,
        tz: input.timezone,
      },
      payload: {
        kind: "agentTurn",
        message: input.prompt,
      },
      sessionTarget: "isolated",
      sessionKey: `agent:${input.agentId}:schedule-${input.scheduleId}`,
      delivery: {
        mode: "announce",
        channel: input.channelType ?? "last",
        accountId: input.channelId,
      },
    });
    return result.id;
  }

  async getRuns(
    jobId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<CronRunsResponse> {
    return this.wsClient.request<CronRunsResponse>("cron.runs", {
      id: jobId,
      limit: opts?.limit ?? 20,
      offset: opts?.offset ?? 0,
    });
  }

  async removeJob(id: string): Promise<void> {
    await this.wsClient.request("cron.remove", { id });
  }

  private async fallbackReadFile(): Promise<CronJob[]> {
    try {
      const storePath = path.join(
        this.env.openclawStateDir,
        "cron",
        "jobs.json",
      );
      const raw = await readFile(storePath, "utf-8");
      const store: CronStoreFile = JSON.parse(raw);
      return store.jobs ?? [];
    } catch {
      return [];
    }
  }
}
