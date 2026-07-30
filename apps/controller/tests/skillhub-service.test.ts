import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";

type MockSkillDb = {
  close: ReturnType<typeof vi.fn>;
  getAllInstalled: ReturnType<typeof vi.fn>;
  getInstalledRecordsBySlug: ReturnType<typeof vi.fn>;
  recordInstall: ReturnType<typeof vi.fn>;
  recordInstalls: ReturnType<typeof vi.fn>;
  recordUninstall: ReturnType<typeof vi.fn>;
  recordBulkInstall: ReturnType<typeof vi.fn>;
  backfillInstalledManagedMetadata: ReturnType<typeof vi.fn>;
  markUninstalledBySlugs: ReturnType<typeof vi.fn>;
  isRemovedByUser: ReturnType<typeof vi.fn>;
  isInstalled: ReturnType<typeof vi.fn>;
  removeRecords: ReturnType<typeof vi.fn>;
  getUninstalledCurated: ReturnType<typeof vi.fn>;
};

function createMockSkillDb(): MockSkillDb {
  return {
    close: vi.fn(),
    getAllInstalled: vi.fn(() => []),
    getInstalledRecordsBySlug: vi.fn(() => []),
    recordInstall: vi.fn(),
    recordInstalls: vi.fn(),
    recordUninstall: vi.fn(),
    recordBulkInstall: vi.fn(),
    backfillInstalledManagedMetadata: vi.fn(() => true),
    markUninstalledBySlugs: vi.fn(),
    isRemovedByUser: vi.fn(() => false),
    isInstalled: vi.fn(() => false),
    removeRecords: vi.fn(),
    getUninstalledCurated: vi.fn(() => []),
  };
}

const mocks = vi.hoisted(() => {
  const mockSkillDbCreate = vi.fn();

  const catalogManagerInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    getCatalog: ReturnType<typeof vi.fn>;
    installSkill: ReturnType<typeof vi.fn>;
    uninstallSkill: ReturnType<typeof vi.fn>;
    refreshCatalog: ReturnType<typeof vi.fn>;
    executeInstall: ReturnType<typeof vi.fn>;
    commitInstall: ReturnType<typeof vi.fn>;
    isInstallTransactionActive: ReturnType<typeof vi.fn>;
    rollbackInstall: ReturnType<typeof vi.fn>;
    getCuratedSlugsToEnqueue: ReturnType<typeof vi.fn>;
    getCuratedInstallRequests: ReturnType<typeof vi.fn>;
    getCatalogSkill: ReturnType<typeof vi.fn>;
    canonicalizeSlug: ReturnType<typeof vi.fn>;
    prepareInstall: ReturnType<typeof vi.fn>;
    consumeInstalledVersion: ReturnType<typeof vi.fn>;
    consumeInstalledMetadata: ReturnType<typeof vi.fn>;
    clearPreparedInstall: ReturnType<typeof vi.fn>;
    reconcileDbWithDisk: ReturnType<typeof vi.fn>;
  }> = [];

  class MockCatalogManager {
    public readonly start = vi.fn();
    public readonly dispose: ReturnType<typeof vi.fn>;
    public readonly getCatalog = vi.fn(() => ({
      skills: [],
      installedSlugs: [],
      installedSkills: [],
      meta: null,
    }));
    public readonly installSkill = vi.fn(async () => ({ ok: true }));
    public readonly uninstallSkill = vi.fn(async () => ({ ok: true }));
    public readonly refreshCatalog = vi.fn(async () => ({
      ok: true,
      skillCount: 0,
    }));
    public readonly executeInstall = vi.fn(async () => {});
    public readonly commitInstall = vi.fn();
    public readonly isInstallTransactionActive = vi.fn(() => false);
    public readonly rollbackInstall = vi.fn();
    public readonly getCuratedSlugsToEnqueue = vi.fn(() => [] as string[]);
    public readonly getCuratedInstallRequests = vi.fn(async () => []);
    public readonly getCatalogSkill = vi.fn(async () => undefined);
    public readonly canonicalizeSlug = vi.fn((slug: string) => slug);
    public readonly prepareInstall = vi.fn(
      (request: { slug: string }) => request.slug,
    );
    public readonly consumeInstalledVersion = vi.fn(() => undefined);
    public readonly consumeInstalledMetadata = vi.fn(() => undefined);
    public readonly clearPreparedInstall = vi.fn();
    public readonly reconcileDbWithDisk = vi.fn();

    constructor(
      readonly cacheDir: string,
      readonly options: Record<string, unknown>,
    ) {
      this.dispose = vi.fn(() => {
        const db = this.options.skillDb as { close: () => void } | undefined;
        db?.close();
      });
      catalogManagerInstances.push(this);
    }
  }

  const installQueueInstances: Array<{
    enqueue: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    hasActiveUpdate: ReturnType<typeof vi.fn>;
    isInFlight: ReturnType<typeof vi.fn>;
    getQueue: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    opts: Record<string, unknown>;
  }> = [];

  class MockInstallQueue {
    public readonly enqueue = vi.fn(
      (
        slug: string,
        source: string,
        ownerHandle?: string | null,
        _options?: {
          replaceCompleted?: boolean;
          operation?: "install" | "update";
        },
      ) => ({
        slug,
        ownerHandle: ownerHandle ?? null,
        source,
        status: "queued" as const,
        position: 0,
        error: null,
        retries: 0,
        enqueuedAt: new Date().toISOString(),
      }),
    );
    public readonly cancel = vi.fn(() => true);
    public readonly hasActiveUpdate = vi.fn(() => false);
    public readonly isInFlight = vi.fn(() => false);
    public readonly getQueue = vi.fn(() => []);
    public readonly dispose = vi.fn();
    public readonly opts: Record<string, unknown>;

    constructor(readonly opts: Record<string, unknown>) {
      this.opts = opts;
      installQueueInstances.push(this);
    }
  }

  const dirWatcherInstances: Array<{
    syncNow: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    opts: Record<string, unknown>;
  }> = [];

  class MockSkillDirWatcher {
    public readonly syncNow = vi.fn();
    public readonly start = vi.fn();
    public readonly stop = vi.fn();

    constructor(readonly opts: Record<string, unknown>) {
      dirWatcherInstances.push(this);
    }
  }

  const mockCopyStaticSkills = vi.fn(() => ({
    copied: [] as string[],
    skipped: [] as string[],
  }));

  const mockReplaceLibtvVideoFromBundle = vi.fn(() => ({
    installed: false as boolean,
    reason: "bundle-missing" as "bundle-missing" | "fresh-install" | "replaced",
  }));
  const mockReplaceOfficeCliFromBundle = vi.fn(() => ({
    installed: false as boolean,
    reason: "bundle-missing" as "bundle-missing" | "fresh-install" | "replaced",
  }));
  return {
    mockSkillDbCreate,
    catalogManagerInstances,
    MockCatalogManager,
    installQueueInstances,
    MockInstallQueue,
    dirWatcherInstances,
    MockSkillDirWatcher,
    mockCopyStaticSkills,
    mockReplaceLibtvVideoFromBundle,
    mockReplaceOfficeCliFromBundle,
  };
});

