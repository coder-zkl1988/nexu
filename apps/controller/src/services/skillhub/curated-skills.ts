import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { SkillDb } from "./skill-db.js";

const LIBTV_VIDEO_SLUG = "libtv-video";
const OFFICECLI_SLUG = "officecli";

/**
 * Skills to install from ClawHub on first launch.
 *
 * Publisher identity is pinned so unattended startup installs never select a
 * same-slug package by popularity or search order.
 */
export const CURATED_SKILLS: ReadonlyArray<{
  slug: string;
  ownerHandle: string;
}> = [
  { slug: "1password", ownerHandle: "steipete" },
  { slug: "healthcheck", ownerHandle: "stellarhold170nt" },
  { slug: "skill-vetter", ownerHandle: "spclaudehome" },
  { slug: "github", ownerHandle: "steipete" },
  { slug: "multi-search-engine", ownerHandle: "gpyangyoujun" },
  { slug: "weather", ownerHandle: "steipete" },
  { slug: "imap-smtp-email", ownerHandle: "gzlicanyi" },
  { slug: "calendar", ownerHandle: "ndcccccc" },
  { slug: "apple-notes", ownerHandle: "steipete" },
  // NOTE: "humanize-ai-text" was removed — ClawHub flagged it as malware and
  // blocks installation, which made every packaged-app boot retry the install.
  { slug: "file-organizer-skill", ownerHandle: "1999azzar" },
  { slug: "video-frames", ownerHandle: "steipete" },
  { slug: "session-logs", ownerHandle: "guogang1024" },
  { slug: "skill-creator", ownerHandle: "chindden" },
  { slug: "find-skill", ownerHandle: "breckengan" },
  { slug: "wechat-article-search", ownerHandle: "wuchubuzai2018" },
  { slug: "liblib-ai-gen", ownerHandle: "xtaq" },
  { slug: "listenhub-ai", ownerHandle: "kkaticld" },
] as const;

export const CURATED_SKILL_SLUGS: readonly string[] = CURATED_SKILLS.map(
  ({ slug }) => slug,
);

/**
 * Skills shipped as static files in the app bundle (apps/desktop/static/bundled-skills/).
 * These are NOT on ClawHub, so they're copied directly to the skills directory.
 */
export const STATIC_SKILL_SLUGS: readonly string[] = [
  "libtv-video",
  "coding-agent",
  "gh-issues",
  "clawhub",
  "nano-banana-one-shop",
  "deep-research",
  "research-to-diagram",
  "qiaomu-mondo-poster-design",
  "tabby-image",
  "tabby-video",
  "officecli",
] as const;

/**
 * Copies static skills from the app bundle to the target skills directory.
 * Respects the user's removal ledger — won't re-copy skills the user uninstalled.
 */
export function copyStaticSkills(params: {
  staticDir: string;
  targetDir: string;
  skillDb: SkillDb;
}): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(params.staticDir)) {
    return { copied, skipped };
  }

  const knownSlugs = params.skillDb.getAllKnownSlugs();

  for (const slug of STATIC_SKILL_SLUGS) {
    const destDir = resolve(params.targetDir, slug);
    if (existsSync(resolve(destDir, "SKILL.md"))) {
      skipped.push(slug);
      continue;
    }

    // Skip if ledger already knows this slug (user uninstalled it, or it's tracked)
    if (knownSlugs.has(slug)) {
      skipped.push(slug);
      continue;
    }

    const srcDir = resolve(params.staticDir, slug);
    if (!existsSync(srcDir)) {
      skipped.push(slug);
      continue;
    }

    mkdirSync(destDir, { recursive: true });
    cpSync(srcDir, destDir, { recursive: true });
    copied.push(slug);
  }

  return { copied, skipped };
}

