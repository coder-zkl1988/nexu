import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeviceTaskHistoryStore } from "../src/store/device-task-history-store.js";

describe("DeviceTaskHistoryStore", () => {
  let tmpDir: string;
  let store: DeviceTaskHistoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "nexu-task-history-"));
    store = new DeviceTaskHistoryStore(path.join(tmpDir, "history.json"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends entries and returns them newest-first", async () => {
    await store.append({
      deviceId: "d1",
      taskId: "t1",
      task: "open wechat",
      dispatchedAt: "2026-04-16T00:00:00.000Z",
      completedAt: "2026-04-16T00:00:05.000Z",
      result: { taskId: "t1", success: true },
    });
    await store.append({
      deviceId: "d1",
      taskId: "t2",
      task: "send message",
      dispatchedAt: "2026-04-16T00:00:10.000Z",
      completedAt: "2026-04-16T00:00:15.000Z",
      result: { taskId: "t2", success: false },
    });

    const entries = await store.list();
    expect(entries.map((e) => e.taskId)).toEqual(["t2", "t1"]);
  });

  it("caps history at 200 entries (oldest dropped)", async () => {
    for (let i = 0; i < 210; i++) {
      await store.append({
        deviceId: "d1",
        taskId: `t${i}`,
        task: "x",
        dispatchedAt: "2026-04-16T00:00:00.000Z",
        completedAt: "2026-04-16T00:00:00.000Z",
        result: { taskId: `t${i}`, success: true },
      });
    }
    const entries = await store.list();
    expect(entries).toHaveLength(200);
    expect(entries[0].taskId).toBe("t209");
    expect(entries[199].taskId).toBe("t10");
  });

  it("serializes concurrent appends without losing entries", async () => {
    const count = 20;
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        store.append({
          deviceId: "d1",
          taskId: `t${i}`,
          task: "x",
          dispatchedAt: "2026-04-16T00:00:00.000Z",
          completedAt: "2026-04-16T00:00:00.000Z",
          result: { taskId: `t${i}`, success: true },
        }),
      ),
    );
    const entries = await store.list();
    expect(entries).toHaveLength(count);
    const ids = new Set(entries.map((e) => e.taskId));
    expect(ids.size).toBe(count);
    for (let i = 0; i < count; i++) {
      expect(ids.has(`t${i}`)).toBe(true);
    }
  });

  it("getByTaskId returns the matching entry or null", async () => {
    await store.append({
      deviceId: "d1",
      taskId: "t1",
      task: "x",
      dispatchedAt: "2026-04-16T00:00:00.000Z",
      completedAt: "2026-04-16T00:00:00.000Z",
      result: { taskId: "t1", success: true },
    });
    expect((await store.getByTaskId("t1"))?.taskId).toBe("t1");
    expect(await store.getByTaskId("missing")).toBeNull();
  });
});