vi.mock("../src/services/skillhub/skill-db.js", () => ({
  SkillDb: {
    create: mocks.mockSkillDbCreate,
  },
}));

vi.mock("../src/services/skillhub/catalog-manager.js", () => ({
  CatalogManager: mocks.MockCatalogManager,
}));

vi.mock("../src/services/skillhub/install-queue.js", () => ({
  InstallQueue: mocks.MockInstallQueue,
}));

vi.mock("../src/services/skillhub/skill-dir-watcher.js", () => ({
  SkillDirWatcher: mocks.MockSkillDirWatcher,
}));

vi.mock("../src/services/skillhub/curated-skills.js", () => ({
  copyStaticSkills: mocks.mockCopyStaticSkills,
  replaceLibtvVideoFromBundle: mocks.mockReplaceLibtvVideoFromBundle,
  replaceOfficeCliFromBundle: mocks.mockReplaceOfficeCliFromBundle,
}));

import { SkillhubService } from "../src/services/skillhub-service.js";

function createEnv(rootDir: string): ControllerEnv {
  const nexuHomeDir = path.join(rootDir, ".nexu");
  const openclawStateDir = path.join(rootDir, ".openclaw");

  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://nexu.io",
    nexuLinkUrl: null,
    nexuHomeDir,
    nexuConfigPath: path.join(nexuHomeDir, "config.json"),
    artifactsIndexPath: path.join(nexuHomeDir, "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: path.join(
      nexuHomeDir,
      "compiled-openclaw.json",
    ),
    openclawStateDir,
    openclawConfigPath: path.join(openclawStateDir, "openclaw.json"),
    openclawSkillsDir: path.join(openclawStateDir, "skills"),
    skillhubCacheDir: path.join(nexuHomeDir, "skillhub-cache"),
    skillDbPath: path.join(nexuHomeDir, "skill-ledger.db"),
    staticSkillsDir: undefined,
    openclawWorkspaceTemplatesDir: path.join(
      openclawStateDir,
      "workspace-templates",
    ),
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: undefined,
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
  };
}

