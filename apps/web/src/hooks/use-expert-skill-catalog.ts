import type { InstalledSkill, MinimalSkill } from "@/types/desktop";
import type { SkillReference } from "@nexu/shared";
import { useEffect, useMemo, useState } from "react";
import {
  useCommunitySkillPages,
  useCommunitySkillStatus,
} from "./use-community-catalog";

export type ExpertSkillTab = "yours" | "explore";

const EMPTY_INSTALLED_SKILLS: InstalledSkill[] = [];
const SEARCH_DEBOUNCE_MS = 150;

function normalizeOwner(ownerHandle?: string | null): string | undefined {
  const normalized = ownerHandle?.replace(/^@+/, "").trim().toLowerCase();
  return normalized || undefined;
}

export function createSkillReference(
  skill: Pick<MinimalSkill, "slug" | "ownerHandle" | "version">,
): SkillReference {
  const ownerHandle = normalizeOwner(skill.ownerHandle);
  return {
    slug: skill.slug,
    ...(ownerHandle ? { ownerHandle } : {}),
    ...(skill.version ? { version: skill.version } : {}),
  };
}

export function createInstalledSkillReference(
  skill: Pick<InstalledSkill, "slug" | "ownerHandle" | "version">,
): SkillReference {
  const ownerHandle = normalizeOwner(skill.ownerHandle);
  return {
    slug: skill.slug,
    ...(ownerHandle ? { ownerHandle } : {}),
    ...(skill.version ? { version: skill.version } : {}),
  };
}

export function getSkillReferenceKey(reference: SkillReference): string {
  const ownerHandle = normalizeOwner(reference.ownerHandle);
  return ownerHandle ? `@${ownerHandle}/${reference.slug}` : reference.slug;
}

export function skillReferenceMatchesSkill(
  reference: SkillReference,
  skill: Pick<MinimalSkill, "slug" | "ownerHandle">,
): boolean {
  if (reference.slug !== skill.slug) return false;
  const referenceOwner = normalizeOwner(reference.ownerHandle);
  return (
    !referenceOwner || referenceOwner === normalizeOwner(skill.ownerHandle)
  );
}

export function installedSkillMatchesCatalogSkill(
  installedSkill: Pick<InstalledSkill, "slug" | "ownerHandle">,
  skill: Pick<MinimalSkill, "slug" | "ownerHandle">,
): boolean {
  if (installedSkill.slug !== skill.slug) return false;
  const skillOwner = normalizeOwner(skill.ownerHandle);
  return (
    !skillOwner || skillOwner === normalizeOwner(installedSkill.ownerHandle)
  );
}

export function installedSkillMatchesReference(
  installedSkill: Pick<InstalledSkill, "slug" | "ownerHandle">,
  reference: SkillReference,
): boolean {
  if (installedSkill.slug !== reference.slug) return false;
  const referenceOwner = normalizeOwner(reference.ownerHandle);
  return (
    !referenceOwner ||
    referenceOwner === normalizeOwner(installedSkill.ownerHandle)
  );
}

export function includeRequiredSkillReferences(
  requiredSlugs: readonly string[],
  configuredReferences: readonly SkillReference[],
): SkillReference[] {
  const configuredBySlug = new Map(
    configuredReferences.map((reference) => [reference.slug, reference]),
  );
  return [
    ...requiredSlugs.map((slug) => configuredBySlug.get(slug) ?? { slug }),
    ...configuredReferences.filter(
      (reference) => !requiredSlugs.includes(reference.slug),
    ),
  ];
}

export function dedupeSkillsBySlug(skills: MinimalSkill[]): MinimalSkill[] {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    if (seen.has(skill.slug)) return false;
    seen.add(skill.slug);
    return true;
  });
}

export function createInstalledSkillOptions(
  installedSkills: InstalledSkill[],
): MinimalSkill[] {
  return dedupeSkillsBySlug(
    installedSkills.map((skill) => ({
      ...(skill.ownerHandle ? { ownerHandle: skill.ownerHandle } : {}),
      slug: skill.slug,
      name: skill.name || skill.slug,
      description: skill.description || "",
      downloads: 0,
      stars: 0,
      tags: [],
      version: skill.version ?? "",
      updatedAt: skill.installedAt ?? "",
    })),
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}

export function useExpertSkillCatalog(options: {
  tab: ExpertSkillTab;
  search: string;
  category: string | null;
}) {
  const debouncedSearch = useDebouncedValue(
    options.search.trim(),
    SEARCH_DEBOUNCE_MS,
  );
  const catalogQuery = useCommunitySkillPages({
    query: options.tab === "explore" ? debouncedSearch : undefined,
    category: options.tab === "explore" ? options.category : null,
    enabled: options.tab === "explore",
  });
  const statusQuery = useCommunitySkillStatus();
  const installedSkills =
    statusQuery.data?.installedSkills ?? EMPTY_INSTALLED_SKILLS;
  const installedSlugs = useMemo(
    () => new Set(statusQuery.data?.installedSlugs ?? []),
    [statusQuery.data?.installedSlugs],
  );
  const catalogPages = catalogQuery.data?.pages;
  const catalogSkills = useMemo(
    () =>
      dedupeSkillsBySlug(catalogPages?.flatMap((page) => page.skills) ?? []),
    [catalogPages],
  );
  const exploreSkills = useMemo(
    () => catalogSkills.filter((skill) => !installedSlugs.has(skill.slug)),
    [catalogSkills, installedSlugs],
  );
  const yoursSkills = useMemo(
    () => createInstalledSkillOptions(installedSkills),
    [installedSkills],
  );
  const filteredYoursSkills = useMemo(() => {
    if (!debouncedSearch) return yoursSkills;
    const normalizedSearch = debouncedSearch.toLowerCase();
    return yoursSkills.filter((skill) =>
      [skill.slug, skill.name, skill.description]
        .join("\n")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [debouncedSearch, yoursSkills]);
  const displaySkills =
    options.tab === "explore" ? exploreSkills : filteredYoursSkills;
  const allSkills = useMemo(
    () => dedupeSkillsBySlug([...catalogSkills, ...yoursSkills]),
    [catalogSkills, yoursSkills],
  );

  return {
    allSkills,
    displaySkills,
    installedSkills,
    installedSlugs,
    topTags: catalogPages?.[0]?.facets.slice(0, 12) ?? [],
    isLoading:
      statusQuery.isLoading ||
      (options.tab === "explore" && catalogQuery.isLoading),
    isError:
      statusQuery.isError ||
      (options.tab === "explore" && catalogQuery.isError),
    hasNextPage: options.tab === "explore" && Boolean(catalogQuery.hasNextPage),
    isFetchingNextPage:
      options.tab === "explore" && catalogQuery.isFetchingNextPage,
    fetchNextPage: catalogQuery.fetchNextPage,
  };
}
