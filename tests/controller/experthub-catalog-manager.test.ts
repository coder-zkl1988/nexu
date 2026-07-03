import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperthubCatalogManager } from "../../apps/controller/src/services/experthub/catalog-manager.js";

const execFileAsync = promisify(execFile);

/**
 * Build a gzipped ustar tarball whose single entry name is written verbatim
 * (no path normalization). System `tar` normalizes `../` prefixes on some
 * platforms (e.g. GNU tar on Linux), which would make a traversal archive
 * non-malicious; constructing the archive by hand keeps the literal `..`
 * entry so traversal guards are exercised consistently.
 */
function buildTraversalTarball(entryName: string, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512, 0);
  header.write(entryName.slice(0, 100), 0);
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header[156] = 0x30; // typeflag '0' = regular file
  header.write("ustar\0", 257);
  header.write("00", 263);
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, "0"), 148);
  header[154] = 0;
  header[155] = 0x20;
  const contentBlocks = Buffer.alloc(Math.ceil(body.length / 512) * 512, 0);
  body.copy(contentBlocks);
  const eof = Buffer.alloc(1024, 0);
  return gzipSync(Buffer.concat([header, contentBlocks, eof]));
}

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

  it("refresh() rejects tarball with parent-directory traversal", async () => {
    // Build a malicious tarball whose entry literally starts with "../".
    // We construct the archive by hand because system `tar` normalizes
    // `../escape.txt` to `escape.txt` on GNU tar (Linux), which would make the
    // archive non-malicious and defeat the test. A literal `../escape.txt`
    // entry is rejected by the catalog manager's traversal guard on every
    // platform.
    const tarballBytes = buildTraversalTarball("../escape.txt", "pwned");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          json: {
            version: "evil-v1",
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
      versionUrl: "http://t/v.json",
      downloadUrl: "http://t/t.tar.gz",
      fetch: fetchMock,
    });

    const meta = await mgr.refresh();
    // Traversal must be rejected — refresh returns null and no meta is persisted.
    expect(meta).toBeNull();
    expect(await mgr.getMeta()).toBeNull();
  });

  it("refresh() dedupes concurrent calls via in-flight lock", async () => {
    // Use a fetch mock that delays its first resolution so both refresh()
    // calls overlap. The second caller must attach to the in-flight promise
    // rather than kick off a fresh fetch.
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              mockResponse({
                ok: false,
                status: 503,
              }),
            );
          }, 50);
        }),
    );

    const mgr = new ExperthubCatalogManager({
      cacheDir,
      ledgerPath,
      staticDir,
      versionUrl: "http://t/v.json",
      downloadUrl: "http://t/t.tar.gz",
      fetch: fetchMock,
    });

    const [a, b] = await Promise.all([mgr.refresh(), mgr.refresh()]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    // Only one version.json fetch should have been issued across both calls.
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
