import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperthubCatalogManager } from "../../apps/controller/src/services/experthub/catalog-manager.js";

const execFileAsync = promisify(execFile);

type ExpertManifestFixture = {
  schemaVersion: 1;
  slug: string;
  name: string;
  emoji: string;
  category: string;
  description: string;
  version: string;
  systemPrompt: string;
  modelId: string;
};

function fixture(
  slug: string,
  overrides: Partial<ExpertManifestFixture> = {},
): ExpertManifestFixture {
  return {
    schemaVersion: 1,
    slug,
    name: slug
      .replace(/(^|-)(\w)/g, (_m, _s, c) => ` ${c.toUpperCase()}`)
      .trim(),
    emoji: "🤖",
    category: "misc",
    description: `${slug} description`,
    version: "1.0.0",
    systemPrompt: "system",
    modelId: "gpt-4o",
    ...overrides,
  };
}

async function writeManifest(
  dir: string,
  slug: string,
  overrides: Partial<ExpertManifestFixture> = {},
): Promise<void> {
  await mkdir(path.join(dir, slug), { recursive: true });
  await writeFile(
    path.join(dir, slug, "expert.json"),
    JSON.stringify(fixture(slug, overrides), null, 2),
    "utf8",
  );
}

async function buildTarball(
  sourceDir: string,
  outputPath: string,
  entry: string,
): Promise<Buffer> {
  // Use system tar (same as production code path) to create a tarball.
  await execFileAsync("tar", ["-czf", outputPath, "-C", sourceDir, entry]);
  return readFile(outputPath);
}

function mockResponse(init: {
  ok: boolean;
  status?: number;
  json?: unknown;
  body?: Uint8Array;
}): Response {
  if (init.body) {
    const buf = init.body;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buf);
        controller.close();
      },
    });
    return new Response(stream, { status: init.status ?? 200 });
  }
  return new Response(
    init.json === undefined ? null : JSON.stringify(init.json),
    {
      status: init.status ?? (init.ok ? 200 : 500),
      headers: { "content-type": "application/json" },
    },
  );
}

