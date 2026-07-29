import {
  createSkillReference,
  getSkillReferenceKey,
  installedSkillMatchesCatalogSkill,
  skillReferenceMatchesSkill,
} from "@/hooks/use-expert-skill-catalog";
import type { InstalledSkill, MinimalSkill } from "@/types/desktop";
import type { SkillReference } from "@nexu/shared";
import { Check, Loader2, Lock, Search, Zap } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 50;

export function SkillList({
  displaySkills,
  selectedSkillRefs,
  installedSkills,
  lockedSkills,
  onToggleSkill,
  isLoading = false,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  emptyLabel,
  noResultsLabel,
}: {
  displaySkills: MinimalSkill[];
  selectedSkillRefs: SkillReference[];
  installedSkills: InstalledSkill[];
  lockedSkills?: Set<string>;
  onToggleSkill: (skill: MinimalSkill) => void;
  isLoading?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  emptyLabel: string;
  noResultsLabel: string;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (visibleCount < displaySkills.length) {
            setVisibleCount((prev) =>
              Math.min(prev + PAGE_SIZE, displaySkills.length),
            );
            return;
          }
          if (hasNextPage && !isFetchingNextPage) {
            onLoadMore?.();
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    displaySkills.length,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
    visibleCount,
  ]);

  useEffect(() => {
    setVisibleCount((previous) =>
      Math.max(
        Math.min(previous, displaySkills.length),
        Math.min(PAGE_SIZE, displaySkills.length),
      ),
    );
  }, [displaySkills.length]);

  const visibleSkills = displaySkills.slice(0, visibleCount);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-surface-0">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Loader2 size={20} className="animate-spin text-text-muted" />
          <span className="text-[12px] text-text-muted">{emptyLabel}</span>
        </div>
      ) : displaySkills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Search size={20} className="text-text-muted" />
          <span className="text-[12px] text-text-muted">{noResultsLabel}</span>
          {hasNextPage && (
            <div
              ref={sentinelRef}
              className="flex h-8 items-center justify-center"
            >
              {isFetchingNextPage && (
                <Loader2 size={16} className="animate-spin text-text-muted" />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visibleSkills.map((skill) => (
            <SkillCheckboxItem
              key={getSkillReferenceKey(createSkillReference(skill))}
              skill={skill}
              isSelected={selectedSkillRefs.some((reference) =>
                skillReferenceMatchesSkill(reference, skill),
              )}
              isInstalled={installedSkills.some((installedSkill) =>
                installedSkillMatchesCatalogSkill(installedSkill, skill),
              )}
              isLocked={lockedSkills?.has(skill.slug) ?? false}
              onToggle={() => onToggleSkill(skill)}
            />
          ))}
          {(visibleSkills.length < displaySkills.length || hasNextPage) && (
            <div
              ref={sentinelRef}
              className="flex h-8 items-center justify-center"
            >
              {isFetchingNextPage && (
                <Loader2 size={16} className="animate-spin text-text-muted" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const SkillCheckboxItem = memo(function SkillCheckboxItem({
  skill,
  isSelected,
  isInstalled,
  isLocked,
  onToggle,
}: {
  skill: {
    slug: string;
    name: string;
    description: string;
    tags: string[];
  };
  isSelected: boolean;
  isInstalled: boolean;
  isLocked?: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-1 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={isSelected}
        disabled={isLocked}
        onChange={onToggle}
        className="h-3.5 w-3.5 rounded border-border text-[#FF5A3C] focus:ring-[#FF5A3C]/30 shrink-0 disabled:opacity-50"
      />
      <div className="w-8 h-8 rounded-[8px] bg-white border border-border flex items-center justify-center shrink-0">
        <Zap size={14} className="text-text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-text-primary truncate">
            {skill.name}
          </span>
          {isInstalled && (
            <span className="shrink-0 text-[10px] font-medium text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1.5 py-0.5 rounded">
              {t("skills.sourceInstalled")}
            </span>
          )}
          {isLocked && <Lock size={10} className="text-text-muted shrink-0" />}
        </div>
        {skill.description && (
          <p className="text-[11px] text-text-muted truncate mt-0.5">
            {skill.description}
          </p>
        )}
      </div>
      {isSelected && !isLocked && (
        <Check size={14} className="text-[#FF5A3C] shrink-0" />
      )}
    </label>
  );
});
