import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TABBY_MEDIA_MANAGED_MARKER,
  recoverManagedBundleRefreshTransactions,
  replaceTabbyMediaSkillsFromBundle,
} from "../src/services/skillhub/curated-skills.js";
import { SkillDb } from "../src/services/skillhub/skill-db.js";
import { SkillDirWatcher } from "../src/services/skillhub/skill-dir-watcher.js";

const TABBY_MEDIA_SKILL_SLUGS = ["tabby-image", "tabby-video"] as const;

function seedBundle(bundleRoot: string, slug: string, content: string): void {
  const sourceDir = resolve(bundleRoot, slug);
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(resolve(sourceDir, "SKILL.md"), content, "utf8");
}

function seedExistingInstall(
  targetRoot: string,
  slug: string,
  content = "custom\n",
): string {
  const destinationDir = resolve(targetRoot, slug);
  mkdirSync(destinationDir, { recursive: true });
  writeFileSync(resolve(destinationDir, "SKILL.md"), content, "utf8");
  writeFileSync(resolve(destinationDir, "keep.txt"), "keep me\n", "utf8");
  return destinationDir;
}

describe("replaceTabbyMediaSkillsFromBundle", () => {
  let workspaceRoot: string;
  let bundleRoot: string;
  let targetRoot: string;
  let ledgerPath: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(
      resolve(tmpdir(), "nexu-tabby-media-refresh-"),
    );
    bundleRoot = resolve(workspaceRoot, "bundle");
    targetRoot = resolve(workspaceRoot, "state-skills");
    ledgerPath = resolve(workspaceRoot, "skill-ledger.json");
    mkdirSync(bundleRoot, { recursive: true });
    mkdirSync(targetRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("installs fresh managed copies when no owner is recorded", async () => {
    const db = await SkillDb.create(ledgerPath);
    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      seedBundle(bundleRoot, slug, `---\nname: ${slug}\n---\n\n# bundled\n`);
    }

    expect(
      replaceTabbyMediaSkillsFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual(
      TABBY_MEDIA_SKILL_SLUGS.map((slug) => ({
        slug,
        installed: true,
        reason: "fresh-install",
      })),
    );

    expect(db.getAllInstalled()).toEqual(
      expect.arrayContaining(
        TABBY_MEDIA_SKILL_SLUGS.map((slug) =>
          expect.objectContaining({ slug, source: "managed" }),
        ),
      ),
    );
  });

  it("claims a first-install copy that exactly matches the current bundle", async () => {
    const db = await SkillDb.create(ledgerPath);
    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      const content = `---\nname: ${slug}\n---\n\n# bundled\n`;
      seedBundle(bundleRoot, slug, content);
      const destinationDir = resolve(targetRoot, slug);
      mkdirSync(destinationDir, { recursive: true });
      writeFileSync(resolve(destinationDir, "SKILL.md"), content, "utf8");
      db.recordInstall(slug, "managed");
    }

    expect(
      replaceTabbyMediaSkillsFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual(
      TABBY_MEDIA_SKILL_SLUGS.map((slug) => ({
        slug,
        installed: true,
        reason: "replaced",
      })),
    );

    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      expect(
        readFileSync(
          resolve(targetRoot, slug, TABBY_MEDIA_MANAGED_MARKER),
          "utf8",
        ),
      ).toBe(`${slug}\n`);
    }
  });

  it("replaces stale copies owned by local managed records", async () => {
    const db = await SkillDb.create(ledgerPath);
    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      seedBundle(bundleRoot, slug, `---\nname: ${slug}\n---\n\n# current\n`);
      const destinationDir = seedExistingInstall(targetRoot, slug, "stale\n");
      writeFileSync(
        resolve(destinationDir, TABBY_MEDIA_MANAGED_MARKER),
        `${slug}\n`,
        "utf8",
      );
      db.recordInstall(slug, "managed");
    }

    expect(
      replaceTabbyMediaSkillsFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual(
      TABBY_MEDIA_SKILL_SLUGS.map((slug) => ({
        slug,
        installed: true,
        reason: "replaced",
      })),
    );

    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      const destinationDir = resolve(targetRoot, slug);
      expect(
        readFileSync(resolve(destinationDir, "SKILL.md"), "utf8"),
      ).toContain("# current");
      expect(existsSync(resolve(destinationDir, "keep.txt"))).toBe(false);
      expect(
        readFileSync(
          resolve(destinationDir, TABBY_MEDIA_MANAGED_MARKER),
          "utf8",
        ),
      ).toBe(`${slug}\n`);
    }
  });

  it("preserves an untracked custom copy even after disk sync labels it managed", async () => {
    const db = await SkillDb.create(ledgerPath);
    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      seedBundle(bundleRoot, slug, "bundled\n");
      seedExistingInstall(targetRoot, slug, "custom from disk\n");
      db.recordInstall(slug, "managed");
    }

    expect(
      replaceTabbyMediaSkillsFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual(
      TABBY_MEDIA_SKILL_SLUGS.map((slug) => ({
        slug,
        installed: false,
        reason: "ownership-conflict",
      })),
    );

    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      expect(readFileSync(resolve(targetRoot, slug, "SKILL.md"), "utf8")).toBe(
        "custom from disk\n",
      );
    }
  });

  it.each(["custom", "user"] as const)(
    "preserves %s-owned copies",
    async (source) => {
      const db = await SkillDb.create(ledgerPath);
      for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
        seedBundle(bundleRoot, slug, "bundled\n");
        seedExistingInstall(targetRoot, slug);
        db.recordInstall(slug, source);
      }

      expect(
        replaceTabbyMediaSkillsFromBundle({
          staticDir: bundleRoot,
          targetDir: targetRoot,
          skillDb: db,
        }),
      ).toEqual(
        TABBY_MEDIA_SKILL_SLUGS.map((slug) => ({
          slug,
          installed: false,
          reason: "ownership-conflict",
        })),
      );

      for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
        const destinationDir = resolve(targetRoot, slug);
        expect(readFileSync(resolve(destinationDir, "SKILL.md"), "utf8")).toBe(
          "custom\n",
        );
        expect(readFileSync(resolve(destinationDir, "keep.txt"), "utf8")).toBe(
          "keep me\n",
        );
      }
    },
  );

  it("preserves publisher-owned managed copies", async () => {
    const db = await SkillDb.create(ledgerPath);
    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      seedBundle(bundleRoot, slug, "bundled\n");
      seedExistingInstall(targetRoot, slug, "publisher copy\n");
      db.recordInstall(slug, "managed", "2.0.0", null, "publisher");
    }

    const results = replaceTabbyMediaSkillsFromBundle({
      staticDir: bundleRoot,
      targetDir: targetRoot,
      skillDb: db,
    });

    expect(
      results.every((result) => result.reason === "ownership-conflict"),
    ).toBe(true);
    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      expect(readFileSync(resolve(targetRoot, slug, "SKILL.md"), "utf8")).toBe(
        "publisher copy\n",
      );
    }
  });

  it("preserves untracked existing copies", async () => {
    const db = await SkillDb.create(ledgerPath);
    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      seedBundle(bundleRoot, slug, "bundled\n");
      seedExistingInstall(targetRoot, slug);
    }

    const results = replaceTabbyMediaSkillsFromBundle({
      staticDir: bundleRoot,
      targetDir: targetRoot,
      skillDb: db,
    });

    expect(
      results.every((result) => result.reason === "ownership-conflict"),
    ).toBe(true);
    expect(db.getAllInstalled()).toEqual([]);
  });

  it("does not reinstall explicitly uninstalled copies", async () => {
    const db = await SkillDb.create(ledgerPath);
    for (const slug of TABBY_MEDIA_SKILL_SLUGS) {
      seedBundle(bundleRoot, slug, "bundled\n");
      db.recordUninstall(slug, "managed");
    }
    seedExistingInstall(targetRoot, "tabby-image", "removed copy\n");

    expect(
      replaceTabbyMediaSkillsFromBundle({
        staticDir: bundleRoot,
        targetDir: targetRoot,
        skillDb: db,
      }),
    ).toEqual(
      TABBY_MEDIA_SKILL_SLUGS.map((slug) => ({
        slug,
        installed: false,
        reason: "ownership-conflict",
      })),
    );

    expect(
      readFileSync(resolve(targetRoot, "tabby-image", "SKILL.md"), "utf8"),
    ).toBe("removed copy\n");
    expect(existsSync(resolve(targetRoot, "tabby-video"))).toBe(false);
    expect(db.getAllInstalled()).toEqual([]);
  });

  it("restores the last known copy after an interrupted replacement", () => {
    const backupDir = resolve(
      targetRoot,
      ".tabby-video.backup-00000000-0000-0000-0000-000000000002",
    );
    const olderBackupDir = resolve(
      targetRoot,
      ".tabby-video.backup-00000000-0000-0000-0000-000000000001",
    );
    const stagingDir = resolve(
      targetRoot,
      ".tabby-video.staging-00000000-0000-0000-0000-000000000003",
    );
    seedExistingInstall(backupDir, "", "last known copy\n");
    seedExistingInstall(olderBackupDir, "", "older copy\n");
    seedExistingInstall(stagingDir, "", "incomplete copy\n");

    recoverManagedBundleRefreshTransactions(targetRoot);

    expect(
      readFileSync(resolve(targetRoot, "tabby-video", "SKILL.md"), "utf8"),
    ).toBe("last known copy\n");
    expect(existsSync(backupDir)).toBe(false);
    expect(existsSync(olderBackupDir)).toBe(false);
    expect(existsSync(stagingDir)).toBe(false);
  });

  it("keeps a completed replacement and removes its stale transaction dirs", () => {
    seedExistingInstall(targetRoot, "tabby-image", "current copy\n");
    const backupDir = resolve(
      targetRoot,
      ".tabby-image.backup-00000000-0000-0000-0000-000000000001",
    );
    const stagingDir = resolve(
      targetRoot,
      ".tabby-image.staging-00000000-0000-0000-0000-000000000002",
    );
    seedExistingInstall(backupDir, "", "old copy\n");
    seedExistingInstall(stagingDir, "", "incomplete copy\n");

    recoverManagedBundleRefreshTransactions(targetRoot);

    expect(
      readFileSync(resolve(targetRoot, "tabby-image", "SKILL.md"), "utf8"),
    ).toBe("current copy\n");
    expect(existsSync(backupDir)).toBe(false);
    expect(existsSync(stagingDir)).toBe(false);
  });

  it("does not reconcile hidden transaction directories as skills", async () => {
    const db = await SkillDb.create(ledgerPath);
    const hiddenDir = resolve(
      targetRoot,
      ".tabby-video.backup-00000000-0000-0000-0000-000000000001",
    );
    seedExistingInstall(hiddenDir, "", "backup copy\n");
    const watcher = new SkillDirWatcher({
      skillsDir: targetRoot,
      skillDb: db,
    });

    expect(watcher.syncNow()).toBe(false);
    expect(db.getAllInstalled()).toEqual([]);
  });
});
