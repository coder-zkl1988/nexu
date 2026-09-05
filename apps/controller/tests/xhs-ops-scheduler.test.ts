import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  XhsOpsPlanSuggestion,
  XhsOpsRun,
  XhsOpsRunCreate,
} from "@nexu/shared";
import { afterAll, describe, expect, it } from "vitest";
import {
  XhsOpsScheduler,
  isScheduleDue,
  localClock,
} from "../src/services/xhs-ops-scheduler.js";
import { XhsOpsStore } from "../src/store/xhs-ops-store.js";

const tempDir = mkdtempSync(join(tmpdir(), "xhs-ops-scheduler-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

// 2026-09-05 10:00 local
const AT_TEN = new Date(2026, 8, 5, 10, 0).getTime();
const AT_NINE = new Date(2026, 8, 5, 9, 59).getTime();

function suggestion(
  accountId: string,
  label: string,
  segment: XhsOpsPlanSuggestion["segment"] = null,
  keywords = [{ keyword: "亲子酒店", count: 3 }],
): XhsOpsPlanSuggestion {
  return {
    accountId,
    accountLabel: label,
    keywords,
    homeFeedCount: 2,
    dwellSecMin: 10,
    dwellSecMax: 20,
    interaction: {
      like: { enabled: false, dailyCap: 0, ratioPercent: 0 },
      collect: { enabled: false, dailyCap: 0, ratioPercent: 0 },
      follow: { enabled: false, dailyCap: 0, ratioPercent: 0 },
      comment: { enabled: false },
    },
    rationale: [],
    segment,
  };
}

function fakeRunService(plans: XhsOpsPlanSuggestion[]) {
  const created: XhsOpsRunCreate[] = [];
  const started: string[] = [];
  let n = 0;
  const service = {
    suggestPlans: async () => plans,
    createRun: async (input: XhsOpsRunCreate) => {
      created.push(input);
      n += 1;
      return {
        id: `run-${n}`,
        status: "planned",
        deviceId: "dev-1",
      } as XhsOpsRun;
    },
    startRun: async (runId: string) => {
      started.push(runId);
      // 第一个直接跑，之后的视作被设备队列排队（planned + queuedBehindRunId）
      const first = started.length === 1;
      return {
        id: runId,
        status: first ? "running" : "planned",
        queuedBehindRunId: first ? null : started[0],
      } as XhsOpsRun;
    },
  };
  return { service, created, started };
}

describe("XhsOpsScheduler (P2-4 每日自动执行)", () => {
  it("isScheduleDue: enabled + time reached + not fired today", () => {
    const base = {
      schedule: {
        enabled: true,
        time: "10:00",
        lastTriggeredDate: null,
        lastResult: null,
      },
    } as never;
    expect(localClock(new Date(AT_TEN))).toBe("10:00");
    expect(isScheduleDue(base, new Date(AT_TEN))).toBe(true);
    expect(isScheduleDue(base, new Date(AT_NINE))).toBe(false);
    expect(
      isScheduleDue(
        {
          schedule: {
            enabled: true,
            time: "10:00",
            lastTriggeredDate: "2026-09-05",
            lastResult: null,
          },
        } as never,
        new Date(AT_TEN),
      ),
    ).toBe(false);
    expect(
      isScheduleDue(
        {
          schedule: {
            enabled: false,
            time: "10:00",
            lastTriggeredDate: null,
            lastResult: null,
          },
        } as never,
        new Date(AT_TEN),
      ),
    ).toBe(false);
  });

  it("tick fires due projects once per day, creating and starting one run per suggestion", async () => {
    const store = new XhsOpsStore(join(tempDir, "a.json"));
    const project = await store.createProject({
      name: "定时项目",
      schedule: {
        enabled: true,
        time: "10:00",
        lastTriggeredDate: null,
        lastResult: null,
      },
    });
    await store.createProject({ name: "未启用" }); // default schedule: disabled
    const { service, created, started } = fakeRunService([
      suggestion("a", "豆豆妈", { index: 1, count: 2 }),
      suggestion("a", "豆豆妈", { index: 2, count: 2 }),
      suggestion("b", "桃子爸"),
      suggestion("c", "空池", null, []),
    ]);
    let now = AT_NINE;
    const scheduler = new XhsOpsScheduler({
      store,
      runService: service,
      now: () => now,
    });

    expect(await scheduler.tick()).toEqual([]); // 09:59 还没到
    now = AT_TEN;
    const fired = await scheduler.tick();
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      projectId: project.id,
      planned: 4,
      created: 3,
      started: 1,
      queued: 2,
    });
    expect(fired[0]?.skipped[0]).toContain("空池");
    expect(created.map((c) => c.segment)).toEqual([
      { index: 1, count: 2 },
      { index: 2, count: 2 },
      null,
    ]);
    expect(created[0]?.plan.homeFeedCount).toBe(0 + 2);
    expect(started).toEqual(["run-1", "run-2", "run-3"]);

    const after = await store.getProject(project.id);
    expect(after?.schedule.lastTriggeredDate).toBe("2026-09-05");
    expect(after?.schedule.lastResult).toContain(
      "1 个开始、2 个排队、1 个未派发",
    );
    expect(after?.schedule.lastResult).toContain("定时");

    // 同一天不再触发
    now = AT_TEN + 5 * 60_000;
    expect(await scheduler.tick()).toEqual([]);
    expect(created).toHaveLength(3);
  });

  it("manual trigger ignores enabled/time but still stamps the day; unknown project is 404", async () => {
    const store = new XhsOpsStore(join(tempDir, "b.json"));
    const project = await store.createProject({ name: "手动" });
    const { service, created } = fakeRunService([suggestion("a", "豆豆妈")]);
    const scheduler = new XhsOpsScheduler({
      store,
      runService: service,
      now: () => AT_NINE,
    });
    const result = await scheduler.triggerProject(project.id);
    expect(result).toMatchObject({ created: 1, started: 1, queued: 0 });
    expect(created).toHaveLength(1);
    const after = await store.getProject(project.id);
    expect(after?.schedule.enabled).toBe(false);
    expect(after?.schedule.lastTriggeredDate).toBe("2026-09-05");
    expect(after?.schedule.lastResult).toContain("手动");
    await expect(scheduler.triggerProject("nope")).rejects.toMatchObject({
      status: 404,
    });
  });
});
