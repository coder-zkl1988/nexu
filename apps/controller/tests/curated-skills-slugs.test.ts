import { describe, expect, it } from "vitest";
import {
  CURATED_SKILLS,
  CURATED_SKILL_SLUGS,
  STATIC_SKILL_SLUGS,
} from "../src/services/skillhub/curated-skills.js";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;
const OWNER_HANDLE_REGEX = /^[a-z0-9][a-z0-9._-]{0,127}$/;

describe("curated skill slugs", () => {
  it("all curated slugs pass validation regex", () => {
    for (const slug of CURATED_SKILL_SLUGS) {
      expect(slug, `slug "${slug}" failed validation`).toMatch(SLUG_REGEX);
    }
  });

  it("all static slugs pass validation regex", () => {
    for (const slug of STATIC_SKILL_SLUGS) {
      expect(slug, `slug "${slug}" failed validation`).toMatch(SLUG_REGEX);
    }
  });

  it("no duplicate curated slugs", () => {
    const unique = new Set(CURATED_SKILL_SLUGS);
    expect(unique.size).toBe(CURATED_SKILL_SLUGS.length);
  });

  it("pins one valid publisher identity for every curated slug", () => {
    expect(CURATED_SKILLS.map(({ slug }) => slug)).toEqual(CURATED_SKILL_SLUGS);
    for (const skill of CURATED_SKILLS) {
      expect(skill.ownerHandle).toMatch(OWNER_HANDLE_REGEX);
    }
    expect(CURATED_SKILLS).toEqual([
      { slug: "1password", ownerHandle: "steipete" },
      { slug: "healthcheck", ownerHandle: "stellarhold170nt" },
      { slug: "skill-vetter", ownerHandle: "spclaudehome" },
      { slug: "github", ownerHandle: "steipete" },
      { slug: "multi-search-engine", ownerHandle: "gpyangyoujun" },
      { slug: "weather", ownerHandle: "steipete" },
      { slug: "imap-smtp-email", ownerHandle: "gzlicanyi" },
      { slug: "calendar", ownerHandle: "ndcccccc" },
      { slug: "apple-notes", ownerHandle: "steipete" },
      { slug: "file-organizer-skill", ownerHandle: "1999azzar" },
      { slug: "video-frames", ownerHandle: "steipete" },
      { slug: "session-logs", ownerHandle: "guogang1024" },
      { slug: "skill-creator", ownerHandle: "chindden" },
      { slug: "find-skill", ownerHandle: "breckengan" },
      { slug: "wechat-article-search", ownerHandle: "wuchubuzai2018" },
      { slug: "liblib-ai-gen", ownerHandle: "xtaq" },
      { slug: "listenhub-ai", ownerHandle: "kkaticld" },
    ]);
    expect(CURATED_SKILL_SLUGS).not.toContain("xiaohongshu-mcp");
  });

  it("no overlap between curated and static slugs", () => {
    const curated = new Set(CURATED_SKILL_SLUGS);
    for (const slug of STATIC_SKILL_SLUGS) {
      expect(curated.has(slug), `"${slug}" is in both curated and static`).toBe(
        false,
      );
    }
  });

  it("includes bundled KOL skills in static", () => {
    const bundledKolSlugs = [
      "deep-research",
      "research-to-diagram",
      "qiaomu-mondo-poster-design",
    ];
    for (const slug of bundledKolSlugs) {
      expect(
        STATIC_SKILL_SLUGS,
        `"${slug}" missing from static slugs`,
      ).toContain(slug);
    }
  });

  it("no duplicate static slugs", () => {
    const unique = new Set(STATIC_SKILL_SLUGS);
    expect(unique.size).toBe(STATIC_SKILL_SLUGS.length);
  });
});
