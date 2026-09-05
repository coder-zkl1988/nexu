import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceExecuteTaskBody, DeviceInfo } from "@nexu/shared";
import { afterAll, describe, expect, it } from "vitest";
import { XhsOpsRunService } from "../src/services/xhs-ops-run-service.js";
import { XhsOpsStore } from "../src/store/xhs-ops-store.js";

const tempDir = mkdtempSync(join(tmpdir(), "xhs-ops-queue-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

const PLAN = {
  keywords: [{ keyword: "亲子酒店", count: 1 }],
  homeFeedCount: 0,
  dwellSecMin: 10,
  dwellSecMax: 20,
  interaction: {
    like: { enabled: false, dailyCap: 0, ratioPercent: 0 },
    collect: { enabled: false, dailyCap: 0, ratioPercent: 0 },
    follow: { enabled: false, dailyCap: 0, ratioPercent: 0 },
    comment: { enabled: false },
  },
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function taskResult(message: string) {
  return { result: { taskId: "t", success: true, message } };
}

const DONE_MESSAGE =
  '完成\nRECORD_JSON:{"v":1,"mode":"search","keyword":"亲子酒店","planned":1,"browsed":1,"skipped":0,"interactions":{"like":0,"collect":0,"follow":0},"anomalies":[],"posts":[],"observation":"ok"}';

async function until(pred: () => Promise<boolean> | boolean, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("condition not met in time");
}

describe("XhsOpsRunService device queue (P2-4 同一手机串行)", () => {
  it("second run on the same phone waits in the queue and starts after the first drains", async () => {
    const store = new XhsOpsStore(join(tempDir, "q1.json"));
    const project = await store.createProject({ name: "队列" });
    const mk = (label: string) =>
      store.createAccount({
        projectId: project.id,
        label,
        deviceId: "dev-1",
        deviceName: "dev-1",
      });
    const a = await mk("A");
    const b = await mk("B");
    const c = await mk("C-other-phone");
    await store.updateAccount(c.id, { deviceId: "dev-2", deviceName: "dev-2" });

    const gates: Array<ReturnType<typeof deferred<DeviceExecuteTaskBody>>> = [];
    const executed: string[] = [];
    const service = new XhsOpsRunService({
      store,
      deviceControl: {
        getDevice: async (id: string) =>
          ({
            deviceId: id,
            status: "idle",
            lastSeen: Date.now(),
          }) as DeviceInfo,
        executeTask: async (deviceId: string, _body: DeviceExecuteTaskBody) => {
          executed.push(deviceId);
          const gate = deferred<DeviceExecuteTaskBody>();
          gates.push(gate);
          await gate.promise;
          return taskResult(DONE_MESSAGE);
        },
        cancelTask: async () => {},
      },
      options: { idlePollIntervalMs: 5 },
    });

    const runA = await service.createRun({
      projectId: project.id,
      accountId: a.id,
      plan: PLAN,
    });
    const runB = await service.createRun({
      projectId: project.id,
      accountId: b.id,
      plan: PLAN,
    });
    const runC = await service.createRun({
      projectId: project.id,
      accountId: c.id,
      plan: PLAN,
    });

    const startedA = await service.startRun(runA.id);
    expect(startedA.status).toBe("running");
    const startedB = await service.startRun(runB.id);
    expect(startedB.status).toBe("planned");
    expect(startedB.queuedBehindRunId).toBe(runA.id);
    expect(service.queuedRunIds("dev-1")).toEqual([runB.id]);
    // 另一部手机不受影响
    const startedC = await service.startRun(runC.id);
    expect(startedC.status).toBe("running");

    // 再次 start 一个排队中的 run 不会重复入队
    const again = await service.startRun(runB.id);
    expect(again.queuedBehindRunId).toBe(runA.id);
    expect(service.queuedRunIds("dev-1")).toEqual([runB.id]);

    await until(() => executed.filter((d) => d === "dev-1").length === 1);
    gates[0]?.resolve({} as DeviceExecuteTaskBody); // A 的手机任务结束
    await service.waitForRun(runA.id);
    await until(
      async () => (await store.getRun(runB.id))?.status === "running",
    );
    const b2 = await store.getRun(runB.id);
    expect(b2?.queuedBehindRunId).toBeNull();
    expect(service.queuedRunIds("dev-1")).toEqual([]);

    // 收尾：放行剩余任务
    await until(() => gates.length >= 3);
    for (const g of gates) g.resolve({} as DeviceExecuteTaskBody);
    await service.waitForRun(runB.id);
    await service.waitForRun(runC.id);
    expect((await store.getRun(runB.id))?.status).toBe("completed");
  });

  it("a queued run can be cancelled without touching the phone, and recovery clears orphaned queue marks", async () => {
    const store = new XhsOpsStore(join(tempDir, "q2.json"));
    const project = await store.createProject({ name: "队列取消" });
    const a = await store.createAccount({
      projectId: project.id,
      label: "A",
      deviceId: "dev-1",
      deviceName: "dev-1",
    });
    const b = await store.createAccount({
      projectId: project.id,
      label: "B",
      deviceId: "dev-1",
      deviceName: "dev-1",
    });
    const gate = deferred<void>();
    let cancelCalls = 0;
    const service = new XhsOpsRunService({
      store,
      deviceControl: {
        getDevice: async (id: string) =>
          ({
            deviceId: id,
            status: "idle",
            lastSeen: Date.now(),
          }) as DeviceInfo,
        executeTask: async () => {
          await gate.promise;
          return taskResult(DONE_MESSAGE);
        },
        cancelTask: async () => {
          cancelCalls += 1;
        },
      },
      options: { idlePollIntervalMs: 5 },
    });
    const runA = await service.createRun({
      projectId: project.id,
      accountId: a.id,
      plan: PLAN,
    });
    const runB = await service.createRun({
      projectId: project.id,
      accountId: b.id,
      plan: PLAN,
    });
    await service.startRun(runA.id);
    await service.startRun(runB.id);
    const cancelled = await service.cancelRun(runB.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.queuedBehindRunId).toBeNull();
    expect(cancelCalls).toBe(0);
    expect(service.queuedRunIds("dev-1")).toEqual([]);

    // 模拟上一进程留下的排队标记
    await store.updateRun(runB.id, (cur) => ({
      ...cur,
      status: "planned",
      queuedBehindRunId: runA.id,
    }));
    const fresh = new XhsOpsRunService({
      store,
      deviceControl: {
        getDevice: async () => null,
        executeTask: async () => taskResult(""),
        cancelTask: async () => {},
      },
    });
    await fresh.recoverInterruptedRuns();
    expect((await store.getRun(runB.id))?.queuedBehindRunId).toBeNull();
    expect((await store.getRun(runB.id))?.status).toBe("planned");

    gate.resolve();
    await service.waitForRun(runA.id);
  });
});
