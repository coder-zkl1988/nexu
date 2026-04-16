import { ExpertCard } from "@/components/experts/expert-card";
import {
  useExperthubCatalog,
  useRefreshExperts,
} from "@/hooks/use-experthub-catalog";
import {
  type ExpertsTab,
  type ExpertsViewState,
  parseExpertsViewState,
  serializeExpertsViewState,
} from "@/lib/experts-view-state";
import { cn } from "@/lib/utils";
import {
  Compass,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

const PAGE_SIZE = 50;

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export default function ExpertsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktopClient = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron"),
    [],
  );

  const { data, isLoading, isError } = useExperthubCatalog();
  const refreshMutation = useRefreshExperts();

  const viewState = useMemo(
    () => parseExpertsViewState(searchParams),
    [searchParams],
  );
  const { tab, tag, q } = viewState;
  const debouncedQuery = useDebounce(q, 150);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const updateViewState = useCallback(
    (patch: Partial<ExpertsViewState>) => {
      const next: ExpertsViewState = {
        tab: patch.tab ?? tab,
        tag: patch.tag === undefined ? tag : patch.tag,
        q: patch.q === undefined ? q : patch.q,
      };
      const qs = serializeExpertsViewState(next);
      setSearchParams(new URLSearchParams(qs), { replace: true });
    },
    [tab, tag, q, setSearchParams],
  );

  const allExperts = useMemo(() => data?.experts ?? [], [data?.experts]);
  const installedSlugs = useMemo(
    () => new Set(data?.installedSlugs ?? []),
    [data?.installedSlugs],
  );

  // Compute all tags (union of tags + categories for a richer filter set)
  const tagChips = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const expert of allExperts) {
      for (const tg of expert.tags ?? []) {
        counts[tg] = (counts[tg] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([t, count]) => ({ id: t, label: t, count }));
  }, [allExperts]);

  // Base list depending on tab
  const baseList = useMemo(() => {
    if (tab === "yours") {
      return allExperts.filter((e) => installedSlugs.has(e.slug));
    }
    return allExperts;
  }, [tab, allExperts, installedSlugs]);

  // Filter by tag and search
  const filteredExperts = useMemo(() => {
    let list = [...baseList];

    if (tag) {
      list = list.filter((e) => (e.tags ?? []).includes(tag));
    }

    if (debouncedQuery.trim()) {
      const query = debouncedQuery.toLowerCase();
      list = list.filter((e) =>
        [e.slug, e.name, e.description, e.category]
          .join("\n")
          .toLowerCase()
          .includes(query),
      );
    }

    return list;
  }, [baseList, tag, debouncedQuery]);

  // Reset visible count when filters change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset triggers
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedQuery, tag, tab]);

  // Intersection Observer for lazy loading
  const loadMore = useCallback(() => {
    setVisibleCount((prev) =>
      prev >= filteredExperts.length ? prev : prev + PAGE_SIZE,
    );
  }, [filteredExperts.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const visibleExperts = filteredExperts.slice(0, visibleCount);

  // Category tabs (pills) — "All" + top tags that match current base list
  const categoryPills = useMemo(() => {
    const all = {
      id: "all",
      label: t("experts.all", { defaultValue: "All" }),
      count: baseList.length,
    };
    const others = tagChips
      .filter((tc) => baseList.some((e) => (e.tags ?? []).includes(tc.id)))
      .map((tc) => ({
        id: tc.id,
        label: tc.label,
        count: baseList.filter((e) => (e.tags ?? []).includes(tc.id)).length,
      }));
    return [all, ...others];
  }, [baseList, tagChips, t]);

  const yoursCount = useMemo(
    () => allExperts.filter((e) => installedSlugs.has(e.slug)).length,
    [allExperts, installedSlugs],
  );

  function buildDetailTo(slug: string): string {
    const qs = serializeExpertsViewState(viewState);
    const suffix = qs ? `?${qs}` : "";
    return `/workspace/experts/${encodeURIComponent(slug)}${suffix}`;
  }

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-6 sm:pb-8">
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Loader2 size={24} className="animate-spin text-text-muted" />
            <p className="text-[13px] text-text-muted">
              {t("experts.loading", { defaultValue: "Loading experts..." })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isError && allExperts.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-6 sm:pb-8">
          <div className="text-center py-16">
            <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-red-500/10">
              <Sparkles size={20} className="text-red-500" />
            </div>
            <p className="text-[13px] text-text-muted mb-2">
              {t("experts.catalog_unavailable", {
                defaultValue: "Expert catalog unavailable",
              })}
            </p>
            <button
              type="button"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="text-[12px] text-accent hover:underline"
            >
              {refreshMutation.isPending
                ? t("experts.retrying", { defaultValue: "Retrying..." })
                : t("experts.try_again", { defaultValue: "Try again" })}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div
        className="max-w-4xl mx-auto px-4 sm:px-6 pb-6 sm:pb-8"
        style={{ paddingTop: isDesktopClient ? "2rem" : "0.5rem" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="heading-page">{t("experts.title")}</h1>
            <p className="heading-page-desc">{t("experts.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="text"
                value={q}
                onChange={(e) => updateViewState({ q: e.target.value })}
                placeholder={t("experts.search.placeholder")}
                className="w-48 pl-9 pr-3 py-1.5 rounded-lg border border-border bg-surface-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[var(--color-brand-primary)]/30 focus:ring-1 focus:ring-[var(--color-brand-primary)]/20 transition-colors"
              />
            </div>
            <button
              type="button"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-1 text-text-secondary text-[12px] font-medium hover:text-text-primary hover:border-border-hover transition-colors disabled:opacity-50"
            >
              {refreshMutation.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {t("experts.refresh")}
            </button>
          </div>
        </div>

        {/* Top-level tabs: Yours / Explore */}
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-2 mb-4">
          {(
            [
              {
                id: "yours" as const,
                label: t("experts.tabs.yours"),
                icon: Settings2,
              },
              {
                id: "explore" as const,
                label: t("experts.tabs.explore"),
                icon: Compass,
              },
            ] satisfies readonly {
              id: ExpertsTab;
              label: string;
              icon: typeof Compass;
            }[]
          ).map((tabDef) => {
            const active = tab === tabDef.id;
            const TabIcon = tabDef.icon;
            return (
              <button
                key={tabDef.id}
                type="button"
                onClick={() => {
                  updateViewState({
                    tab: tabDef.id,
                    tag: null,
                  });
                }}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-medium transition-all",
                  active
                    ? "bg-white text-text-primary shadow-[var(--shadow-rest)]"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                <TabIcon size={14} />
                {tabDef.label}
                {tabDef.id === "yours" && yoursCount > 0 && active && (
                  <span className="tabular-nums text-[12px] text-text-secondary">
                    {yoursCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Category pills */}
        <div className="relative mb-5">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {categoryPills.map((pill) => {
              const active =
                (tag === null && pill.id === "all") || tag === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() =>
                    updateViewState({
                      tag: pill.id === "all" ? null : pill.id,
                    })
                  }
                  className={cn(
                    "shrink-0 inline-flex items-center justify-center rounded-full h-7 px-3 text-[11px] leading-none font-medium transition-all",
                    active
                      ? "bg-[var(--color-accent)] text-white"
                      : "border border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-hover",
                  )}
                >
                  {pill.label}
                  <span
                    className={cn(
                      "ml-1 tabular-nums",
                      active ? "opacity-80" : "opacity-50",
                    )}
                  >
                    {pill.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Expert Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleExperts.map((expert) => (
            <ExpertCard
              key={expert.slug}
              expert={{
                slug: expert.slug,
                name: expert.name,
                emoji: expert.emoji,
                category: expert.category,
                description: expert.description,
                tags: expert.tags ?? [],
                version: expert.version,
                author: expert.author ?? "",
              }}
              installed={installedSlugs.has(expert.slug)}
              detailTo={buildDetailTo(expert.slug)}
            />
          ))}
        </div>

        {/* Sentinel for infinite scroll */}
        {visibleCount < filteredExperts.length && (
          <div ref={sentinelRef} className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-text-muted" />
          </div>
        )}

        {/* Empty state */}
        {filteredExperts.length === 0 && (
          <div className="text-center py-12">
            <Sparkles size={24} className="mx-auto text-text-muted mb-3" />
            <div className="text-[13px] text-text-muted">
              {tab === "yours"
                ? t("experts.empty.yours")
                : t("experts.empty.explore")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
