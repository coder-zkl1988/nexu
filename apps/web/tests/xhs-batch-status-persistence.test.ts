import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

const POSTS = [
  {
    id: "post-1",
    title: "第一篇",
    content: "正文一",
    images: [],
    hashtags: [],
    deviceId: "device-1",
  },
  {
    id: "post-2",
    title: "第二篇",
    content: "正文二",
    images: [],
    hashtags: [],
    deviceId: "device-1",
  },
];

describe("XHS batch publish status persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores terminal row statuses after the store module reloads", async () => {
    const beforeRefresh = await import(
      "../src/lib/a2ui/custom-components/xhs-batch-store"
    );
    beforeRefresh.seedBatch("batch-refresh", POSTS);
    beforeRefresh.setRowStatus("batch-refresh", "post-1", "success");
    beforeRefresh.setRowStatus("batch-refresh", "post-2", "error", "发布失败");

    vi.resetModules();
    const afterRefresh = await import(
      "../src/lib/a2ui/custom-components/xhs-batch-store"
    );
    afterRefresh.seedBatch("batch-refresh", POSTS);

    expect(afterRefresh.getBatch("batch-refresh").posts).toMatchObject([
      { id: "post-1", status: "success" },
      { id: "post-2", status: "error", errorMessage: "发布失败" },
    ]);
  });

  it("does not restore an interrupted in-progress phase", async () => {
    const beforeRefresh = await import(
      "../src/lib/a2ui/custom-components/xhs-batch-store"
    );
    beforeRefresh.seedBatch("batch-interrupted", POSTS);
    beforeRefresh.setRowStatus("batch-interrupted", "post-1", "success");
    beforeRefresh.setRowStatus("batch-interrupted", "post-1", "publishing");

    vi.resetModules();
    const afterRefresh = await import(
      "../src/lib/a2ui/custom-components/xhs-batch-store"
    );
    afterRefresh.seedBatch("batch-interrupted", POSTS);

    expect(afterRefresh.getBatch("batch-interrupted").posts[0]?.status).toBe(
      "idle",
    );
  });
});
