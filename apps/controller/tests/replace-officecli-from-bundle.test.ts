import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replaceOfficeCliFromBundle } from "../src/services/skillhub/curated-skills.js";
import { SkillDb } from "../src/services/skillhub/skill-db.js";

function seedBundle(bundleRoot: string, content: string): void {
  const sourceDir = resolve(bundleRoot, "officecli");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(resolve(sourceDir, "SKILL.md"), content, "utf8");
}

function seedExistingInstall(targetRoot: string, content = "custom\n"): string {
  const destinationDir = resolve(targetRoot, "officecli");
  mkdirSync(destinationDir, { recursive: true });
  writeFileSync(resolve(destinationDir, "SKILL.md"), content, "utf8");
  writeFileSync(resolve(destinationDir, "keep.txt"), "keep me\n", "utf8");
  return destinationDir;
}

describe("replaceOfficeCliFromBundle", () => {
  let workspaceRoot: string;
  let bundleRoot: string;
  let targetRoot: string;
  let ledgerPath: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(resolve(tmpdir(), "nexu-officecli-refresh-"));
    bundleRoot = resolve(workspaceRoot, "bundle");
    targetRoot = resolve(workspaceRoot, "state-skills");
    ledgerPath = resolve(workspaceRoot, "skill-ledger.json");
    mkdirSync(bundleRoot, { recursive: true });
    mkdirSync(targetRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("reports a missing bundle without changing the ledger", async () => {
    const db = await SkillDb.create(ledgerPath);

    expect(
      replaceOfficeCliFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual({ installed: false, reason: "bundle-missing" });
    expect(db.getAllInstalled()).toEqual([]);
  });

  it("installs a fresh bundle and records it as managed", async () => {
    seedBundle(bundleRoot, "---\nname: officecli\n---\n\n# OfficeCLI v1\n");
    const db = await SkillDb.create(ledgerPath);

    expect(
      replaceOfficeCliFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual({ installed: true, reason: "fresh-install" });

    expect(
      readFileSync(resolve(targetRoot, "officecli", "SKILL.md"), "utf8"),
    ).toContain("OfficeCLI v1");
    expect(db.getAllInstalled()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "officecli",
          source: "managed",
          status: "installed",
        }),
      ]),
    );
  });

  it("replaces stale content owned by an installed managed record", async () => {
    const destinationDir = seedExistingInstall(targetRoot, "stale\n");
    seedBundle(bundleRoot, "---\nname: officecli\n---\n\n# OfficeCLI v2\n");
    const db = await SkillDb.create(ledgerPath);
    db.recordInstall("officecli", "managed");

    expect(
      replaceOfficeCliFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual({ installed: true, reason: "replaced" });

    expect(existsSync(resolve(destinationDir, "keep.txt"))).toBe(false);
    expect(readFileSync(resolve(destinationDir, "SKILL.md"), "utf8")).toContain(
      "OfficeCLI v2",
    );
    expect(
      db.getAllInstalled().find((record) => record.slug === "officecli"),
    ).toMatchObject({ source: "managed", status: "installed" });
  });

  it.each(["custom", "user"] as const)(
    "preserves an existing %s-owned directory",
    async (source) => {
      const destinationDir = seedExistingInstall(targetRoot);
      seedBundle(bundleRoot, "---\nname: officecli\n---\n\n# bundled\n");
      const db = await SkillDb.create(ledgerPath);
      db.recordInstall("officecli", source);

      expect(
        replaceOfficeCliFromBundle({
          staticDir: bundleRoot,
          targetDir: targetRoot,
          skillDb: db,
        }),
      ).toEqual({ installed: false, reason: "ownership-conflict" });

      expect(readFileSync(resolve(destinationDir, "SKILL.md"), "utf8")).toBe(
        "custom\n",
      );
      expect(readFileSync(resolve(destinationDir, "keep.txt"), "utf8")).toBe(
        "keep me\n",
      );
      expect(
        db.getAllInstalled().some((record) => record.source === "managed"),
      ).toBe(false);
    },
  );

  it.each(["custom", "user"] as const)(
    "does not create a managed copy when an installed %s record owns the slug",
    async (source) => {
      seedBundle(bundleRoot, "---\nname: officecli\n---\n\n# bundled\n");
      const db = await SkillDb.create(ledgerPath);
      db.recordInstall("officecli", source);

      expect(
        replaceOfficeCliFromBundle({
          staticDir: bundleRoot,
          targetDir: targetRoot,
          skillDb: db,
        }),
      ).toEqual({ installed: false, reason: "ownership-conflict" });

      expect(existsSync(resolve(targetRoot, "officecli"))).toBe(false);
      expect(
        db.getAllInstalled().some((record) => record.source === "managed"),
      ).toBe(false);
    },
  );

  it("preserves a managed directory owned by another publisher", async () => {
    const destinationDir = seedExistingInstall(targetRoot, "publisher copy\n");
    seedBundle(bundleRoot, "---\nname: officecli\n---\n\n# bundled\n");
    const db = await SkillDb.create(ledgerPath);
    db.recordInstall("officecli", "managed", "2.0.0", null, "publisher");

    expect(
      replaceOfficeCliFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual({ installed: false, reason: "ownership-conflict" });

    expect(readFileSync(resolve(destinationDir, "SKILL.md"), "utf8")).toBe(
      "publisher copy\n",
    );
    expect(db.getInstalledRecordsBySlug("officecli")).toEqual([
      expect.objectContaining({
        source: "managed",
        ownerHandle: "publisher",
        version: "2.0.0",
      }),
    ]);
  });

  it("does not create a bundled copy for a publisher-owned managed record", async () => {
    seedBundle(bundleRoot, "---\nname: officecli\n---\n\n# bundled\n");
    const db = await SkillDb.create(ledgerPath);
    db.recordInstall("officecli", "managed", "2.0.0", null, "publisher");

    expect(
      replaceOfficeCliFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual({ installed: false, reason: "ownership-conflict" });

    expect(existsSync(resolve(targetRoot, "officecli"))).toBe(false);
  });

  it("preserves an untracked existing directory", async () => {
    const destinationDir = seedExistingInstall(targetRoot);
    seedBundle(bundleRoot, "---\nname: officecli\n---\n\n# bundled\n");
    const db = await SkillDb.create(ledgerPath);

    expect(
      replaceOfficeCliFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual({ installed: false, reason: "ownership-conflict" });

    expect(readFileSync(resolve(destinationDir, "SKILL.md"), "utf8")).toBe(
      "custom\n",
    );
    expect(existsSync(resolve(destinationDir, "keep.txt"))).toBe(true);
    expect(db.getAllInstalled()).toEqual([]);
  });

  it("preserves an existing directory after its managed record was uninstalled", async () => {
    const destinationDir = seedExistingInstall(targetRoot);
    seedBundle(bundleRoot, "---\nname: officecli\n---\n\n# bundled\n");
    writeFileSync(
      ledgerPath,
      JSON.stringify({
        skills: [
          {
            slug: "officecli",
            source: "managed",
            status: "uninstalled",
            version: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            uninstalledAt: "2026-02-01T00:00:00.000Z",
            agentId: null,
          },
        ],
      }),
      "utf8",
    );
    const db = await SkillDb.create(ledgerPath);

    expect(
      replaceOfficeCliFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual({ installed: false, reason: "ownership-conflict" });

    expect(readFileSync(resolve(destinationDir, "SKILL.md"), "utf8")).toBe(
      "custom\n",
    );
    expect(existsSync(resolve(destinationDir, "keep.txt"))).toBe(true);
    expect(db.getAllInstalled()).toEqual([]);
  });
});