describe("SkillhubService", () => {
  let rootDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-skillhub-service-"));
    mocks.mockSkillDbCreate.mockReset();
    mocks.catalogManagerInstances.length = 0;
    mocks.installQueueInstances.length = 0;
    mocks.dirWatcherInstances.length = 0;
    mocks.mockCopyStaticSkills.mockReset();
    mocks.mockCopyStaticSkills.mockReturnValue({
      copied: [],
      skipped: [],
    });
    mocks.mockReplaceOfficeCliFromBundle.mockClear();
    vi.stubEnv("CI", "");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("create() creates all dependencies", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);

    expect(mocks.mockSkillDbCreate).toHaveBeenCalledWith(env.skillDbPath);
    expect(mocks.catalogManagerInstances).toHaveLength(1);
    expect(mocks.installQueueInstances).toHaveLength(1);
    expect(mocks.dirWatcherInstances).toHaveLength(1);
    expect(service.catalog).toBe(mocks.catalogManagerInstances[0]);
    expect(service.queue).toBe(mocks.installQueueInstances[0]);
  });

  it("create() hides active disk transactions from watcher reconciliation", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    await SkillhubService.create(env);

    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];
    const watcher = mocks.dirWatcherInstances[0];
    const isSlugInFlight = watcher.opts.isSlugInFlight as (
      slug: string,
    ) => boolean;

    catalog.isInstallTransactionActive.mockReturnValueOnce(true);
    expect(isSlugInFlight("weather")).toBe(true);
    queue.isInFlight.mockReturnValueOnce(true);
    expect(isSlugInFlight("github")).toBe(true);
  });

  it("create() wires queue completion and cancellation callbacks", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    await SkillhubService.create(env);

    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];
    const onComplete = queue.opts.onComplete as
      | ((slug: string, source: string) => void)
      | undefined;
    const onCancelled = queue.opts.onCancelled as
      | ((slug: string, source: string) => Promise<void>)
      | undefined;

    expect(onComplete).toBeTypeOf("function");
    expect(onCancelled).toBeTypeOf("function");

    onComplete?.("alpha", "managed");
    expect(db.recordInstall).toHaveBeenCalledWith(
      "alpha",
      "managed",
      undefined,
      undefined,
      undefined,
    );
    expect(catalog.commitInstall).toHaveBeenCalledWith("alpha");

    await onCancelled?.("beta", "managed");
    expect(catalog.rollbackInstall).toHaveBeenCalledWith("beta");
    expect(catalog.clearPreparedInstall).toHaveBeenCalledWith("beta");
    expect(catalog.uninstallSkill).not.toHaveBeenCalled();
  });

  it("create() rolls back the file transaction when ledger persistence fails", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    db.recordInstall.mockImplementation(() => {
      throw new Error("ledger unavailable");
    });
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    await SkillhubService.create(env);

    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];
    const onComplete = queue.opts.onComplete as (
      slug: string,
      source: string,
    ) => void;

    expect(() => onComplete("alpha", "managed")).toThrow("ledger unavailable");
    expect(catalog.rollbackInstall).toHaveBeenCalledWith("alpha");
    expect(catalog.commitInstall).not.toHaveBeenCalled();
  });

  it("start() calls catalogManager.start()", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.start();

    const catalog = mocks.catalogManagerInstances[0];
    expect(catalog.start).toHaveBeenCalledTimes(1);
  });

  it("start() recovers catalog transactions before reading origin metadata", async () => {
    const env = createEnv(rootDir);
    const callOrder: string[] = [];
    const db = createMockSkillDb();
    db.getAllInstalled.mockImplementation(() => {
      callOrder.push("metadata-backfill");
      return [];
    });
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    mocks.catalogManagerInstances[0].start.mockImplementation(() => {
      callOrder.push("catalog-recovery");
    });

    service.start();

    expect(callOrder.slice(0, 2)).toEqual([
      "catalog-recovery",
      "metadata-backfill",
    ]);
  });

  it("start() backfills managed owner and version from validated local origin metadata", async () => {
    const env = createEnv(rootDir);
    const skillDir = path.join(env.openclawSkillsDir, "weather");
    mkdirSync(path.join(skillDir, ".clawhub"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "weather\n");
    writeFileSync(
      path.join(skillDir, ".clawhub", "origin.json"),
      JSON.stringify({
        slug: "weather",
        ownerHandle: "@Steipete",
        installedVersion: "1.2.3",
      }),
    );
    const db = createMockSkillDb();
    db.getAllInstalled.mockReturnValue([
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        ownerHandle: null,
        version: null,
        installedAt: "2026-07-01T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.start();

    expect(db.backfillInstalledManagedMetadata).toHaveBeenCalledWith(
      "weather",
      { ownerHandle: "steipete", version: "1.2.3" },
    );
  });

  it("start() backfills a legacy origin version without inventing an owner", async () => {
    const env = createEnv(rootDir);
    const skillDir = path.join(env.openclawSkillsDir, "weather");
    mkdirSync(path.join(skillDir, ".clawhub"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "weather\n");
    writeFileSync(
      path.join(skillDir, ".clawhub", "origin.json"),
      JSON.stringify({ slug: "weather", installedVersion: "1.2.3" }),
    );
    const db = createMockSkillDb();
    db.getAllInstalled.mockReturnValue([
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        ownerHandle: null,
        version: null,
        installedAt: "2026-07-01T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.start();

    expect(db.backfillInstalledManagedMetadata).toHaveBeenCalledWith(
      "weather",
      { version: "1.2.3" },
    );
  });

  it("start() ignores origin metadata whose slug does not match the directory", async () => {
    const env = createEnv(rootDir);
    const skillDir = path.join(env.openclawSkillsDir, "weather");
    mkdirSync(path.join(skillDir, ".clawhub"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "weather\n");
    writeFileSync(
      path.join(skillDir, ".clawhub", "origin.json"),
      JSON.stringify({
        slug: "different-skill",
        ownerHandle: "steipete",
        installedVersion: "1.2.3",
      }),
    );
    const db = createMockSkillDb();
    db.getAllInstalled.mockReturnValue([
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        ownerHandle: null,
        version: null,
        installedAt: "2026-07-01T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.start();

    expect(db.backfillInstalledManagedMetadata).not.toHaveBeenCalled();
  });

  it("start() copies static skills when staticSkillsDir is set and exists", async () => {
    const env = createEnv(rootDir);
    const staticDir = path.join(rootDir, "static-skills");
    mkdirSync(staticDir, { recursive: true });
    const envWithStatic = { ...env, staticSkillsDir: staticDir };

    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    mocks.mockCopyStaticSkills.mockReturnValueOnce({
      copied: ["skill-a", "skill-b"],
      skipped: [],
    });

    const service = await SkillhubService.create(envWithStatic);
    service.start();

    expect(mocks.mockCopyStaticSkills).toHaveBeenCalledWith({
      staticDir,
      targetDir: env.openclawSkillsDir,
      skillDb: db,
    });
    expect(db.recordBulkInstall).toHaveBeenCalledWith(
      ["skill-a", "skill-b"],
      "managed",
    );
    expect(mocks.mockReplaceOfficeCliFromBundle).toHaveBeenCalledWith({
      staticDir,
      targetDir: env.openclawSkillsDir,
      skillDb: db,
    });
  });

  it("start() does not copy static skills when staticSkillsDir is undefined", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.start();

    expect(mocks.mockCopyStaticSkills).not.toHaveBeenCalled();
  });

  it("start() does not recordBulkInstall when no static skills were copied", async () => {
    const env = createEnv(rootDir);
    const staticDir = path.join(rootDir, "static-skills");
    mkdirSync(staticDir, { recursive: true });
    const envWithStatic = { ...env, staticSkillsDir: staticDir };

    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    mocks.mockCopyStaticSkills.mockReturnValueOnce({
      copied: [],
      skipped: ["skill-a"],
    });

    const service = await SkillhubService.create(envWithStatic);
    service.start();

    expect(db.recordBulkInstall).not.toHaveBeenCalled();
  });

  it("start() calls dirWatcher.syncNow() before enqueuing", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const callOrder: string[] = [];

    const service = await SkillhubService.create(env);
    const watcher = mocks.dirWatcherInstances[0];
    const catalog = mocks.catalogManagerInstances[0];

    watcher.syncNow.mockImplementation(() => {
      callOrder.push("syncNow");
    });
    catalog.getCuratedInstallRequests.mockImplementation(async () => {
      callOrder.push("getCuratedInstallRequests");
      return [];
    });

    service.start();

    expect(callOrder).toEqual(["syncNow", "getCuratedInstallRequests"]);
  });

  it("start() enqueues owner-scoped curated install requests", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const catalog = mocks.catalogManagerInstances[0];
    catalog.getCuratedInstallRequests.mockResolvedValue([
      { slug: "alpha", ownerHandle: "publisher-a", version: "1.0.0" },
      { slug: "beta", ownerHandle: "publisher-b", version: "2.0.0" },
    ]);

    service.start();

    const queue = mocks.installQueueInstances[0];
    await vi.waitFor(() => expect(queue.enqueue).toHaveBeenCalledTimes(2));
    expect(catalog.prepareInstall).toHaveBeenCalledWith({
      slug: "alpha",
      ownerHandle: "publisher-a",
      version: "1.0.0",
    });
    expect(catalog.prepareInstall).toHaveBeenCalledWith({
      slug: "beta",
      ownerHandle: "publisher-b",
      version: "2.0.0",
    });
  });

  it("start() isolates curated identity conflicts and continues the batch", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockImplementation((slug: string) =>
      slug === "alpha"
        ? [
            {
              slug: "alpha",
              source: "custom",
              status: "installed",
              ownerHandle: null,
              version: null,
              installedAt: "2026-07-01T00:00:00.000Z",
              uninstalledAt: null,
              agentId: null,
            },
          ]
        : [],
    );
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const service = await SkillhubService.create(env);
    const catalog = mocks.catalogManagerInstances[0];
    catalog.getCuratedInstallRequests.mockResolvedValue([
      { slug: "alpha", ownerHandle: "publisher-a", version: "1.0.0" },
      { slug: "beta", ownerHandle: "publisher-b", version: "2.0.0" },
    ]);

    service.start();

    const queue = mocks.installQueueInstances[0];
    await vi.waitFor(() =>
      expect(queue.enqueue).toHaveBeenCalledWith(
        "beta",
        "managed",
        "publisher-b",
      ),
    );
    expect(queue.enqueue).not.toHaveBeenCalledWith(
      "alpha",
      "managed",
      "publisher-a",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("curated startup install skipped"),
    );
  });

  it("start() catches curated catalog failures", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const service = await SkillhubService.create(env);
    mocks.catalogManagerInstances[0].getCuratedInstallRequests.mockRejectedValue(
      new Error("mirror unavailable"),
    );

    service.start();

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("curated startup install failed"),
      ),
    );
  });

  it("start() begins watching before async curated resolution completes", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const callOrder: string[] = [];

    const service = await SkillhubService.create(env);
    const watcher = mocks.dirWatcherInstances[0];
    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];

    catalog.getCuratedInstallRequests.mockResolvedValue([
      { slug: "x", ownerHandle: "publisher" },
    ]);
    queue.enqueue.mockImplementation(() => {
      callOrder.push("enqueue");
      return {
        slug: "x",
        source: "managed",
        status: "queued",
        position: 0,
        error: null,
        retries: 0,
        enqueuedAt: new Date().toISOString(),
      };
    });
    watcher.start.mockImplementation(() => {
      callOrder.push("dirWatcher.start");
    });

    service.start();

    await vi.waitFor(() => expect(callOrder).toContain("enqueue"));
    expect(callOrder).toEqual(["dirWatcher.start", "enqueue"]);
  });

  it("start() skips all post-catalog work when CI=true", async () => {
    process.env.CI = "true";
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.start();

    const catalog = mocks.catalogManagerInstances[0];
    const watcher = mocks.dirWatcherInstances[0];
    const queue = mocks.installQueueInstances[0];

    expect(catalog.start).toHaveBeenCalledTimes(1);
    expect(mocks.mockCopyStaticSkills).not.toHaveBeenCalled();
    expect(watcher.syncNow).not.toHaveBeenCalled();
    expect(catalog.getCuratedSlugsToEnqueue).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(watcher.start).not.toHaveBeenCalled();
  });

  it("start() enqueues curated skills even when ledger already exists", async () => {
    const env = createEnv(rootDir);
    // Pre-create the ledger so this simulates a second launch
    mkdirSync(path.dirname(env.skillDbPath), { recursive: true });
    writeFileSync(env.skillDbPath, JSON.stringify({ skills: [] }));

    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const catalog = mocks.catalogManagerInstances[0];
    catalog.getCuratedInstallRequests.mockResolvedValue([
      { slug: "failed-skill", ownerHandle: "publisher" },
    ]);

    service.start();

    const queue = mocks.installQueueInstances[0];
    await vi.waitFor(() =>
      expect(queue.enqueue).toHaveBeenCalledWith(
        "failed-skill",
        "managed",
        "publisher",
      ),
    );
  });

  it("enqueueInstall() delegates to queue with source 'managed'", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const result = service.enqueueInstall("my-skill");

    const queue = mocks.installQueueInstances[0];
    expect(queue.enqueue).toHaveBeenCalledWith(
      "my-skill",
      "managed",
      undefined,
    );
    expect(result.slug).toBe("my-skill");
  });

  it("enqueueInstall() treats an exact managed identity as already installed", async () => {
    const env = createEnv(rootDir);
    const installedDir = path.join(env.openclawSkillsDir, "my-skill");
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(path.join(installedDir, "SKILL.md"), "# My skill\n");
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher",
        source: "managed",
        status: "installed",
        version: "1.0.0",
        installedAt: "2026-07-28T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const result = service.enqueueInstall({
      slug: "my-skill",
      ownerHandle: "publisher",
      version: "1.0.0",
    });

    expect(result).toMatchObject({
      slug: "my-skill",
      ownerHandle: "publisher",
      status: "done",
      enqueuedAt: "2026-07-28T00:00:00.000Z",
    });
    expect(mocks.installQueueInstances[0].enqueue).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "another managed publisher",
      source: "managed" as const,
      ownerHandle: "publisher-a",
    },
    {
      label: "an unknown managed publisher",
      source: "managed" as const,
      ownerHandle: null,
    },
    {
      label: "a custom install",
      source: "custom" as const,
      ownerHandle: null,
    },
    {
      label: "a user install",
      source: "user" as const,
      ownerHandle: null,
    },
  ])("enqueueInstall() rejects $label occupying the slug", async (record) => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: record.ownerHandle,
        source: record.source,
        status: "installed",
        version: "1.0.0",
        installedAt: "2026-07-28T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);

    expect(() =>
      service.enqueueInstall({
        slug: "my-skill",
        ownerHandle: "publisher-b",
        version: "2.0.0",
      }),
    ).toThrow(
      "A different or unknown skill identity already occupies my-skill",
    );
    expect(mocks.installQueueInstances[0].enqueue).not.toHaveBeenCalled();
  });

  it("enqueueInstall() rejects an untracked physical skill directory", async () => {
    const env = createEnv(rootDir);
    const skillDir = path.join(env.openclawSkillsDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "custom skill\n");
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);

    expect(() =>
      service.enqueueInstall({
        slug: "my-skill",
        ownerHandle: "publisher",
      }),
    ).toThrow(
      "A different or unknown skill identity already occupies my-skill",
    );
    expect(mocks.installQueueInstances[0].enqueue).not.toHaveBeenCalled();
  });

  it("enqueueInstall() replaces a stale completed same-owner queue item when the slug is no longer installed", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];
    queue.getQueue.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher",
        source: "managed",
        status: "done",
      },
    ]);

    service.enqueueInstall({
      slug: "my-skill",
      ownerHandle: "publisher",
    });

    expect(queue.enqueue).toHaveBeenCalledWith(
      "my-skill",
      "managed",
      "publisher",
      { replaceCompleted: true },
    );
  });

  it("enqueueInstall() preserves owner and version for the queue executor", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.enqueueInstall({
      slug: "my-skill",
      ownerHandle: "publisher",
      version: "2.1.0",
    });

    const catalog = mocks.catalogManagerInstances[0];
    expect(catalog.prepareInstall).toHaveBeenCalledWith({
      slug: "my-skill",
      ownerHandle: "publisher",
      version: "2.1.0",
    });
  });

  it("enqueueInstall() does not replace context for an in-flight slug", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];
    queue.getQueue.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "other-publisher",
        source: "managed",
        status: "downloading",
      },
    ]);

    service.enqueueInstall({
      slug: "my-skill",
      ownerHandle: "other-publisher",
      version: "9.0.0",
    });

    const catalog = mocks.catalogManagerInstances[0];
    expect(catalog.prepareInstall).not.toHaveBeenCalled();
  });

  it("enqueueInstall() rejects a completed slug from another owner", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];
    queue.getQueue.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher-a",
        source: "managed",
        status: "done",
      },
    ]);

    expect(() =>
      service.enqueueInstall({
        slug: "my-skill",
        ownerHandle: "publisher-b",
      }),
    ).toThrow(
      "A different or unknown skill identity already occupies my-skill",
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("enqueueInstall() replaces a completed same-owner task for an update", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher",
        source: "managed",
        status: "installed",
        version: "1.0.0",
        installedAt: "2026-07-28T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];
    queue.getQueue.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher",
        source: "managed",
        status: "done",
      },
    ]);

    service.enqueueInstall({
      slug: "my-skill",
      ownerHandle: "publisher",
      version: "2.0.0",
      update: true,
    });

    expect(queue.enqueue).toHaveBeenCalledWith(
      "my-skill",
      "managed",
      "publisher",
      { operation: "update", replaceCompleted: true },
    );
    expect(
      mocks.catalogManagerInstances[0]?.prepareInstall,
    ).toHaveBeenCalledWith({
      slug: "my-skill",
      ownerHandle: "publisher",
      version: "2.0.0",
    });
  });

  it("enqueueInstall() rejects updates without matching managed ownership", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: null,
        source: "managed",
        status: "installed",
        version: "1.0.0",
        installedAt: "2026-07-28T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);

    expect(() =>
      service.enqueueInstall({
        slug: "my-skill",
        ownerHandle: "publisher",
        version: "2.0.0",
        update: true,
      }),
    ).toThrow("Skill update is not allowed for my-skill");
  });

  it("enqueueInstall() rejects an update when a custom record shares the physical slug", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher",
        source: "managed",
        status: "installed",
        version: "1.0.0",
        installedAt: "2026-07-28T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
      {
        slug: "my-skill",
        ownerHandle: null,
        source: "custom",
        status: "installed",
        version: null,
        installedAt: "2026-07-28T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);

    expect(() =>
      service.enqueueInstall({
        slug: "my-skill",
        ownerHandle: "publisher",
        version: "2.0.0",
        update: true,
      }),
    ).toThrow("Skill update is not allowed for my-skill");
  });

  it("enqueueInstall() reinstalls a managed ledger entry whose directory is missing", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher",
        source: "managed",
        status: "installed",
        version: "1.0.0",
        installedAt: "2026-07-28T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];

    service.enqueueInstall({
      slug: "my-skill",
      ownerHandle: "publisher",
      version: "1.0.0",
    });

    expect(queue.enqueue).toHaveBeenCalledWith(
      "my-skill",
      "managed",
      "publisher",
    );
  });

  it("enqueueInstall() rejects same-version and downgrade requests", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher",
        source: "managed",
        status: "installed",
        version: "2.0.0",
        installedAt: "2026-07-28T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);

    expect(() =>
      service.enqueueInstall({
        slug: "my-skill",
        ownerHandle: "publisher",
        version: "2.0.0",
        update: true,
      }),
    ).toThrow("Skill update is not allowed for my-skill");
    expect(() =>
      service.enqueueInstall({
        slug: "my-skill",
        ownerHandle: "publisher",
        version: "1.9.0",
        update: true,
      }),
    ).toThrow("Skill update is not allowed for my-skill");
  });

  it("enqueueInstall() does not replace an in-flight same-owner update", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];
    queue.getQueue.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher",
        source: "managed",
        status: "downloading",
      },
    ]);

    service.enqueueInstall({
      slug: "my-skill",
      ownerHandle: "publisher",
      version: "2.0.0",
      update: true,
    });

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(
      mocks.catalogManagerInstances[0]?.prepareInstall,
    ).not.toHaveBeenCalled();
  });

  it("enqueueInstall() rejects a different owner for an in-flight slug", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];
    queue.getQueue.mockReturnValue([
      {
        slug: "my-skill",
        ownerHandle: "publisher-a",
        source: "managed",
        status: "downloading",
      },
    ]);

    expect(() =>
      service.enqueueInstall({
        slug: "my-skill",
        ownerHandle: "publisher-b",
      }),
    ).toThrow("A different publisher is already installing my-skill");
  });

  it("installWorkspaceSkill() preserves a valid owner-scoped legacy slug", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);
    const catalog = mocks.catalogManagerInstances[0];
    catalog.canonicalizeSlug.mockReturnValue("find-skill");
    catalog.getCatalogSkill.mockResolvedValue({
      slug: "find-skills",
      ownerHandle: "guipi888",
      name: "Find Skills",
      description: "Discover skills",
      downloads: 1,
      stars: 0,
      tags: [],
      version: "2.0.0",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    catalog.executeInstall.mockImplementation(async (installedSlug: string) => {
      const target = path.join(env.openclawSkillsDir, installedSlug);
      mkdirSync(target, { recursive: true });
      writeFileSync(
        path.join(target, "SKILL.md"),
        "---\nname: Find Skills\n---\n",
      );
    });

    await expect(
      service.installWorkspaceSkill(
        {
          slug: "find-skills",
          ownerHandle: "guipi888",
          version: "2.0.0",
        },
        "bot-1",
      ),
    ).resolves.toEqual({ ok: true });

    expect(catalog.canonicalizeSlug).not.toHaveBeenCalled();
    expect(catalog.getCatalogSkill).toHaveBeenCalledWith(
      "find-skills",
      "guipi888",
    );
    expect(catalog.prepareInstall).toHaveBeenCalledWith({
      slug: "find-skills",
      ownerHandle: "guipi888",
      version: "2.0.0",
    });
    expect(catalog.executeInstall).toHaveBeenCalledWith("find-skills");
    expect(db.recordInstalls).toHaveBeenCalledWith([
      {
        slug: "find-skills",
        source: "managed",
        version: "2.0.0",
        ownerHandle: "guipi888",
      },
      {
        slug: "find-skills",
        source: "workspace",
        version: "2.0.0",
        agentId: "bot-1",
        ownerHandle: "guipi888",
      },
    ]);
    expect(db.recordInstall).not.toHaveBeenCalled();
    expect(catalog.commitInstall).toHaveBeenCalledWith("find-skills");
  });

  it("installWorkspaceSkill() reuses owner and version from a shared install", async () => {
    const env = createEnv(rootDir);
    const sharedDir = path.join(env.openclawSkillsDir, "weather");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      path.join(sharedDir, "SKILL.md"),
      "---\nname: Weather\n---\n",
    );
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        version: "3.1.0",
        ownerHandle: "publisher",
        installedAt: "2026-07-29T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);

    await expect(
      service.installWorkspaceSkill("weather", "bot-2"),
    ).resolves.toEqual({ ok: true });

    expect(db.recordInstall).toHaveBeenCalledWith(
      "weather",
      "workspace",
      "3.1.0",
      "bot-2",
      "publisher",
    );
  });

  it("installWorkspaceSkill() upgrades an exact shared version before copying it", async () => {
    const env = createEnv(rootDir);
    const sharedDir = path.join(env.openclawSkillsDir, "weather");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(path.join(sharedDir, "SKILL.md"), "# Weather v1\n");
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        version: "1.0.0",
        ownerHandle: "publisher",
        installedAt: "2026-07-29T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);
    const catalog = mocks.catalogManagerInstances[0];
    catalog.getCatalogSkill.mockResolvedValue({
      slug: "weather",
      ownerHandle: "publisher",
      name: "Weather",
      description: "Weather forecasts",
      downloads: 1,
      stars: 0,
      tags: [],
      version: "2.0.0",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    catalog.executeInstall.mockImplementation(async () => {
      writeFileSync(path.join(sharedDir, "SKILL.md"), "# Weather v2\n");
    });
    catalog.consumeInstalledMetadata.mockReturnValue({
      version: "2.0.0",
      ownerHandle: "publisher",
    });

    await expect(
      service.installWorkspaceSkill(
        {
          slug: "weather",
          ownerHandle: "publisher",
          version: "2.0.0",
        },
        "bot-2",
      ),
    ).resolves.toEqual({ ok: true });

    expect(catalog.prepareInstall).toHaveBeenCalledWith({
      slug: "weather",
      ownerHandle: "publisher",
      version: "2.0.0",
    });
    expect(catalog.executeInstall).toHaveBeenCalledWith("weather");
    expect(
      readFileSync(
        path.join(
          env.openclawStateDir,
          "agents",
          "bot-2",
          "skills",
          "weather",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toBe("# Weather v2\n");
    expect(db.recordInstalls).toHaveBeenCalledWith([
      expect.objectContaining({
        source: "managed",
        version: "2.0.0",
        ownerHandle: "publisher",
      }),
      expect.objectContaining({
        source: "workspace",
        version: "2.0.0",
        ownerHandle: "publisher",
        agentId: "bot-2",
      }),
    ]);
  });

  it("installWorkspaceSkill() restores the previous workspace when ledger persistence fails", async () => {
    const env = createEnv(rootDir);
    const sharedDir = path.join(env.openclawSkillsDir, "weather");
    const workspaceDir = path.join(
      env.openclawStateDir,
      "agents",
      "bot-2",
      "skills",
      "weather",
    );
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(path.join(sharedDir, "SKILL.md"), "# New\n");
    writeFileSync(path.join(workspaceDir, "SKILL.md"), "# Previous\n");
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        version: "2.0.0",
        ownerHandle: "publisher",
        installedAt: "2026-07-29T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    db.recordInstall.mockImplementation(() => {
      throw new Error("ledger unavailable");
    });
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);

    await expect(
      service.installWorkspaceSkill(
        { slug: "weather", ownerHandle: "publisher", version: "2.0.0" },
        "bot-2",
      ),
    ).rejects.toThrow("ledger unavailable");
    expect(readFileSync(path.join(workspaceDir, "SKILL.md"), "utf8")).toBe(
      "# Previous\n",
    );
  });

  it("installWorkspaceSkill() rejects a selected publisher when another owner occupies the shared slug", async () => {
    const env = createEnv(rootDir);
    const sharedDir = path.join(env.openclawSkillsDir, "weather");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(path.join(sharedDir, "SKILL.md"), "# Weather\n");
    const db = createMockSkillDb();
    db.getInstalledRecordsBySlug.mockReturnValue([
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        version: "1.0.0",
        ownerHandle: "publisher-a",
        installedAt: "2026-07-29T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ]);
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    const service = await SkillhubService.create(env);

    await expect(
      service.installWorkspaceSkill(
        {
          slug: "weather",
          ownerHandle: "publisher-b",
          version: "2.0.0",
        },
        "bot-2",
      ),
    ).resolves.toEqual({
      ok: false,
      error: "A different or unknown skill identity already occupies weather",
    });
    expect(
      mocks.catalogManagerInstances[0]?.executeInstall,
    ).not.toHaveBeenCalled();
  });

  it("cancelInstall() canonicalizes slug before cancelling queue item", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];
    catalog.canonicalizeSlug.mockReturnValue("find-skill");

    const result = service.cancelInstall("find-skills");

    expect(catalog.canonicalizeSlug).toHaveBeenCalledWith("find-skills");
    expect(queue.cancel).toHaveBeenCalledWith("find-skill");
    expect(catalog.clearPreparedInstall).toHaveBeenCalledWith("find-skill");
    expect(result).toBe(true);
  });

  it("uninstallSkill() refuses to race an active update", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];
    catalog.canonicalizeSlug.mockReturnValue("find-skill");
    queue.hasActiveUpdate.mockReturnValue(true);

    await expect(
      service.uninstallSkill({ slug: "find-skills" }),
    ).resolves.toEqual({
      ok: false,
      error: "Cannot uninstall find-skill while an update is in progress",
    });
    expect(queue.cancel).not.toHaveBeenCalled();
    expect(catalog.uninstallSkill).not.toHaveBeenCalled();
  });

  it("uninstallSkill() preserves an installed owner-scoped raw alias", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const catalog = mocks.catalogManagerInstances[0];
    catalog.canonicalizeSlug.mockReturnValue("find-skills");

    await expect(
      service.uninstallSkill({ slug: "find-skills" }),
    ).resolves.toEqual({ ok: true });
    expect(catalog.uninstallSkill).toHaveBeenCalledWith({
      slug: "find-skills",
    });
  });

  describe("onSyncNeeded callback", () => {
    it("calls onSyncNeeded via onIdle (not per-install onComplete)", async () => {
      const env = createEnv(rootDir);
      const db = createMockSkillDb();
      mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
      const onSyncNeeded = vi.fn();

      await SkillhubService.create(env, { onSyncNeeded });

      const queue = mocks.installQueueInstances[0];

      // onComplete only records in DB, does NOT call onSyncNeeded
      const onComplete = queue.opts.onComplete as (
        slug: string,
        source: string,
      ) => void;
      onComplete("alpha", "managed");
      expect(db.recordInstall).toHaveBeenCalledWith(
        "alpha",
        "managed",
        undefined,
        undefined,
        undefined,
      );
      expect(onSyncNeeded).not.toHaveBeenCalled();

      // onIdle fires onSyncNeeded (when queue drains)
      const onIdle = queue.opts.onIdle as () => void;
      onIdle();
      expect(onSyncNeeded).toHaveBeenCalledTimes(1);
    });

    it("calls onSyncNeeded after cancel cleanup completes", async () => {
      const env = createEnv(rootDir);
      const db = createMockSkillDb();
      mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
      const onSyncNeeded = vi.fn();

      await SkillhubService.create(env, { onSyncNeeded });

      const queue = mocks.installQueueInstances[0];
      const onCancelled = queue.opts.onCancelled as (
        slug: string,
      ) => Promise<void>;

      await onCancelled("beta");

      expect(onSyncNeeded).toHaveBeenCalledTimes(1);
    });

    it("does not throw when onSyncNeeded is not provided", async () => {
      const env = createEnv(rootDir);
      const db = createMockSkillDb();
      mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

      await SkillhubService.create(env);

      const queue = mocks.installQueueInstances[0];
      const onComplete = queue.opts.onComplete as (
        slug: string,
        source: string,
      ) => void;
      const onCancelled = queue.opts.onCancelled as (
        slug: string,
      ) => Promise<void>;

      expect(() => onComplete("alpha", "managed")).not.toThrow();
      await expect(onCancelled("beta")).resolves.toBeUndefined();
    });
  });

  it("dispose() stops watcher, disposes queue, disposes catalogManager in order", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const callOrder: string[] = [];

    const service = await SkillhubService.create(env);
    const watcher = mocks.dirWatcherInstances[0];
    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];

    watcher.stop.mockImplementation(() => {
      callOrder.push("dirWatcher.stop");
    });
    queue.dispose.mockImplementation(() => {
      callOrder.push("installQueue.dispose");
    });
    catalog.dispose.mockImplementation(() => {
      callOrder.push("catalogManager.dispose");
    });

    service.dispose();

    expect(callOrder).toEqual([
      "dirWatcher.stop",
      "installQueue.dispose",
      "catalogManager.dispose",
    ]);
  });
});
