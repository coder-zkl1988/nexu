import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillDb } from "../src/services/skillhub/skill-db.js";

const mocks = vi.hoisted(() => {
  const execFileAsync = vi.fn();
  const execFile = vi.fn();
  Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), {
    value: execFileAsync,
  });
  return {
    alignSkillName: vi.fn(),
    execFile,
    execFileAsync,
    stripRequiresBins: vi.fn(),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFile: mocks.execFile };
});

vi.mock(
  "../src/services/skillhub/curated-skills.js",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("../src/services/skillhub/curated-skills.js")
      >();
    return {
      ...original,
      alignSkillName: mocks.alignSkillName,
      stripRequiresBins: mocks.stripRequiresBins,
    };
  },
);

import { CatalogManager } from "../src/services/skillhub/catalog-manager.js";

describe("CatalogManager staged post-processing", () => {
  let rootDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-skill-postprocess-"));
    skillsDir = path.join(rootDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
    mocks.execFileAsync.mockReset();
    mocks.alignSkillName.mockReset();
    mocks.stripRequiresBins.mockReset();
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("keeps the live skill untouched when staged post-processing fails", async () => {
    const targetDir = path.join(skillsDir, "weather");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "SKILL.md"), "old skill\n");
    mocks.execFileAsync.mockImplementation(
      async (_file: string, args: string[]) => {
        const workdir = args[args.indexOf("--workdir") + 1];
        const installedDir = path.join(workdir, "weather");
        mkdirSync(installedDir, { recursive: true });
        writeFileSync(path.join(installedDir, "SKILL.md"), "new skill\n");
        return { stdout: "", stderr: "" };
      },
    );
    mocks.stripRequiresBins.mockImplementation(() => {
      throw new Error("post-processing failed");
    });

    const catalog = new CatalogManager(path.join(rootDir, "cache"), {
      skillsDir,
      skillDb: { close: vi.fn() } as unknown as SkillDb,
    });

    await expect(catalog.executeInstall("weather")).rejects.toThrow(
      "post-processing failed",
    );

    expect(mocks.alignSkillName).toHaveBeenCalledTimes(1);
    expect(mocks.stripRequiresBins).toHaveBeenCalledTimes(1);
    const stagedRoot = mocks.alignSkillName.mock.calls[0]?.[0];
    expect(stagedRoot).toContain(".install-staging-");
    expect(stagedRoot).not.toBe(skillsDir);
    expect(readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe(
      "old skill\n",
    );
    expect(
      readdirSync(skillsDir).filter((entry) => entry.startsWith(".install-")),
    ).toEqual([]);
  });
});