/**
 * Unconditionally install the latest bundled libtv-video into the state
 * dir on every controller startup. If a previous copy exists, it is
 * wiped and replaced; if not, a fresh copy is installed. The managed
 * ledger record is upserted via `recordInstall`, which also flips any
 * prior `uninstalled` status back to `installed` (intentional — see
 * below).
 *
 * Why this exists: `copyStaticSkills` only copies a static skill on
 * first install (both `destDir/SKILL.md` and `knownSlugs.has(slug)`
 * guards skip thereafter), so bundled libtv-video updates never reach
 * existing users on an app update. This function is how the libtv-video
 * refactor (detached background waiter + direct Feishu delivery via
 * `feishu_send_video.py`) ships to existing users on their next boot.
 *
 * Scope constraints:
 *   - Only libtv-video. Other bundled static skills keep the existing
 *     first-install-only semantics from `copyStaticSkills`.
 *   - Only touches `<targetDir>/libtv-video/`. User-scoped copies under
 *     `~/.agents/skills/libtv-video/` and per-agent workspace copies
 *     under `<openclawStateDir>/agents/<agentId>/skills/libtv-video/`
 *     are left alone — they represent explicit user choices under
 *     different ledger sources.
 *   - Only modifies the `source: "managed"` ledger record. Workspace /
 *     user / custom records for the same slug are left untouched.
 *   - Does NOT respect the managed record's uninstalled status —
 *     libtv-video is treated as a core bundled capability that always
 *     tracks the shipped version. `recordInstall` upserts any prior
 *     `uninstalled` record back to `installed`.
 *
 * Why a dedicated function instead of reusing `copyStaticSkills`: its
 * `knownSlugs.has(slug)` guard skips on any ledger source, so even if
 * we removed the `managed` record beforehand, any stray workspace or
 * user record for libtv-video would still cause a silent skip. This
 * function bypasses that check deterministically.
 */
export function replaceLibtvVideoFromBundle(params: {
  staticDir: string;
  targetDir: string;
  skillDb: SkillDb;
}): {
  installed: boolean;
  reason: "bundle-missing" | "fresh-install" | "replaced";
} {
  const srcDir = resolve(params.staticDir, LIBTV_VIDEO_SLUG);
  if (!existsSync(srcDir)) {
    return { installed: false, reason: "bundle-missing" };
  }

  const destDir = resolve(params.targetDir, LIBTV_VIDEO_SLUG);
  const existed = existsSync(destDir);
  if (existed) {
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });
  params.skillDb.recordInstall(LIBTV_VIDEO_SLUG, "managed");

  return { installed: true, reason: existed ? "replaced" : "fresh-install" };
}

/**
 * Keep a managed OfficeCLI install aligned with the binary shipped by the
 * desktop app. Existing directories are replaced only when the ledger says
 * the shared physical slug is owned exclusively by an installed managed
 * record. This preserves custom, user, and untracked copies.
 */
export function replaceOfficeCliFromBundle(params: {
  staticDir: string;
  targetDir: string;
  skillDb: SkillDb;
}): {
  installed: boolean;
  reason:
    | "bundle-missing"
    | "fresh-install"
    | "replaced"
    | "ownership-conflict";
} {
  const srcDir = resolve(params.staticDir, OFFICECLI_SLUG);
  if (!existsSync(srcDir)) {
    return { installed: false, reason: "bundle-missing" };
  }

  const destDir = resolve(params.targetDir, OFFICECLI_SLUG);
  const sharedRecords = params.skillDb
    .getInstalledRecordsBySlug(OFFICECLI_SLUG)
    .filter((record) => record.source !== "workspace");
  if (
    sharedRecords.some(
      (record) => record.source !== "managed" || record.ownerHandle !== null,
    )
  ) {
    return { installed: false, reason: "ownership-conflict" };
  }
  const existed = existsSync(destDir);
  if (existed) {
    const managedOwnsDirectory =
      sharedRecords.length === 1 &&
      sharedRecords[0]?.source === "managed" &&
      sharedRecords[0].ownerHandle === null;
    if (!managedOwnsDirectory) {
      return { installed: false, reason: "ownership-conflict" };
    }
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });
  params.skillDb.recordInstall(OFFICECLI_SLUG, "managed");

  return { installed: true, reason: existed ? "replaced" : "fresh-install" };
}