describe("ExperthubCatalogManager", () => {
  let dir: string;
  let ledgerPath: string;
  let cacheDir: string;
  let staticDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "exp-cat-"));
    ledgerPath = path.join(dir, "ledger.json");
    cacheDir = path.join(dir, "cache");
    staticDir = path.join(dir, "static");
    await mkdir(cacheDir, { recursive: true });
    await mkdir(staticDir, { recursive: true });
    await writeManifest(staticDir, "seed-one");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists bundled experts when remote is offline", async () => {
    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "http://test/version.json",
      downloadUrl: "http://test/tarball.tar.gz",
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const list = await mgr.listExperts();
    expect(list.map((e) => e.slug)).toContain("seed-one");
    const seed = list.find((e) => e.slug === "seed-one");
    expect(seed?.name).toBe("Seed One");
  });

  it("resolves a bundled expert by slug", async () => {
    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "http://t/v.json",
      downloadUrl: "http://t/t.tar.gz",
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const resolved = await mgr.resolveExpert("seed-one");
    expect(resolved?.manifest.slug).toBe("seed-one");
    expect(resolved?.source).toBe("bundled");
  });

  it("returns null when resolving unknown slug", async () => {
    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "http://t/v.json",
      downloadUrl: "http://t/t.tar.gz",
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
    });
    expect(await mgr.resolveExpert("ghost")).toBeNull();
  });

  it("skips invalid manifests with a warning (does not throw)", async () => {
    await mkdir(path.join(staticDir, "bad-one"), { recursive: true });
    await writeFile(
      path.join(staticDir, "bad-one", "expert.json"),
      "{ this is not json",
      "utf8",
    );
    await mkdir(path.join(staticDir, "bad-two"), { recursive: true });
    await writeFile(
      path.join(staticDir, "bad-two", "expert.json"),
      JSON.stringify({ slug: "bad-two" }),
      "utf8",
    );
    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "x",
      downloadUrl: "y",
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const list = await mgr.listExperts();
    const slugs = list.map((e) => e.slug);
    expect(slugs).toContain("seed-one");
    expect(slugs).not.toContain("bad-one");
    expect(slugs).not.toContain("bad-two");
  });

  it("writes + reads ledger atomically", async () => {
    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "x",
      downloadUrl: "y",
      fetch: vi.fn(),
    });
    const initial = await mgr.readLedger();
    expect(initial.version).toBe(1);
    expect(initial.entries).toEqual({});
    await mgr.writeLedger({
      version: 1,
      updatedAt: "2026-04-17T00:00:00Z",
      entries: {
        "seed-one": {
          slug: "seed-one",
          version: "1.0.0",
          botId: "bot_1",
          installedAt: "2026-04-17T00:00:00Z",
        },
      },
    });
    const reloaded = await mgr.readLedger();
    expect(reloaded.entries["seed-one"].botId).toBe("bot_1");
  });

  it("refresh() returns null when remote is unreachable", async () => {
    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "http://t/version.json",
      downloadUrl: "http://t/tarball.tar.gz",
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
    });
    expect(await mgr.refresh()).toBeNull();
  });

  it("refresh() returns null when version.json is not ok", async () => {
    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "http://t/version.json",
      downloadUrl: "http://t/tarball.tar.gz",
      fetch: vi
        .fn()
        .mockResolvedValue(mockResponse({ ok: false, status: 404 })),
    });
    expect(await mgr.refresh()).toBeNull();
  });

  it("refresh() downloads + extracts managed experts and lists them", async () => {
    // Stage a tarball containing "extra-one/expert.json"
    const stagingDir = path.join(dir, "staging");
    await mkdir(stagingDir, { recursive: true });
    await writeManifest(stagingDir, "extra-one", {
      name: "Extra One",
      description: "remote expert",
    });
    const tarPath = path.join(dir, "remote.tar.gz");
    const tarballBytes = await buildTarball(stagingDir, tarPath, "extra-one");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          json: {
            version: "2026.04.17",
            updatedAt: "2026-04-17T00:00:00Z",
            count: 1,
          },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({ ok: true, body: new Uint8Array(tarballBytes) }),
      );

    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "http://t/version.json",
      downloadUrl: "http://t/tarball.tar.gz",
      fetch: fetchMock,
    });

    const meta = await mgr.refresh();
    expect(meta).not.toBeNull();
    expect(meta?.version).toBe("2026.04.17");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const list = await mgr.listExperts();
    const slugs = list.map((e) => e.slug);
    expect(slugs).toContain("seed-one");
    expect(slugs).toContain("extra-one");

    const resolved = await mgr.resolveExpert("extra-one");
    expect(resolved?.source).toBe("managed");
    expect(resolved?.manifest.name).toBe("Extra One");

    // getMeta should now return the cached meta
    const cached = await mgr.getMeta();
    expect(cached?.version).toBe("2026.04.17");
  });

  it("refresh() skips re-download when remote version matches cached meta", async () => {
    const stagingDir = path.join(dir, "staging2");
    await mkdir(stagingDir, { recursive: true });
    await writeManifest(stagingDir, "first", { name: "First" });
    const tarPath = path.join(dir, "remote2.tar.gz");
    const tarballBytes = await buildTarball(stagingDir, tarPath, "first");

    const fetchMock = vi
      .fn()
      // initial version.json
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          json: { version: "v1", updatedAt: "2026-04-17T00:00:00Z", count: 1 },
        }),
      )
      // initial tarball
      .mockResolvedValueOnce(
        mockResponse({ ok: true, body: new Uint8Array(tarballBytes) }),
      )
      // second version.json — same version
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          json: { version: "v1", updatedAt: "2026-04-17T00:00:00Z", count: 1 },
        }),
      );

    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "http://t/version.json",
      downloadUrl: "http://t/tarball.tar.gz",
      fetch: fetchMock,
    });

    const meta1 = await mgr.refresh();
    expect(meta1?.version).toBe("v1");
    const meta2 = await mgr.refresh();
    expect(meta2?.version).toBe("v1");
    // Only 3 calls: v.json, tarball, v.json (no second tarball download).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("managed experts override bundled with the same slug", async () => {
    // Bundle an "override-me" in the static dir.
    await writeManifest(staticDir, "override-me", { name: "Bundled Name" });

    const stagingDir = path.join(dir, "staging-override");
    await mkdir(stagingDir, { recursive: true });
    await writeManifest(stagingDir, "override-me", {
      name: "Managed Name",
      version: "2.0.0",
    });
    const tarPath = path.join(dir, "override.tar.gz");
    const tarballBytes = await buildTarball(stagingDir, tarPath, "override-me");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          json: { version: "vA", updatedAt: "2026-04-17T00:00:00Z", count: 1 },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({ ok: true, body: new Uint8Array(tarballBytes) }),
      );

    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "http://t/v.json",
      downloadUrl: "http://t/t.tar.gz",
      fetch: fetchMock,
    });

    await mgr.refresh();
    const resolved = await mgr.resolveExpert("override-me");
    expect(resolved?.source).toBe("managed");
    expect(resolved?.manifest.name).toBe("Managed Name");
    expect(resolved?.manifest.version).toBe("2.0.0");
  });
});
