import { describe, expect, it } from "vitest";
import {
  createInstalledSkillOptions,
  createSkillReference,
  dedupeSkillsBySlug,
  includeRequiredSkillReferences,
  skillReferenceMatchesSkill,
} from "../src/hooks/use-expert-skill-catalog";
import type { InstalledSkill, MinimalSkill } from "../src/types/desktop";

function catalogSkill(ownerHandle: string, slug: string): MinimalSkill {
  return {
    ownerHandle,
    slug,
    name: `${ownerHandle}/${slug}`,
    description: "",
    downloads: 0,
    stars: 0,
    tags: [],
    version: "1.0.0",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
}

describe("expert skill catalog", () => {
  it("keeps the first server-ranked publisher for duplicate physical slugs", () => {
    const skills = dedupeSkillsBySlug([
      catalogSkill("trusted", "weather"),
      catalogSkill("copy", "weather"),
      catalogSkill("trusted", "calendar"),
    ]);

    expect(skills.map((skill) => `${skill.ownerHandle}/${skill.slug}`)).toEqual(
      ["trusted/weather", "trusted/calendar"],
    );
  });

  it("keeps the selected server-ranked publisher and version", () => {
    const selected = createSkillReference(
      catalogSkill("category-winner", "weather"),
    );

    expect(selected).toEqual({
      slug: "weather",
      ownerHandle: "category-winner",
      version: "1.0.0",
    });
    expect(
      skillReferenceMatchesSkill(
        selected,
        catalogSkill("global-winner", "weather"),
      ),
    ).toBe(false);
    expect(
      skillReferenceMatchesSkill(
        selected,
        catalogSkill("category-winner", "weather"),
      ),
    ).toBe(true);
  });

  it("builds one local Yours option per installed slug", () => {
    const installed: InstalledSkill[] = [
      {
        slug: "weather",
        ownerHandle: "trusted",
        version: "1.0.0",
        source: "managed",
        name: "Weather",
        description: "Shared weather skill",
        installedAt: "2026-07-30T00:00:00.000Z",
        agentId: null,
        agentName: null,
      },
      {
        slug: "weather",
        ownerHandle: "trusted",
        version: "1.0.0",
        source: "workspace",
        name: "Weather copy",
        description: "Workspace copy",
        installedAt: "2026-07-30T00:00:00.000Z",
        agentId: "agent-1",
        agentName: "Researcher",
      },
    ];

    expect(createInstalledSkillOptions(installed)).toEqual([
      expect.objectContaining({
        slug: "weather",
        ownerHandle: "trusted",
        name: "Weather",
      }),
    ]);
  });

  it("preserves an exact configured reference for a required skill", () => {
    expect(
      includeRequiredSkillReferences(
        ["weather", "calendar"],
        [
          {
            slug: "weather",
            ownerHandle: "trusted",
            version: "2.0.0",
          },
          { slug: "notes", ownerHandle: "trusted" },
        ],
      ),
    ).toEqual([
      {
        slug: "weather",
        ownerHandle: "trusted",
        version: "2.0.0",
      },
      { slug: "calendar" },
      { slug: "notes", ownerHandle: "trusted" },
    ]);
  });
});
