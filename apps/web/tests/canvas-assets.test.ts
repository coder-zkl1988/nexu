/**
 * canvas-assets.test.ts
 *
 * Tests for the asset library (W4.3):
 * - AssetStorage seam CRUD round-trip via an in-memory fake.
 * - Runtime asset store: save/insert/remove, lazy-load once.
 * - Pure helpers: filterAssets / paginateAssets.
 *
 * Plain Node env — no jsdom, no IndexedDB. Storage fakes injected via the seam.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCanvasAssetsForTests,
  collectAssetTags,
  ensureAssetsLoaded,
  filterAssets,
  getCanvasAssets,
  insertAssetToCanvas,
  normalizeTags,
  paginateAssets,
  removeAsset,
  saveNodeAsAsset,
  updateAssetTags,
} from "../src/lib/canvas/canvas-assets";
import type {
  AssetStorage,
  CanvasAsset,
} from "../src/lib/canvas/canvas-persistence";
import { __setAssetStorageForTests } from "../src/lib/canvas/canvas-persistence";
import {
  __resetCanvasForTests,
  addNode,
  getCanvasState,
} from "../src/lib/canvas/canvas-store";

// Minimal localStorage polyfill (same pattern as canvas-persistence.test.ts)
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

/** In-memory AssetStorage fake, tracks call counts. */
function makeFakeAssetStorage(seed: CanvasAsset[] = []) {
  const db = new Map<string, CanvasAsset>();
  for (const asset of seed) db.set(asset.id, asset);
  let listCallCount = 0;

  const storage: AssetStorage = {
    list: async () => {
      listCallCount++;
      return [...db.values()];
    },
    put: async (asset: CanvasAsset) => {
      db.set(asset.id, asset);
    },
    delete: async (id: string) => {
      db.delete(id);
    },
  };

  return {
    storage,
    getDb: () => db,
    getListCallCount: () => listCallCount,
  };
}

