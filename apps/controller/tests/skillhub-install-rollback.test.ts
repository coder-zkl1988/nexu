import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SkillDb,
  SkillRecord,
} from "../src/services/skillhub/skill-db.js";

const mocks = vi.hoisted(() => {
  const execFileAsync = vi.fn();
  const execFile = vi.fn();
  Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), {
    value: execFileAsync,
  });
  return {
    ensureNpmAvailable: vi.fn(),
    execFile,
    execFileAsync,
    runNpmInstall: vi.fn(),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFile: mocks.execFile };
});

vi.mock("../src/services/skillhub/npm-runner.js", () => ({
  ensureNpmAvailable: mocks.ensureNpmAvailable,
  runNpmInstall: mocks.runNpmInstall,
}));

import { CatalogManager } from "../src/services/skillhub/catalog-manager.js";

describe("CatalogManager install rollback", () => {
  let rootDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-skill-rollback-"));
    skillsDir = path.join(rootDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
    mocks.execFileAsync.mockReset();
    mocks.ensureNpmAvailable.mockReset();
    mocks.runNpmInstall.mockReset();
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function transactionArtifacts(): string[] {
    return readdirSync(skillsDir)
      .filter((entry) => entry.startsWith(".install-"))
      .sort();
  }

  function mockClawHubInstall(options?: {
    ownerHandle?: string;
    version?: string;
    packageJson?: boolean;
    skillMd?: string;
  }): void {
    mocks.execFileAsync.mockImplementation(
      async (_file: string, args: string[]) => {
        const workdir = args[args.indexOf("--workdir") + 1];
        const skillRef = args[args.indexOf("install") + 1];
        const installedDir = path.join(workdir, skillRef);
        mkdirSync(installedDir, { recursive: true });
        writeFileSync(
          path.join(installedDir, "SKILL.md"),
          options?.skillMd ?? "new skill\n",
        );
        if (options?.packageJson) {
          writeFileSync(path.join(installedDir, "package.json"), "{}\n");
        }
        if (options?.ownerHandle || options?.version) {
          mkdirSync(path.join(installedDir, ".clawhub"), { recursive: true });
          writeFileSync(
            path.join(installedDir, ".clawhub", "origin.json"),
            JSON.stringify({
              ...(options.ownerHandle
                ? { ownerHandle: options.ownerHandle }
                : {}),
              ...(options.version ? { installedVersion: options.version } : {}),
            }),
          );
        }
        return { stdout: "", stderr: "" };
      },
    );
  }

  it("restores an ownerless install when dependency installation fails", async () => {
    const targetDir = path.join(skillsDir, "weather");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "SKILL.md"), "old skill\n");

    mocks.execFileAsync.mockImplementation(
      async (_file: string, args: string[]) => {
        const workdir = args[args.indexOf("--workdir") + 1];
        const skillRef = args[args.indexOf("install") + 1];
        const installedDir = path.join(workdir, skillRef);
        mkdirSync(installedDir, { recursive: true });
        writeFileSync(path.join(installedDir, "SKILL.md"), "new skill\n");
        writeFileSync(path.join(installedDir, "package.json"), "{}\n");
        return { stdout: "", stderr: "" };
      },
    );
    mocks.ensureNpmAvailable.mockResolvedValue(undefined);
    mocks.runNpmInstall.mockRejectedValue(new Error("registry unavailable"));

    const skillDb = { close: vi.fn() } as unknown as SkillDb;
    const catalog = new CatalogManager(path.join(rootDir, "cache"), {
      skillsDir,
      skillDb,
    });

    await expect(catalog.executeInstall("weather")).rejects.toThrow(
      "DEPS_INSTALL_FAILED",
    );
    expect(readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe(
      "old skill\n",
    );
    expect(
      readdirSync(skillsDir).filter((entry) =>
        entry.startsWith(".install-staging-"),
      ),
    ).toEqual([]);
    expect(mocks.runNpmInstall).toHaveBeenCalledTimes(1);
    expect(mocks.runNpmInstall.mock.calls[0]?.[0]).not.toBe(targetDir);
    expect(mocks.runNpmInstall.mock.calls[0]?.[0]).toContain(
      ".install-staging-",
    );
  });

  it("records the resolved publisher from an ownerless ClawHub install", async () => {
    mocks.execFileAsync.mockImplementation(
      async (_file: string, args: string[]) => {
        const workdir = args[args.indexOf("--workdir") + 1];
        const skillRef = args[args.indexOf("install") + 1];
        const installedDir = path.join(workdir, skillRef);
        mkdirSync(path.join(installedDir, ".clawhub"), { recursive: true });
        writeFileSync(path.join(installedDir, "SKILL.md"), "new skill\n");
        writeFileSync(
          path.join(installedDir, ".clawhub", "origin.json"),
          JSON.stringify({
            installedVersion: "2.4.0",
            ownerHandle: "Publisher.Name",
          }),
        );
        return { stdout: "", stderr: "" };
      },
    );

    const skillDb = { close: vi.fn() } as unknown as SkillDb;
    const catalog = new CatalogManager(path.join(rootDir, "cache"), {
      skillsDir,
      skillDb,
    });

    await catalog.executeInstall("weather");

    expect(catalog.consumeInstalledMetadata("weather")).toEqual({
      version: "2.4.0",
      ownerHandle: "publisher.name",
    });
  });

  it("rejects mismatched origin metadata before dependencies or live swap", async () => {
    const targetDir = path.join(skillsDir, "weather");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "SKILL.md"), "old skill\n");
    mockClawHubInstall({
      ownerHandle: "other-publisher",
      version: "2.0.0",
      packageJson: true,
    });
    const catalog = new CatalogManager(path.join(rootDir, "cache"), {
      skillsDir,
      skillDb: { close: vi.fn() } as unknown as SkillDb,
    });
    catalog.prepareInstall({
      slug: "weather",
      ownerHandle: "publisher",
      version: "2.0.0",
    });

    await expect(catalog.executeInstall("weather")).rejects.toThrow(
      "unexpected owner other-publisher",
    );

    expect(mocks.ensureNpmAvailable).not.toHaveBeenCalled();
    expect(mocks.runNpmInstall).not.toHaveBeenCalled();
    expect(readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe(
      "old skill\n",
    );
    expect(transactionArtifacts()).toEqual([]);
  });

  it("rolls back a swapped update on startup when the ledger was not committed", async () => {
    const targetDir = path.join(skillsDir, "weather");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "SKILL.md"), "old skill\n");
    mockClawHubInstall({ ownerHandle: "publisher", version: "2.0.0" });

    const records: SkillRecord[] = [
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        version: "1.0.0",
        ownerHandle: "publisher",
        installedAt: "2026-07-01T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ];
    const skillDb = {
      getInstalledRecordsBySlug: vi.fn(() => records),
    } as unknown as SkillDb;
    const catalog = new CatalogManager(path.join(rootDir, "cache"), {
      skillsDir,
      skillDb,
    });
    catalog.prepareInstall({
      slug: "weather",
      ownerHandle: "publisher",
      version: "2.0.0",
    });

    await catalog.executeInstall("weather");
    expect(readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe(
      "new skill\n",
    );
    expect(transactionArtifacts()).toEqual([".install-transaction-weather"]);
    expect(
      readdirSync(path.join(skillsDir, ".install-transaction-weather")).sort(),
    ).toEqual(["previous", "transaction.json"]);

    new CatalogManager(path.join(rootDir, "cache-2"), {
      skillsDir,
      skillDb,
    }).start();

    expect(readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe(
      "old skill\n",
    );
    expect(transactionArtifacts()).toEqual([]);
  });

  it("removes a fresh swapped install on startup when no ledger record exists", async () => {
    const targetDir = path.join(skillsDir, "weather");
    mockClawHubInstall({ ownerHandle: "publisher", version: "1.0.0" });
    const skillDb = {
      getInstalledRecordsBySlug: vi.fn(() => []),
    } as unknown as SkillDb;
    const catalog = new CatalogManager(path.join(rootDir, "cache"), {
      skillsDir,
      skillDb,
    });
    catalog.prepareInstall({
      slug: "weather",
      ownerHandle: "publisher",
      version: "1.0.0",
    });

    await catalog.executeInstall("weather");
    expect(readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe(
      "new skill\n",
    );

    new CatalogManager(path.join(rootDir, "cache-2"), {
      skillsDir,
      skillDb,
    }).start();

    expect(transactionArtifacts()).toEqual([]);
    expect(() =>
      readFileSync(path.join(targetDir, "SKILL.md"), "utf8"),
    ).toThrow();
  });

  it("commits a swapped update on startup when owner and version match the ledger", async () => {
    const targetDir = path.join(skillsDir, "weather");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "SKILL.md"), "old skill\n");
    mockClawHubInstall({ ownerHandle: "publisher", version: "2.0.0" });

    const records: SkillRecord[] = [
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        version: "1.0.0",
        ownerHandle: "publisher",
        installedAt: "2026-07-01T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ];
    const skillDb = {
      getInstalledRecordsBySlug: vi.fn(() => records),
    } as unknown as SkillDb;
    const catalog = new CatalogManager(path.join(rootDir, "cache"), {
      skillsDir,
      skillDb,
    });
    catalog.prepareInstall({
      slug: "weather",
      ownerHandle: "publisher",
      version: "2.0.0",
    });

    await catalog.executeInstall("weather");
    records[0] = {
      slug: "weather",
      source: "managed",
      status: "installed",
      version: "2.0.0",
      ownerHandle: "publisher",
      installedAt: new Date().toISOString(),
      uninstalledAt: null,
      agentId: null,
    };

    new CatalogManager(path.join(rootDir, "cache-2"), {
      skillsDir,
      skillDb,
    }).start();

    expect(readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe(
      "new skill\n",
    );
    expect(transactionArtifacts()).toEqual([]);
  });

  it("rolls back when only an older matching ledger record exists", async () => {
    const targetDir = path.join(skillsDir, "weather");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "SKILL.md"), "old skill\n");
    mockClawHubInstall({ ownerHandle: "publisher", version: "2.0.0" });

    const records: SkillRecord[] = [
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        version: "2.0.0",
        ownerHandle: "publisher",
        installedAt: "2026-07-01T00:00:00.000Z",
        uninstalledAt: null,
        agentId: null,
      },
    ];
    const skillDb = {
      getInstalledRecordsBySlug: vi.fn(() => records),
    } as unknown as SkillDb;
    const catalog = new CatalogManager(path.join(rootDir, "cache"), {
      skillsDir,
      skillDb,
    });
    catalog.prepareInstall({
      slug: "weather",
      ownerHandle: "publisher",
      version: "2.0.0",
    });

    await catalog.executeInstall("weather");
    new CatalogManager(path.join(rootDir, "cache-2"), {
      skillsDir,
      skillDb,
    }).start();

    expect(readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe(
      "old skill\n",
    );
    expect(transactionArtifacts()).toEqual([]);
  });
});
