import type { ScheduleResponse, SessionResponse } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import type { SessionsRuntime } from "../src/runtime/sessions-runtime.js";
import type {
  CronEvent,
  CronRunsResponse,
  OpenClawCronGateway,
} from "../src/services/openclaw-cron-gateway.js";
import type { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import { ScheduleService } from "../src/services/schedule-service.js";
import type { NexuConfigStore } from "../src/store/nexu-config-store.js";

function scheduleFixture(): ScheduleResponse {
  return {
    id: "schedule-1",
    botId: "bot-1",
    name: "Daily report",
    cron: "0 9 * * *",
    timezone: "Asia/Shanghai",
    prompt: "Summarize the project",
    enabled: true,
    source: "ui",
    channelType: "feishu",
    channelId: "feishu-account",
    onlyNotifyOnChange: true,
    failureAlertEnabled: true,
    failureAlertAfter: 3,
    externalId: "job-1",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
}

function sessionFixture(): SessionResponse {
  return {
    id: "session-1",
    botId: "bot-1",
    sessionKey: "agent:bot-1:feishu:group:oc_report",
    channelType: "feishu",
    channelId: "feishu-account",
    title: "Project report",
    status: "active",
    messageCount: 2,
    lastMessageAt: "2026-08-03T08:00:00.000Z",
    metadata: null,
    createdAt: "2026-08-03T07:00:00.000Z",
    updatedAt: "2026-08-03T08:00:00.000Z",
  };
}

describe("ScheduleService change-only notifications", () => {
  it("rejects notification edits on agent-created schedules", async () => {
    const schedule = { ...scheduleFixture(), source: "agent" as const };
    const service = new ScheduleService(
      {
        getConfig: vi.fn(async () => ({ schedules: [schedule], bots: [] })),
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn(() => () => undefined),
      } as unknown as OpenClawCronGateway,
      {
        syncAll: vi.fn(async () => undefined),
      } as unknown as OpenClawSyncService,
      { listSessions: vi.fn() } as unknown as SessionsRuntime,
    );

    await expect(
      service.updateSchedule(schedule.id, { onlyNotifyOnChange: false }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects notification settings when no deliverable conversation exists", async () => {
    const createSchedule = vi.fn();
    const service = new ScheduleService(
      {
        createSchedule,
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn(() => () => undefined),
      } as unknown as OpenClawCronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => []),
      } as unknown as SessionsRuntime,
    );

    await expect(
      service.createSchedule({
        botId: "bot-1",
        name: "Daily report",
        cron: "0 9 * * *",
        timezone: "Asia/Shanghai",
        prompt: "Summarize the project",
        enabled: true,
        source: "ui",
        channelType: "feishu",
        channelId: "feishu-account",
        onlyNotifyOnChange: true,
        failureAlertEnabled: false,
        failureAlertAfter: 3,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("routes notifications through the requested channel account", async () => {
    const schedule = scheduleFixture();
    const createJob = vi.fn(async () => "job-1");
    const service = new ScheduleService(
      {
        createSchedule: vi.fn(async () => schedule),
        setScheduleExternalId: vi.fn(async () => schedule),
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn(() => () => undefined),
        createJob,
      } as unknown as OpenClawCronGateway,
      {
        syncAll: vi.fn(async () => undefined),
      } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => [
          {
            ...sessionFixture(),
            id: "wrong-account-session",
            channelId: "other-account",
            sessionKey: "agent:bot-1:feishu:group:oc_other",
            lastMessageAt: "2026-08-03T10:00:00.000Z",
          },
          sessionFixture(),
        ]),
      } as unknown as SessionsRuntime,
    );

    await service.createSchedule({
      botId: schedule.botId,
      name: schedule.name,
      cron: schedule.cron,
      timezone: schedule.timezone,
      prompt: schedule.prompt,
      enabled: schedule.enabled,
      source: schedule.source,
      channelType: schedule.channelType,
      channelId: schedule.channelId,
      onlyNotifyOnChange: true,
      failureAlertEnabled: false,
      failureAlertAfter: 3,
    });

    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "feishu-account",
        deliveryTo: "chat:oc_report",
      }),
    );
  });

  it("rolls back a notification schedule when OpenClaw registration fails", async () => {
    const schedule = scheduleFixture();
    const deleteSchedule = vi.fn(async () => true);
    const service = new ScheduleService(
      {
        createSchedule: vi.fn(async () => schedule),
        deleteSchedule,
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn(() => () => undefined),
        createJob: vi.fn(async () => {
          throw new Error("gateway unavailable");
        }),
      } as unknown as OpenClawCronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => [sessionFixture()]),
      } as unknown as SessionsRuntime,
    );

    await expect(
      service.createSchedule({
        botId: schedule.botId,
        name: schedule.name,
        cron: schedule.cron,
        timezone: schedule.timezone,
        prompt: schedule.prompt,
        enabled: schedule.enabled,
        source: schedule.source,
        channelType: schedule.channelType,
        channelId: schedule.channelId,
        onlyNotifyOnChange: true,
        failureAlertEnabled: true,
        failureAlertAfter: 3,
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(deleteSchedule).toHaveBeenCalledWith(schedule.id);
  });

  it("restores the complete schedule when a notification update fails", async () => {
    const existing = {
      ...scheduleFixture(),
      lastOutputFingerprint: "previous-fingerprint",
      lastOutputObservedAt: "2026-08-03T09:00:00.000Z",
      lastOutputNotificationStatus: "delivered" as const,
    };
    const updated = {
      ...existing,
      name: "Changed report",
      prompt: "Changed prompt",
      failureAlertAfter: 4,
      lastOutputFingerprint: undefined,
      lastOutputObservedAt: undefined,
      lastOutputNotificationStatus: undefined,
    };
    const updateSchedule = vi
      .fn()
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(existing);
    const recordScheduleOutputNotification = vi.fn(async () => existing);
    const service = new ScheduleService(
      {
        getConfig: vi.fn(async () => ({ schedules: [existing], bots: [] })),
        updateSchedule,
        recordScheduleOutputNotification,
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn(() => () => undefined),
        updateJobFromSchedule: vi.fn(async () => {
          throw new Error("gateway unavailable");
        }),
      } as unknown as OpenClawCronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => [sessionFixture()]),
      } as unknown as SessionsRuntime,
    );

    await expect(
      service.updateSchedule(existing.id, {
        name: updated.name,
        prompt: updated.prompt,
        failureAlertAfter: updated.failureAlertAfter,
      }),
    ).rejects.toMatchObject({ status: 502 });

    expect(updateSchedule).toHaveBeenNthCalledWith(2, existing.id, {
      name: existing.name,
      cron: existing.cron,
      timezone: existing.timezone,
      prompt: existing.prompt,
      enabled: existing.enabled,
      source: existing.source,
      sessionKey: "",
      channelType: existing.channelType,
      channelId: existing.channelId,
      description: "",
      modelId: "",
      onlyNotifyOnChange: existing.onlyNotifyOnChange,
      failureAlertEnabled: existing.failureAlertEnabled,
      failureAlertAfter: existing.failureAlertAfter,
    });
    expect(recordScheduleOutputNotification).toHaveBeenCalledWith(existing.id, {
      fingerprint: existing.lastOutputFingerprint,
      observedAt: existing.lastOutputObservedAt,
      status: existing.lastOutputNotificationStatus,
    });
  });

  it("delivers the first output, suppresses a repeat, and delivers a change", async () => {
    let schedule = scheduleFixture();
    let onCronEvent: ((event: CronEvent) => void) | undefined;
    const recordScheduleOutputNotification = vi.fn(
      async (
        _id: string,
        input: {
          fingerprint: string;
          observedAt: string;
          status: "delivered" | "suppressed" | "failed";
          error?: string;
        },
      ) => {
        schedule = {
          ...schedule,
          lastOutputFingerprint: input.fingerprint,
          lastOutputObservedAt: input.observedAt,
          lastOutputNotificationStatus: input.status,
          lastOutputNotificationError: input.error,
        };
        return schedule;
      },
    );
    const configStore = {
      getConfig: vi.fn(async () => ({ schedules: [schedule], bots: [] })),
      recordScheduleOutputNotification,
    } as unknown as NexuConfigStore;
    const sendOutput = vi.fn(async () => undefined);
    const cronGateway = {
      onEvent: vi.fn((handler: (event: CronEvent) => void) => {
        onCronEvent = handler;
        return () => undefined;
      }),
      sendOutput,
    } as unknown as OpenClawCronGateway;
    const sessionsRuntime = {
      listSessions: vi.fn(async () => [sessionFixture()]),
    } as unknown as SessionsRuntime;

    new ScheduleService(
      configStore,
      cronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      sessionsRuntime,
    );
    if (!onCronEvent) throw new Error("cron event listener was not registered");

    onCronEvent({
      action: "finished",
      jobId: "job-1",
      status: "ok",
      summary: "No incidents\r\nAll systems operational",
      runAtMs: 1_754_205_600_000,
    });
    await vi.waitFor(() => expect(sendOutput).toHaveBeenCalledTimes(1));
    expect(sendOutput).toHaveBeenLastCalledWith({
      channel: "feishu",
      to: "chat:oc_report",
      message: "No incidents\nAll systems operational",
      accountId: "feishu-account",
      sessionKey: undefined,
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(recordScheduleOutputNotification).toHaveBeenLastCalledWith(
      "schedule-1",
      expect.objectContaining({
        status: "delivered",
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    onCronEvent({
      action: "finished",
      jobId: "job-1",
      status: "ok",
      summary: "No incidents\nAll systems operational",
      runAtMs: 1_754_209_200_000,
    });
    await vi.waitFor(() =>
      expect(recordScheduleOutputNotification).toHaveBeenCalledTimes(2),
    );
    expect(sendOutput).toHaveBeenCalledTimes(1);
    expect(recordScheduleOutputNotification).toHaveBeenLastCalledWith(
      "schedule-1",
      expect.objectContaining({ status: "suppressed" }),
    );

    onCronEvent({
      action: "finished",
      jobId: "job-1",
      status: "ok",
      summary: "One incident detected",
      runAtMs: 1_754_212_800_000,
    });
    await vi.waitFor(() => expect(sendOutput).toHaveBeenCalledTimes(2));
    expect(sendOutput).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "One incident detected" }),
    );
    expect(recordScheduleOutputNotification).toHaveBeenLastCalledWith(
      "schedule-1",
      expect.objectContaining({ status: "delivered" }),
    );
  });

  it("continues the per-job queue after a previous delivery attempt rejects", async () => {
    const schedule = scheduleFixture();
    let onCronEvent: ((event: CronEvent) => void) | undefined;
    const getConfig = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary config read failure"))
      .mockResolvedValue({ schedules: [schedule], bots: [] });
    const sendOutput = vi.fn(async () => undefined);
    const recordScheduleOutputNotification = vi.fn(async () => schedule);
    const service = new ScheduleService(
      {
        getConfig,
        recordScheduleOutputNotification,
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn((handler: (event: CronEvent) => void) => {
          onCronEvent = handler;
          return () => undefined;
        }),
        sendOutput,
      } as unknown as OpenClawCronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => [sessionFixture()]),
      } as unknown as SessionsRuntime,
    );
    expect(service).toBeTruthy();
    if (!onCronEvent) throw new Error("cron event listener was not registered");

    onCronEvent({
      action: "finished",
      jobId: "job-1",
      status: "ok",
      summary: "First output",
      runAtMs: 1_754_205_600_000,
    });
    onCronEvent({
      action: "finished",
      jobId: "job-1",
      status: "ok",
      summary: "Second output",
      runAtMs: 1_754_209_200_000,
    });

    await vi.waitFor(() => expect(sendOutput).toHaveBeenCalledOnce());
    expect(sendOutput).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Second output" }),
    );
  });

  it("does not let a recovered older run replace a newer realtime cursor", async () => {
    let schedule = scheduleFixture();
    let onCronEvent: ((event: CronEvent) => void) | undefined;
    let resolveRuns: ((value: CronRunsResponse) => void) | undefined;
    const runs = new Promise<CronRunsResponse>((resolve) => {
      resolveRuns = resolve;
    });
    const recordScheduleOutputNotification = vi.fn(
      async (
        _id: string,
        input: {
          fingerprint: string;
          observedAt: string;
          status: "delivered" | "suppressed" | "failed";
          error?: string;
        },
      ) => {
        const currentObservedAtMs = schedule.lastOutputObservedAt
          ? Date.parse(schedule.lastOutputObservedAt)
          : Number.NaN;
        const nextObservedAtMs = Date.parse(input.observedAt);
        if (
          Number.isFinite(currentObservedAtMs) &&
          nextObservedAtMs < currentObservedAtMs
        ) {
          return schedule;
        }
        schedule = {
          ...schedule,
          lastOutputFingerprint: input.fingerprint,
          lastOutputObservedAt: input.observedAt,
          lastOutputNotificationStatus: input.status,
          lastOutputNotificationError: input.error,
        };
        return schedule;
      },
    );
    const getRuns = vi.fn(() => runs);
    const sendOutput = vi.fn(async () => undefined);
    const service = new ScheduleService(
      {
        getConfig: vi.fn(async () => ({ schedules: [schedule], bots: [] })),
        recordScheduleOutputNotification,
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn((handler: (event: CronEvent) => void) => {
          onCronEvent = handler;
          return () => undefined;
        }),
        getRuns,
        sendOutput,
      } as unknown as OpenClawCronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => [sessionFixture()]),
      } as unknown as SessionsRuntime,
    );

    const bootstrap = service.bootstrap();
    await vi.waitFor(() => expect(getRuns).toHaveBeenCalledOnce());
    if (!onCronEvent) throw new Error("cron event listener was not registered");

    const newerRunAtMs = 1_754_212_800_000;
    onCronEvent({
      action: "finished",
      jobId: "job-1",
      status: "ok",
      summary: "New realtime output",
      runAtMs: newerRunAtMs,
    });
    await vi.waitFor(() => expect(sendOutput).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(schedule.lastOutputObservedAt).toBe(
        new Date(newerRunAtMs).toISOString(),
      ),
    );

    resolveRuns?.({
      entries: [
        {
          ts: 1_754_209_200_000,
          jobId: "job-1",
          action: "finished",
          status: "ok",
          summary: "Older recovered output",
          runAtMs: 1_754_209_200_000,
        },
      ],
      total: 1,
      offset: 0,
      limit: 100,
      hasMore: false,
      nextOffset: null,
    });
    await bootstrap;

    expect(sendOutput).toHaveBeenCalledOnce();
    expect(sendOutput).toHaveBeenCalledWith(
      expect.objectContaining({ message: "New realtime output" }),
    );
    expect(recordScheduleOutputNotification).toHaveBeenCalledOnce();
    expect(schedule.lastOutputObservedAt).toBe(
      new Date(newerRunAtMs).toISOString(),
    );
  });

  it("reconciles the latest successful output during startup", async () => {
    let schedule = scheduleFixture();
    const recordScheduleOutputNotification = vi.fn(
      async (
        _id: string,
        input: {
          fingerprint: string;
          observedAt: string;
          status: "delivered" | "suppressed" | "failed";
          error?: string;
        },
      ) => {
        schedule = {
          ...schedule,
          lastOutputFingerprint: input.fingerprint,
          lastOutputObservedAt: input.observedAt,
          lastOutputNotificationStatus: input.status,
          lastOutputNotificationError: input.error,
        };
        return schedule;
      },
    );
    const sendOutput = vi.fn(async () => undefined);
    const getRuns = vi.fn(async () => ({
      entries: [
        {
          ts: 1_754_209_200_000,
          jobId: "job-1",
          action: "finished" as const,
          status: "ok" as const,
          summary: "Latest recovered output",
          runAtMs: 1_754_209_200_000,
        },
        {
          ts: 1_754_205_600_000,
          jobId: "job-1",
          action: "finished" as const,
          status: "ok" as const,
          summary: "Older recovered output",
          runAtMs: 1_754_205_600_000,
        },
      ],
      total: 2,
      offset: 0,
      limit: 100,
      hasMore: false,
      nextOffset: null,
    }));
    const service = new ScheduleService(
      {
        getConfig: vi.fn(async () => ({ schedules: [schedule], bots: [] })),
        recordScheduleOutputNotification,
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn(() => () => undefined),
        getRuns,
        sendOutput,
      } as unknown as OpenClawCronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => [sessionFixture()]),
      } as unknown as SessionsRuntime,
    );

    await service.bootstrap();

    expect(getRuns).toHaveBeenCalledWith("job-1", {
      limit: 100,
      offset: 0,
    });
    expect(sendOutput).toHaveBeenCalledOnce();
    expect(sendOutput).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Latest recovered output" }),
    );
    expect(recordScheduleOutputNotification).toHaveBeenCalledWith(
      "schedule-1",
      expect.objectContaining({
        observedAt: new Date(1_754_209_200_000).toISOString(),
        status: "delivered",
      }),
    );
  });

  it("reconciles a missed reconnect run without redelivering observed runs", async () => {
    const observedAtMs = 1_754_205_600_000;
    let schedule: ScheduleResponse = {
      ...scheduleFixture(),
      lastOutputFingerprint: "existing-fingerprint",
      lastOutputObservedAt: new Date(observedAtMs).toISOString(),
      lastOutputNotificationStatus: "delivered",
    };
    const recordScheduleOutputNotification = vi.fn(
      async (
        _id: string,
        input: {
          fingerprint: string;
          observedAt: string;
          status: "delivered" | "suppressed" | "failed";
          error?: string;
        },
      ) => {
        schedule = {
          ...schedule,
          lastOutputFingerprint: input.fingerprint,
          lastOutputObservedAt: input.observedAt,
          lastOutputNotificationStatus: input.status,
          lastOutputNotificationError: input.error,
        };
        return schedule;
      },
    );
    const oldRun = {
      ts: observedAtMs,
      jobId: "job-1",
      action: "finished" as const,
      status: "ok" as const,
      summary: "Already observed",
      runAtMs: observedAtMs,
    };
    const missedRunAtMs = 1_754_209_200_000;
    const missedRun = {
      ts: missedRunAtMs,
      jobId: "job-1",
      action: "finished" as const,
      status: "ok" as const,
      summary: "Recovered after reconnect",
      runAtMs: missedRunAtMs,
    };
    const getRuns = vi
      .fn()
      .mockResolvedValueOnce({
        entries: [oldRun],
        total: 1,
        offset: 0,
        limit: 100,
        hasMore: false,
        nextOffset: null,
      })
      .mockResolvedValue({
        entries: [missedRun, oldRun],
        total: 2,
        offset: 0,
        limit: 100,
        hasMore: false,
        nextOffset: null,
      });
    const sendOutput = vi.fn(async () => undefined);
    const service = new ScheduleService(
      {
        getConfig: vi.fn(async () => ({ schedules: [schedule], bots: [] })),
        recordScheduleOutputNotification,
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn(() => () => undefined),
        getRuns,
        sendOutput,
      } as unknown as OpenClawCronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => [sessionFixture()]),
      } as unknown as SessionsRuntime,
    );

    await service.bootstrap();
    expect(sendOutput).not.toHaveBeenCalled();

    await service.handleGatewayConnected();
    await service.handleGatewayConnected();

    expect(sendOutput).toHaveBeenCalledOnce();
    expect(sendOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Recovered after reconnect",
        idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(recordScheduleOutputNotification).toHaveBeenCalledOnce();
  });

  it("retries a failed recovered delivery with the same idempotency key", async () => {
    let schedule = scheduleFixture();
    const recordScheduleOutputNotification = vi.fn(
      async (
        _id: string,
        input: {
          fingerprint: string;
          observedAt: string;
          status: "delivered" | "suppressed" | "failed";
          error?: string;
        },
      ) => {
        schedule = {
          ...schedule,
          lastOutputFingerprint: input.fingerprint,
          lastOutputObservedAt: input.observedAt,
          lastOutputNotificationStatus: input.status,
          lastOutputNotificationError: input.error,
        };
        return schedule;
      },
    );
    const runAtMs = 1_754_209_200_000;
    const getRuns = vi.fn(async () => ({
      entries: [
        {
          ts: runAtMs,
          jobId: "job-1",
          action: "finished" as const,
          status: "ok" as const,
          summary: "Retry recovered output",
          runAtMs,
        },
      ],
      total: 1,
      offset: 0,
      limit: 100,
      hasMore: false,
      nextOffset: null,
    }));
    const sendOutput = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(undefined);
    const service = new ScheduleService(
      {
        getConfig: vi.fn(async () => ({ schedules: [schedule], bots: [] })),
        recordScheduleOutputNotification,
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn(() => () => undefined),
        getRuns,
        sendOutput,
      } as unknown as OpenClawCronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => [sessionFixture()]),
      } as unknown as SessionsRuntime,
    );

    await service.bootstrap();
    expect(schedule.lastOutputNotificationStatus).toBe("failed");

    await service.handleGatewayConnected();
    await service.handleGatewayConnected();

    expect(sendOutput).toHaveBeenCalledTimes(2);
    const firstKey = sendOutput.mock.calls[0]?.[0]?.idempotencyKey;
    const retryKey = sendOutput.mock.calls[1]?.[0]?.idempotencyKey;
    expect(firstKey).toMatch(/^[a-f0-9]{64}$/);
    expect(retryKey).toBe(firstKey);
    expect(schedule.lastOutputNotificationStatus).toBe("delivered");
  });

  it("retries bootstrap registration after the gateway reconnects", async () => {
    let schedule: ScheduleResponse = {
      ...scheduleFixture(),
      externalId: undefined,
    };
    const createJob = vi
      .fn()
      .mockRejectedValueOnce(new Error("gateway unavailable"))
      .mockResolvedValueOnce("job-recovered");
    const setScheduleExternalId = vi.fn(
      async (scheduleId: string, externalId: string) => {
        if (schedule.id === scheduleId) {
          schedule = { ...schedule, externalId };
        }
      },
    );
    const listJobs = vi.fn(async () => []);
    const service = new ScheduleService(
      {
        getConfig: vi.fn(async () => ({ schedules: [schedule], bots: [] })),
        setScheduleExternalId,
      } as unknown as NexuConfigStore,
      {
        onEvent: vi.fn(() => () => undefined),
        createJob,
        getRuns: vi.fn(async () => ({
          entries: [],
          total: 0,
          offset: 0,
          limit: 100,
          hasMore: false,
          nextOffset: null,
        })),
        listJobs,
      } as unknown as OpenClawCronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      {
        listSessions: vi.fn(async () => [sessionFixture()]),
      } as unknown as SessionsRuntime,
    );

    await service.bootstrap();

    expect(createJob).toHaveBeenCalledOnce();
    await expect(service.listSchedules()).resolves.toEqual([
      expect.objectContaining({ id: schedule.id, enabled: false }),
    ]);

    await service.handleGatewayConnected();

    expect(createJob).toHaveBeenCalledTimes(2);
    expect(setScheduleExternalId).toHaveBeenCalledWith(
      schedule.id,
      "job-recovered",
    );
    expect(schedule.externalId).toBe("job-recovered");
  });

  it("surfaces native next-run, duration, and output destination state", async () => {
    const schedule = scheduleFixture();
    const cronGateway = {
      onEvent: vi.fn(() => () => undefined),
      listJobs: vi.fn(async () => [
        {
          id: "job-1",
          agentId: "bot-1",
          name: schedule.name,
          enabled: true,
          createdAtMs: 1_754_176_000_000,
          updatedAtMs: 1_754_176_100_000,
          schedule: {
            kind: "cron",
            expr: schedule.cron,
            tz: schedule.timezone,
          },
          payload: { kind: "agentTurn", message: schedule.prompt },
          delivery: {
            mode: "none",
            channel: "feishu",
            to: "chat:oc_report",
            accountId: "feishu-account",
          },
          failureAlert: { after: 3, mode: "announce" },
          state: {
            nextRunAtMs: 1_754_262_000_000,
            lastRunAtMs: 1_754_175_000_000,
            lastDurationMs: 4_250,
            lastRunStatus: "ok",
            lastDeliveryStatus: "not-requested",
          },
        },
      ]),
    } as unknown as OpenClawCronGateway;
    const service = new ScheduleService(
      {
        getConfig: vi.fn(async () => ({ schedules: [schedule], bots: [] })),
      } as unknown as NexuConfigStore,
      cronGateway,
      { syncAll: vi.fn() } as unknown as OpenClawSyncService,
      { listSessions: vi.fn() } as unknown as SessionsRuntime,
    );

    await expect(service.listSchedules()).resolves.toEqual([
      expect.objectContaining({
        nextRunAtMs: 1_754_262_000_000,
        lastDurationMs: 4_250,
        lastRunStatus: "ok",
        deliveryChannel: "feishu",
        deliveryTo: "chat:oc_report",
      }),
    ]);
  });
});
