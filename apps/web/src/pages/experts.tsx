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
  Search,
  Settings2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";

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
  const _isDesktopClient = useMemo(
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
  const hasExplicitTab = searchParams.has("tab");

  const [inputValue, setInputValue] = useState(q);
  const debouncedInput = useDebounce(inputValue, 150);

  useEffect(() => {
    if (debouncedInput !== q) {
      const next: ExpertsViewState = { tab, tag, q: debouncedInput };
      const qs = serializeExpertsViewState(next);
      setSearchParams(new URLSearchParams(qs), { replace: true });
    }
  }, [debouncedInput, q, tab, tag, setSearchParams]);

  const debouncedQuery = useDebounce(q, 150);

  // Resolve the effective tab during render so the correct content is painted in
  // a single commit. Without this, the "explore" grid renders first (because the
  // URL has no explicit tab) and then an effect switches to "yours" — causing a
  // visible flash even with useLayoutEffect.
  const effectiveTab: ExpertsTab = useMemo(() => {
    if (hasExplicitTab) return tab;
    if (data && (data.installedSlugs?.length ?? 0) > 0) return "yours";
    return tab;
  }, [tab, data, hasExplicitTab]);

  // Sync the URL when auto-defaulting to "yours" (one-shot, render-time decision
  // already applied via effectiveTab — this just makes the URL bookmarkable).
  const prevDataRef = useRef(false);
  useEffect(() => {
    if (
      !hasExplicitTab &&
      data &&
      (data.installedSlugs?.length ?? 0) > 0 &&
      !prevDataRef.current
    ) {
      prevDataRef.current = true;
      updateViewState({ tab: "yours" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hasExplicitTab]);

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

  const allExperts = useMemo(() => {
    const catalogExperts = data?.experts ?? [];
    const ledgerEntries = data?.installedExperts ?? [];
    const catalogSlugs = new Set(catalogExperts.map((e) => e.slug));

    const customExperts = ledgerEntries
      .filter((entry) => !catalogSlugs.has(entry.slug))
      .map(
        (entry: {
          slug: string;
          version: string;
          name?: string;
          avatarDataUrl?: string;
          description?: string;
        }) => ({
          slug: entry.slug,
          name: entry.name || "自定义专家",
          emoji: entry.avatarDataUrl ? (undefined as unknown as string) : "🤖",
          avatarDataUrl: entry.avatarDataUrl,
          category: "自定义",
          description: entry.description || "",
          tags: [] as string[],
          version: entry.version,
          author: "",
        }),
      );

    return [...catalogExperts, ...customExperts];
  }, [data?.experts, data?.installedExperts]);

  const customSlugs = useMemo(
    () =>
      new Set(
        (data?.installedExperts ?? [])
          .filter((e) => !(data?.experts ?? []).some((c) => c.slug === e.slug))
          .map((e) => e.slug),
      ),
    [data?.experts, data?.installedExperts],
  );
  const installedSlugs = useMemo(
    () => new Set(data?.installedSlugs ?? []),
    [data?.installedSlugs],
  );

  // Compute department category chips
  const tagChips = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const expert of allExperts) {
      const cat = expert.category;
      if (cat) counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, count]) => ({ id: t, label: t, count }));
  }, [allExperts]);

  // Base list depending on tab
  const baseList = useMemo(() => {
    if (effectiveTab === "yours") {
      return allExperts.filter((e) => installedSlugs.has(e.slug));
    }
    return allExperts.filter((e) => !customSlugs.has(e.slug));
  }, [effectiveTab, allExperts, installedSlugs, customSlugs]);

  // Filter by tag and search
  const filteredExperts = useMemo(() => {
    let list = [...baseList];

    if (tag) {
      list = list.filter((e) => e.category === tag);
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
  }, [debouncedQuery, tag, effectiveTab]);

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

  // Category tabs (pills) — "All" + department categories
  const categoryPills = useMemo(() => {
    const all = {
      id: "all",
      label: t("experts.all", { defaultValue: "All" }),
      count: baseList.length,
    };
    const others = tagChips
      .filter((tc) => baseList.some((e) => e.category === tc.id))
      .map((tc) => ({
        id: tc.id,
        label: tc.label,
        count: baseList.filter((e) => e.category === tc.id).length,
      }));
    return [all, ...others];
  }, [baseList, tagChips, t]);

  const yoursCount = useMemo(
    () => allExperts.filter((e) => installedSlugs.has(e.slug)).length,
    [allExperts, installedSlugs],
  );

  function buildDetailTo(slug: string): string {
    if (customSlugs.has(slug)) {
      return `/workspace/experts/custom?slug=${encodeURIComponent(slug)}`;
    }
    const qs = serializeExpertsViewState(viewState);
    const suffix = qs ? `?${qs}` : "";
    return `/workspace/experts/${encodeURIComponent(slug)}${suffix}`;
  }

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto px-6 py-6">
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <Loader2 size={24} className="animate-spin text-text-muted" />
          <p className="text-[13px] text-text-muted">
            {t("experts.loading", { defaultValue: "Loading experts..." })}
          </p>
        </div>
      </div>
    );
  }

  if (isError && allExperts.length === 0) {
    return (
      <div className="h-full overflow-y-auto px-6 py-6">
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
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Fixed header area */}
      <div className="shrink-0 px-6 pt-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-tabby-foreground)]">
              {t("experts.title")}
            </h1>
            <p className="text-xs text-[var(--color-tabby-muted)] mt-0.5">
              {t("experts.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={t("experts.search.placeholder")}
                className="w-48 pl-9 pr-3 py-1.5 rounded-lg border border-border bg-surface-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[var(--color-brand-primary)]/30 focus:ring-1 focus:ring-[var(--color-brand-primary)]/20 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Top-level tabs: Yours / Explore + Custom button */}
        <div className="flex items-center gap-3 mb-4">
          <div className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-2">
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
              const active = effectiveTab === tabDef.id;
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
          <Link
            to="/workspace/experts/custom"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FF5A3C] text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            <Wand2 size={14} />
            {t("experts.custom_create")}
          </Link>
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
      </div>

      {/* Scrollable grid area */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Expert Grid */}
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(192px,1fr))]">
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
                avatarDataUrl: (expert as { avatarDataUrl?: string })
                  .avatarDataUrl,
              }}
              installed={installedSlugs.has(expert.slug)}
              detailTo={buildDetailTo(expert.slug)}
              isCustom={customSlugs.has(expert.slug)}
              customAvatarUrl={
                customSlugs.has(expert.slug)
                  ? (expert as { avatarDataUrl?: string }).avatarDataUrl
                  : undefined
              }
              customEditTo={
                customSlugs.has(expert.slug)
                  ? `/workspace/experts/custom?slug=${encodeURIComponent(expert.slug)}`
                  : undefined
              }
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
              {effectiveTab === "yours"
                ? t("experts.empty.yours")
                : t("experts.empty.explore")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
