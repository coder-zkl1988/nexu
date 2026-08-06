import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ScheduleResponse } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import type { OpenClawWsClient } from "../src/runtime/openclaw-ws-client.js";
import {
  type CronJob,
  OpenClawCronGateway,
  mapCronJobToScheduleItem,
  mergeCronJobRuntimeState,
} from "../src/services/openclaw-cron-gateway.js";

function createGateway(
  request: ReturnType<typeof vi.fn>,
  openclawStateDir = "/tmp/openclaw-state",
) {
  return new OpenClawCronGateway(
    {
      request,
      isConnected: () => true,
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as OpenClawWsClient,
    { openclawStateDir } as ControllerEnv,
  );
}

function uiSchedule(): ScheduleResponse {
  return {
    id: "schedule-1",
    botId: "bot-1",
    name: "Daily report",
    cron: "0 9 * * *",
    timezone: "Asia/Shanghai",
    prompt: "Summarize the project",
    enabled: true,
    source: "ui",
    onlyNotifyOnChange: true,
    failureAlertEnabled: true,
    failureAlertAfter: 2,
    externalId: "job-1",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
}

function cronJob(): CronJob {
  return {
    id: "job-1",
    agentId: "bot-1",
    name: "Daily report",
    enabled: true,
    createdAtMs: 1_754_176_000_000,
    updatedAtMs: 1_754_176_100_000,
    schedule: {
      kind: "cron",
      expr: "0 9 * * *",
      tz: "Asia/Shanghai",
    },
    payload: { kind: "agentTurn", message: "Summarize the project" },
    delivery: {
      mode: "none",
      channel: "feishu",
      to: "chat:oc_report",
      accountId: "feishu-account",
    },
    failureAlert: {
      after: 2,
      mode: "announce",
      channel: "feishu",
      to: "chat:oc_report",
      accountId: "feishu-account",
    },
    state: {
      nextRunAtMs: 1_754_262_000_000,
      lastRunAtMs: 1_754_175_000_000,
      lastDurationMs: 4_250,
      lastRunStatus: "ok",
      lastDeliveryStatus: "not-requested",
    },
  };
}

describe("OpenClawCronGateway automation delivery", () => {
  it("paginates all cron jobs before applying an exact agent filter", async () => {
    const first = cronJob();
    const second = { ...cronJob(), id: "job-2" };
    const request = vi.fn(async (_method: string, params: unknown) => {
      const offset =
        params && typeof params === "object" && "offset" in params
          ? params.offset
          : 0;
      return offset === 0
        ? {
            jobs: [first],
            total: 2,
            offset: 0,
            limit: 1,
            hasMore: true,
            nextOffset: 1,
          }
        : {
            jobs: [second],
            total: 2,
            offset: 1,
            limit: 1,
            hasMore: false,
            nextOffset: null,
          };
    });

    await expect(createGateway(request).listJobs("bot-1")).resolves.toEqual([
      first,
      second,
    ]);
    expect(request).toHaveBeenNthCalledWith(1, "cron.list", {
      includeDisabled: true,
      limit: 200,
      offset: 0,
    });
    expect(request).toHaveBeenNthCalledWith(2, "cron.list", {
      includeDisabled: true,
      limit: 200,
      offset: 1,
    });
  });

  it("rejects when cron.list and the local cron snapshot are both unavailable", async () => {
    const openclawStateDir = await mkdtemp(
      path.join(tmpdir(), "nexu-cron-unavailable-"),
    );
    try {
      const request = vi.fn(async () => {
        throw new Error("gateway unavailable");
      });

      await expect(
        createGateway(request, openclawStateDir).listJobs(),
      ).rejects.toThrow(/ENOENT/);
    } finally {
      await rm(openclawStateDir, { recursive: true, force: true });
    }
  });

  it("uses native failureAlert while reserving delivery for change detection", async () => {
    const request = vi.fn(async () => ({ id: "job-1" }));
    const gateway = createGateway(request);

    await gateway.createJob({
      name: "Daily report",
      agentId: "bot-1",
      enabled: true,
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      prompt: "Summarize the project",
      channelType: "feishu",
      channelId: "feishu-account",
      deliveryTo: "chat:oc_report",
      scheduleId: "schedule-1",
      onlyNotifyOnChange: true,
      failureAlertEnabled: true,
      failureAlertAfter: 2,
    });

    expect(request).toHaveBeenCalledWith(
      "cron.add",
      expect.objectContaining({
        delivery: {
          mode: "none",
          channel: "feishu",
          accountId: "feishu-account",
          to: "chat:oc_report",
        },
        failureAlert: {
          after: 2,
          mode: "announce",
          channel: "feishu",
          accountId: "feishu-account",
          to: "chat:oc_report",
        },
      }),
    );
  });

  it("hydrates persisted and agent schedules from native cron state", () => {
    const job = cronJob();

    expect(mergeCronJobRuntimeState(uiSchedule(), job)).toMatchObject({
      enabled: true,
      nextRunAtMs: 1_754_262_000_000,
      lastRunAtMs: 1_754_175_000_000,
      lastDurationMs: 4_250,
      lastRunStatus: "ok",
      lastDeliveryStatus: "not-requested",
      deliveryMode: "none",
      deliveryChannel: "feishu",
      deliveryTo: "chat:oc_report",
      failureAlertEnabled: true,
      failureAlertAfter: 2,
    });
    expect(
      mergeCronJobRuntimeState(uiSchedule(), { ...job, enabled: false })
        .enabled,
    ).toBe(false);
    expect(mapCronJobToScheduleItem(job)).toMatchObject({
      source: "agent",
      nextRunAtMs: 1_754_262_000_000,
      lastDurationMs: 4_250,
      deliveryTo: "chat:oc_report",
      failureAlertEnabled: true,
      failureAlertAfter: 2,
    });
  });
});