function makeAsset(overrides: Partial<CanvasAsset> = {}): CanvasAsset {
  return {
    id: overrides.id ?? "asset-1",
    kind: overrides.kind ?? "text",
    title: overrides.title ?? "Title",
    content: overrides.content ?? "content",
    ...(overrides.mimeType !== undefined
      ? { mimeType: overrides.mimeType }
      : {}),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

beforeEach(() => {
  __resetCanvasForTests();
  __resetCanvasAssetsForTests();
  __setAssetStorageForTests(null); // restore default between tests
});

// ── Storage seam CRUD ─────────────────────────────────────────────

describe("AssetStorage seam", () => {
  it("list/put/delete round-trip via the fake", async () => {
    const fake = makeFakeAssetStorage();
    const asset = makeAsset({ id: "a1", title: "one" });

    expect(await fake.storage.list()).toEqual([]);
    await fake.storage.put(asset);
    expect(await fake.storage.list()).toEqual([asset]);
    await fake.storage.delete("a1");
    expect(await fake.storage.list()).toEqual([]);
  });

  it("default storage in node env: list → [], put/delete resolve, nothing throws", async () => {
    const { createIndexedDBAssetStorage } = await import(
      "../src/lib/canvas/canvas-persistence"
    );
    const storage = createIndexedDBAssetStorage();

    expect(await storage.list()).toEqual([]);
    await expect(storage.put(makeAsset())).resolves.toBeUndefined();
    await expect(storage.delete("x")).resolves.toBeUndefined();
  });
});

// ── Runtime store ─────────────────────────────────────────────────

describe("canvas-assets store", () => {
  it("saveNodeAsAsset (text with content) → true, asset fields correct, state + storage updated", async () => {
    const fake = makeFakeAssetStorage();
    __setAssetStorageForTests(fake.storage);

    const node = addNode({
      type: "text",
      title: "My note",
      metadata: { content: "hello world" },
    });

    const ok = await saveNodeAsAsset(node.id);
    expect(ok).toBe(true);

    const assets = getCanvasAssets().assets;
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset.kind).toBe("text");
    expect(asset.title).toBe("My note");
    expect(asset.content).toBe("hello world");
    expect(asset.id).toMatch(/^asset-/);
    expect(asset.createdAt).toBeDefined();

    // Persisted through the seam
    expect(fake.getDb().get(asset.id)).toEqual(asset);
  });

  it("saveNodeAsAsset carries mimeType for media nodes", async () => {
    const fake = makeFakeAssetStorage();
    __setAssetStorageForTests(fake.storage);

    const node = addNode({
      type: "image",
      title: "pic",
      metadata: { content: "data:image/png;base64,x", mimeType: "image/png" },
    });

    const ok = await saveNodeAsAsset(node.id);
    expect(ok).toBe(true);
    const asset = getCanvasAssets().assets[0];
    expect(asset.kind).toBe("image");
    expect(asset.mimeType).toBe("image/png");
  });

  it("saveNodeAsAsset (empty content) → false, no write", async () => {
    const fake = makeFakeAssetStorage();
    __setAssetStorageForTests(fake.storage);

    const node = addNode({ type: "text", title: "empty", metadata: {} });
    const ok = await saveNodeAsAsset(node.id);
    expect(ok).toBe(false);
    expect(getCanvasAssets().assets).toHaveLength(0);
    expect(fake.getDb().size).toBe(0);
  });

  it("saveNodeAsAsset (a2ui type) → false, no write", async () => {
    const fake = makeFakeAssetStorage();
    __setAssetStorageForTests(fake.storage);

    const node = addNode({
      type: "a2ui",
      title: "panel",
      metadata: { surfaceId: "sidebar:x", content: "ignored" },
    });
    const ok = await saveNodeAsAsset(node.id);
    expect(ok).toBe(false);
    expect(getCanvasAssets().assets).toHaveLength(0);
  });

  it("saveNodeAsAsset (missing node) → false", async () => {
    __setAssetStorageForTests(makeFakeAssetStorage().storage);
    const ok = await saveNodeAsAsset("does-not-exist");
    expect(ok).toBe(false);
  });

  it("insertAssetToCanvas creates a node of the right type + content", async () => {
    const seed = makeAsset({
      id: "a-img",
      kind: "image",
      title: "seed pic",
      content: "data:image/png;base64,z",
      mimeType: "image/png",
    });
    const fake = makeFakeAssetStorage([seed]);
    __setAssetStorageForTests(fake.storage);

    await ensureAssetsLoaded();
    const node = insertAssetToCanvas("a-img");

    expect(node).not.toBeNull();
    expect(node?.type).toBe("image");
    expect(node?.title).toBe("seed pic");
    expect(node?.metadata.content).toBe("data:image/png;base64,z");
    expect(node?.metadata.mimeType).toBe("image/png");

    // Node landed in the canvas store
    expect(getCanvasState().nodes).toHaveLength(1);
  });

  it("insertAssetToCanvas (unknown id) → null, no node added", async () => {
    __setAssetStorageForTests(makeFakeAssetStorage().storage);
    await ensureAssetsLoaded();
    const node = insertAssetToCanvas("nope");
    expect(node).toBeNull();
    expect(getCanvasState().nodes).toHaveLength(0);
  });

  it("removeAsset updates state and storage", async () => {
    const seed = makeAsset({ id: "a-del", title: "goner" });
    const fake = makeFakeAssetStorage([seed]);
    __setAssetStorageForTests(fake.storage);

    await ensureAssetsLoaded();
    expect(getCanvasAssets().assets).toHaveLength(1);

    await removeAsset("a-del");
    expect(getCanvasAssets().assets).toHaveLength(0);
    expect(fake.getDb().has("a-del")).toBe(false);
  });

  it("ensureAssetsLoaded hydrates once (list called a single time across calls)", async () => {
    const fake = makeFakeAssetStorage([makeAsset({ id: "x" })]);
    __setAssetStorageForTests(fake.storage);

    await ensureAssetsLoaded();
    await ensureAssetsLoaded();
    await ensureAssetsLoaded();

    expect(fake.getListCallCount()).toBe(1);
    expect(getCanvasAssets().loaded).toBe(true);
    expect(getCanvasAssets().assets).toHaveLength(1);
  });
});

// ── Pure helpers: filterAssets ────────────────────────────────────

describe("filterAssets", () => {
  const assets: CanvasAsset[] = [
    makeAsset({ id: "1", kind: "text", title: "Hello World" }),
    makeAsset({ id: "2", kind: "image", title: "Sunset Photo" }),
    makeAsset({ id: "3", kind: "video", title: "hello clip" }),
    makeAsset({ id: "4", kind: "audio", title: "Song" }),
  ];

  it("kind 'all' + empty query → everything", () => {
    expect(filterAssets(assets, "all", "").map((a) => a.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("kind filter narrows to matching kind", () => {
    expect(filterAssets(assets, "image", "").map((a) => a.id)).toEqual(["2"]);
  });

  it("query is case-insensitive substring on title", () => {
    expect(filterAssets(assets, "all", "hello").map((a) => a.id)).toEqual([
      "1",
      "3",
    ]);
  });

  it("query is trimmed", () => {
    expect(filterAssets(assets, "all", "  song  ").map((a) => a.id)).toEqual([
      "4",
    ]);
  });

  it("kind + query combined", () => {
    expect(filterAssets(assets, "video", "hello").map((a) => a.id)).toEqual([
      "3",
    ]);
  });

  it("no match → empty", () => {
    expect(filterAssets(assets, "all", "zzz")).toEqual([]);
  });
});

// ── Pure helpers: paginateAssets ──────────────────────────────────

describe("paginateAssets", () => {
  const items = Array.from({ length: 20 }, (_, i) =>
    makeAsset({ id: `p${i}`, title: `item ${i}` }),
  );

  it("8 per page by default, page 1 → first 8, pageCount = 3", () => {
    const { pageItems, page, pageCount } = paginateAssets(items, 1);
    expect(pageItems).toHaveLength(8);
    expect(pageItems[0].id).toBe("p0");
    expect(page).toBe(1);
    expect(pageCount).toBe(3);
  });

  it("last page returns the remainder", () => {
    const { pageItems, page } = paginateAssets(items, 3);
    expect(pageItems).toHaveLength(4);
    expect(page).toBe(3);
    expect(pageItems[0].id).toBe("p16");
  });

  it("page above range clamps to last page", () => {
    const { page, pageItems } = paginateAssets(items, 99);
    expect(page).toBe(3);
    expect(pageItems[0].id).toBe("p16");
  });

  it("page below range clamps to 1", () => {
    const { page, pageItems } = paginateAssets(items, 0);
    expect(page).toBe(1);
    expect(pageItems[0].id).toBe("p0");
  });

  it("empty items → pageCount 1, page 1, no items", () => {
    const { pageItems, page, pageCount } = paginateAssets([], 1);
    expect(pageItems).toHaveLength(0);
    expect(page).toBe(1);
    expect(pageCount).toBe(1);
  });
});

describe("asset tags", () => {
  it("normalizeTags trims, dedupes, drops empties, caps at 8", () => {
    expect(normalizeTags([" a ", "a", "", "b"])).toEqual(["a", "b"]);
    expect(
      normalizeTags(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]),
    ).toHaveLength(8);
  });

  it("collectAssetTags returns unique tags in first-seen order", () => {
    const assets = [
      { tags: ["风景", "封面"] },
      { tags: ["封面", "人物"] },
      {},
    ] as CanvasAsset[];
    expect(collectAssetTags(assets)).toEqual(["风景", "封面", "人物"]);
  });

  it("filterAssets filters by exact tag and matches query against tags", () => {
    const assets = [
      { id: "a", kind: "image", title: "海报", tags: ["小红书"] },
      { id: "b", kind: "image", title: "配图", tags: ["公众号"] },
      { id: "c", kind: "text", title: "文案" },
    ] as CanvasAsset[];
    expect(filterAssets(assets, "all", "", "小红书").map((x) => x.id)).toEqual([
      "a",
    ]);
    expect(filterAssets(assets, "all", "公众").map((x) => x.id)).toEqual(["b"]);
    expect(filterAssets(assets, "all", "", null)).toHaveLength(3);
  });

  it("saveNodeAsAsset stores normalized tags; updateAssetTags edits them", async () => {
    await ensureAssetsLoaded();
    const node = addNode({
      type: "text",
      title: "笔记",
      metadata: { content: "内容" },
    });
    await saveNodeAsAsset(node.id, [" 文案 ", "文案", "初稿"]);
    const saved = getCanvasAssets().assets[0];
    expect(saved).toBeDefined();
    if (!saved) return;
    expect(saved.tags).toEqual(["文案", "初稿"]);

    await updateAssetTags(saved.id, ["终稿"]);
    expect(getCanvasAssets().assets[0]?.tags).toEqual(["终稿"]);

    await updateAssetTags(saved.id, []);
    expect(getCanvasAssets().assets[0]?.tags).toBeUndefined();
  });
});
