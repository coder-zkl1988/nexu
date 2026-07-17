import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChannelType, ScheduleResponse } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { resolveOpenClawChannelKey } from "../lib/channel-binding-compiler.js";
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
  /** Per-job model override (OpenClaw >=2026.7.1); null clears it. */
  model?: string | null;
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
  /**
   * Announce delivery target (OpenClaw `delivery.to`). For Feishu this is
   * `chat:<chatId>` (group) or `user:<openId>` (DM). Without it, announce
   * delivery to a session-less cron fails with "requires target".
   */
  deliveryTo?: string;
  scheduleId: string;
  /** Per-job model override; undefined/empty keeps the bot default. */
  modelId?: string;
}

/** Derive an announce delivery target from a channel session key.
 *
 * Feishu uses prefixed targets: `…:group:oc_x` → `chat:oc_x`, `…:direct:ou_x`
 * → `user:ou_x`. WeChat IDs end with `@im.wechat` and take NO prefix — the
 * openclaw-weixin plugin's target parser rejects `user:`/`chat:` (a `user:`
 * target gets split on ":" and fails as `Unknown target "user"`); its contract
 * is the raw `xxx@im.wechat` address.
 *
 * Returns null for keys without an embedded peer (webchat / cron / schedule). */
export function deliveryTargetFromSessionKey(
  sessionKey: string,
): string | null {
  const group = sessionKey.match(/:group:(.+)$/);
  if (group?.[1]) {
    return group[1].endsWith("@im.wechat") ? group[1] : `chat:${group[1]}`;
  }
  const direct = sessionKey.match(/:direct:(.+)$/);
  if (direct?.[1]) {
    return direct[1].endsWith("@im.wechat") ? direct[1] : `user:${direct[1]}`;
  }
  return null;
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
    modelId: job.payload.model ?? undefined,
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

  /**
   * Map a lowercased WeChat delivery target to the original-case id used by
   * the openclaw-weixin plugin's contextToken store.
   *
   * OpenClaw lowercases session ids, but the per-user contextToken (which the
   * plugin MUST echo verbatim on every outbound send) is keyed by the
   * original-case `xxx@im.wechat` id. A case mismatch makes the token lookup
   * miss, so the cron push is sent "without context" and silently dropped by
   * the WeChat gateway. The context-tokens file is the authoritative source of
   * the correctly-cased, currently-deliverable id.
   */
  async resolveWechatDeliveryTarget(
    accountId: string,
    loweredTarget: string,
  ): Promise<string> {
    try {
      const filePath = path.join(
        this.env.openclawStateDir,
        "openclaw-weixin",
        "accounts",
        `${accountId}.context-tokens.json`,
      );
      const raw = await readFile(filePath, "utf-8");
      const tokens = JSON.parse(raw) as Record<string, unknown>;
      const lowered = loweredTarget.toLowerCase();
      for (const key of Object.keys(tokens)) {
        if (key.toLowerCase() === lowered) return key;
      }
    } catch {
      // No token file / unreadable → fall back to the given target.
    }
    return loweredTarget;
  }

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

  async updateJob(
    id: string,
    patch: {
      name?: string;
      description?: string;
      enabled?: boolean;
      schedule?: CronSchedule;
      payload?: CronPayload;
      delivery?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.wsClient.request("cron.update", { id, patch });
  }

  // Channel-bound automation → announce-deliver to that channel/target.
  // Channel-less automation → mode "none": run + record the result (visible
  // in run history and the isolated cron session) WITHOUT attempting a push.
  // Falling back to channel "last" here would leak delivery to another bot's
  // most-recent channel and fail every run with a misleading error.
  private buildDelivery(
    input: Pick<CronJobCreateInput, "channelType" | "channelId" | "deliveryTo">,
  ): Record<string, unknown> {
    return input.channelType
      ? {
          mode: "announce" as const,
          // OpenClaw delivery wants the plugin channel key, e.g. WeChat's
          // "wechat" must become "openclaw-weixin" (Feishu stays "feishu").
          channel: resolveOpenClawChannelKey(input.channelType as ChannelType),
          accountId: input.channelId,
          // Without a target, announce delivery to an isolated cron session
          // fails ("Delivering to <channel> requires target").
          ...(input.deliveryTo ? { to: input.deliveryTo } : {}),
        }
      : { mode: "none" as const };
  }

  private buildJobFields(input: CronJobCreateInput): {
    name: string;
    enabled: boolean;
    schedule: CronSchedule;
    payload: CronPayload;
    delivery: Record<string, unknown>;
  } {
    return {
      name: input.name,
      enabled: input.enabled,
      schedule: {
        kind: "cron",
        expr: input.cron,
        tz: input.timezone,
      },
      payload: {
        kind: "agentTurn",
        message: input.prompt,
        // cron.add rejects model:null — omit when unset. Clearing an existing
        // override happens via the cron.update patch (updateJobFromSchedule).
        ...(input.modelId?.trim() ? { model: input.modelId } : {}),
      },
      delivery: this.buildDelivery(input),
    };
  }

  async createJob(input: CronJobCreateInput): Promise<string> {
    const result = await this.wsClient.request<{ id: string }>("cron.add", {
      ...this.buildJobFields(input),
      description: input.description ?? `nexuScheduleId:${input.scheduleId}`,
      agentId: input.agentId,
      sessionTarget: "isolated",
      sessionKey: `agent:${input.agentId}:schedule-${input.scheduleId}`,
    });
    return result.id;
  }

  /**
   * In-place edit of an existing cron job from the nexu schedule shape
   * (OpenClaw >=2026.7.1 cron.update). Preserves the job id and its run
   * history — no delete/recreate.
   */
  async updateJobFromSchedule(
    externalId: string,
    input: CronJobCreateInput,
  ): Promise<void> {
    const fields = this.buildJobFields(input);
    await this.updateJob(externalId, {
      ...fields,
      payload: {
        ...fields.payload,
        // Patch semantics: null explicitly clears a previous override.
        model: input.modelId?.trim() ? input.modelId : null,
      },
    });
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