export type CuratedInstallResult = {
  installed: string[];
  skipped: string[];
  failed: string[];
};

/**
 * Returns the list of curated skill slugs that need to be installed.
 * Skips slugs the user explicitly removed and slugs already present on disk.
 *
 * @deprecated Use {@link CatalogManager.getCuratedSlugsToEnqueue} instead,
 * which checks only the ledger (no disk I/O). This function is retained for
 * backward compatibility with {@link CatalogManager.installCuratedSkills}.
 */
export function resolveCuratedSkillsToInstall(params: {
  targetDir: string;
  skillDb: SkillDb;
}): { toInstall: string[]; toSkip: string[] } {
  const toInstall: string[] = [];
  const toSkip: string[] = [];

  for (const slug of CURATED_SKILL_SLUGS) {
    const skillDir = resolve(params.targetDir, slug);
    if (existsSync(resolve(skillDir, "SKILL.md"))) {
      toSkip.push(slug);
      continue;
    }
    toInstall.push(slug);
  }

  return { toInstall, toSkip };
}

/**
 * Ensure the SKILL.md `name:` field matches the directory slug.
 *
 * OpenClaw's skill filter compares `entry.skill.name` (from SKILL.md
 * frontmatter) against the agent's allowlist, which uses directory slugs.
 * ClawHub packages sometimes ship mismatched names (e.g. `find-skills`
 * instead of `find-skill`). This patches the `name:` line in-place after
 * install so filtering works correctly.
 *
 * Best-effort: silently skips on any error.
 */
export function alignSkillName(skillsDir: string, slug: string): void {
  const skillMdPath = resolve(skillsDir, slug, "SKILL.md");
  if (!existsSync(skillMdPath)) return;

  try {
    const content = readFileSync(skillMdPath, "utf8").replace(/\r\n/g, "\n");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return;

    const frontmatter = frontmatterMatch[1] ?? "";
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    if (!nameMatch) return;

    const currentName = (nameMatch[1] ?? "").trim();
    if (currentName === slug) return;

    const patched = content.replace(`name: ${nameMatch[1]}`, `name: ${slug}`);
    writeFileSync(skillMdPath, patched, "utf8");
  } catch {
    // best-effort
  }
}

/**
 * Remove `requires.bins` / `requires.anyBins` from a skill's SKILL.md
 * frontmatter so OpenClaw's eligibility filter does not drop it when
 * the required binary is missing from the system.
 *
 * The agent will still see the skill, attempt to run it, and guide the
 * user to install the missing dependency based on the skill's body
 * instructions.
 *
 * Handles both JSON-in-YAML and standard YAML metadata formats.
 * Best-effort: silently skips on any error.
 */
export function stripRequiresBins(skillsDir: string, slug: string): void {
  const skillMdPath = resolve(skillsDir, slug, "SKILL.md");
  if (!existsSync(skillMdPath)) return;

  try {
    const content = readFileSync(skillMdPath, "utf8").replace(/\r\n/g, "\n");
    if (!content.includes("requires")) return;

    // JSON-in-YAML: "requires": { "bins": [...] }, or "requires": { "anyBins": [...] },
    // Remove the entire "requires": { ... }, block (with optional trailing comma)
    let patched = content.replace(/\s*"requires"\s*:\s*\{[^}]*\}\s*,?/g, "");

    // Standard YAML: requires:\n  bins:\n    - x\n    - y
    // Remove the requires block and all its indented children
    patched = patched.replace(/^[ \t]*requires:\s*\n(?:[ \t]+.*\n)*/gm, "");

    if (patched !== content) {
      writeFileSync(skillMdPath, patched, "utf8");
    }
  } catch {
    // best-effort
  }
}
