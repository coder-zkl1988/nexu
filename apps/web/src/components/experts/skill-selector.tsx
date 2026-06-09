import { Check, Loader2, Lock, Search, Zap } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 50;

export function SkillList({
  skills,
  displaySkills,
  selectedSkillsSet,
  installedSlugs,
  lockedSkills,
  onToggleSkill,
  emptyLabel,
  noResultsLabel,
}: {
  skills: Array<{
    slug: string;
    name: string;
    description: string;
    tags: string[];
  }>;
  displaySkills: typeof skills;
  selectedSkillsSet: Set<string>;
  installedSlugs: Set<string>;
  lockedSkills?: Set<string>;
  onToggleSkill: (slug: string) => void;
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
          setVisibleCount((prev) =>
            Math.min(prev + PAGE_SIZE, displaySkills.length),
          );
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [displaySkills.length]);

  useEffect(() => {
    setVisibleCount(Math.min(PAGE_SIZE, displaySkills.length));
  }, [displaySkills.length]);

  const visibleSkills = displaySkills.slice(0, visibleCount);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-surface-0">
      {skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Loader2 size={20} className="animate-spin text-text-muted" />
          <span className="text-[12px] text-text-muted">{emptyLabel}</span>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visibleSkills.map((skill) => (
            <SkillCheckboxItem
              key={skill.slug}
              skill={skill}
              isSelected={selectedSkillsSet.has(skill.slug)}
              isInstalled={installedSlugs.has(skill.slug)}
              isLocked={lockedSkills?.has(skill.slug) ?? false}
              onToggle={() => onToggleSkill(skill.slug)}
            />
          ))}
          {visibleSkills.length < displaySkills.length && (
            <div ref={sentinelRef} className="h-1" />
          )}
          {displaySkills.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Search size={20} className="text-text-muted" />
              <span className="text-[12px] text-text-muted">
                {noResultsLabel}
              </span>
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
