import ImportSkillModal from "@/components/skills/import-skill-modal";
import {
  useCancelInstall,
  useCommunitySkillPages,
  useCommunitySkillStatus,
  useInstallSkill,
  useRefreshCatalog,
  useUninstallSkill,
} from "@/hooks/use-community-catalog";
import { useLocale } from "@/hooks/use-locale";
import { getTagLabel } from "@/lib/skill-translations";
import {
  type SkillCatalogSort,
  type SkillSelection,
  type TopTab,
  type YoursSubTab,
  applySkillsViewStatePatch,
  createSkillDetailPath,
  createSkillDetailState,
  getCatalogSkillIdentityConflict,
  getCatalogSkillInstallation,
  getInstalledSkillRenderKey,
  getSkillIdentity,
  getUnavailableSkillDetailSlugs,
  parseSkillsViewState,
} from "@/lib/skills-view-state";
import { mapInstalledSkillSource, track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import type {
  InstalledSkill,
  MinimalSkill,
  QueueErrorCode,
  QueueItem,
  SkillSource,
} from "@/types/desktop";
import { isSkillUpdateAvailable } from "@nexu/shared";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Star,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const PAGE_SIZE = 50;
type UninstallableSkillSource = Exclude<SkillSource, "curated">;

function toUninstallSource(
  source: SkillSource | null | undefined,
): UninstallableSkillSource | undefined {
  return source && source !== "curated" ? source : undefined;
}

function toSkillSelection(skill: InstalledSkill): SkillSelection {
  return {
    source: toUninstallSource(skill.source),
    agentId: skill.agentId,
    ownerHandle: skill.ownerHandle,
    version: skill.version,
  };
}

function getSkillType(tags: readonly string[]): string | null {
  const primaryTag = tags[0]?.trim();
  if (!primaryTag) {
    return null;
  }
  return primaryTag.toLowerCase();
}

function formatMetric(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.max(0, value));
}

function formatCatalogAge(
  updatedAt: string,
  t: TFunction,
  now = Date.now(),
): string {
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) return updatedAt;

  const elapsedHours = Math.floor(Math.max(0, now - updatedAtMs) / 3_600_000);
  if (elapsedHours < 1) return t("skills.justNow");
  if (elapsedHours < 24) {
    return t("skills.hoursAgo", { count: elapsedHours });
  }
  return t("skills.daysAgo", { count: Math.floor(elapsedHours / 24) });
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function SkillCard({
  skill,
  isInstalled,
  queueStatus,
  queueErrorCode,
  queueErrorMessage,
  categoryLabel,
  locale,
  skillSource,
  detailTo,
  isDetailAvailable,
  installation,
  hasIdentityConflict,
}: {
  skill: MinimalSkill;
  isInstalled: boolean;
  queueStatus?:
    | "queued"
    | "downloading"
    | "installing-deps"
    | "done"
    | "failed"
    | null;
  queueErrorCode?: QueueErrorCode | null;
  queueErrorMessage?: string | null;
  categoryLabel?: string;
  locale: string;
  skillSource: "builtin" | "explore" | "custom";
  detailTo: string;
  isDetailAvailable: boolean;
  installation?: SkillSelection;
  hasIdentityConflict?: boolean;
}) {
  const { t } = useTranslation();
  const installMutation = useInstallSkill();
  const uninstallMutation = useUninstallSkill();
  const cancelMutation = useCancelInstall();
  const [pendingAction, setPendingAction] = useState<
    "install" | "update" | "uninstall" | "cancel" | null
  >(null);

  const isQueueActive =
    queueStatus === "queued" ||
    queueStatus === "downloading" ||
    queueStatus === "installing-deps";
  const isFailed = queueStatus === "failed";
  const updateAvailable =
    isInstalled &&
    installation?.source === "managed" &&
    Boolean(skill.ownerHandle) &&
    Boolean(installation.ownerHandle) &&
    getSkillIdentity(skill) ===
      getSkillIdentity({
        slug: skill.slug,
        ownerHandle: installation.ownerHandle,
      }) &&
    isSkillUpdateAvailable(skill.version, installation?.version);
  // Retry is suppressed for terminal errors that the user must resolve
  // outside the app (skill removed, or npm not installed).
  const canRetry =
    isFailed &&
    (!isInstalled || updateAvailable) &&
    queueErrorCode !== "skill_not_found" &&
    queueErrorCode !== "npm_missing";
  const failedMessage = isFailed
    ? queueErrorCode === "skill_not_found"
      ? t("skills.skillNotAvailable")
      : queueErrorCode === "rate_limit"
        ? t("skills.installRateLimited")
        : queueErrorCode === "npm_missing"
          ? t("skills.installNpmMissing")
          : queueErrorCode === "deps_install_failed"
            ? t("skills.installDepsFailed", { slug: skill.slug })
            : t("skills.installFailedGeneric")
    : null;
  const isMutating = pendingAction !== null;

  async function handleInstall(update = false) {
    setPendingAction(update ? "update" : "install");
    const skillType = getSkillType(skill.tags);
    try {
      await installMutation.mutateAsync({
        slug: skill.slug,
        ...(skill.ownerHandle ? { ownerHandle: skill.ownerHandle } : {}),
        ...(skill.version ? { version: skill.version } : {}),
        ...(update ? { update: true } : {}),
      });
      track("workspace_skill_install", {
        skill_name: skill.name,
        skill_type: skillType,
        skill_source: skillSource,
        success: true,
      });
      track("workspace_skill_enable", {
        name: skill.name,
        skill_source: skillSource,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(
        t(
          update ? "skills.updateRequestFailed" : "skills.installRequestFailed",
          {
            error: message,
          },
        ),
      );
      track("workspace_skill_install", {
        skill_name: skill.name,
        skill_type: skillType,
        skill_source: skillSource,
        success: false,
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCancel() {
    setPendingAction("cancel");
    try {
      await cancelMutation.mutateAsync(skill.slug);
    } catch (err) {
      // Surface the rejection so the click flow doesn't end in an unhandled
      // promise (noisy in error telemetry) and the user gets a real signal
      // when cancel itself fails — common in flaky/offline networks.
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("skills.cancelFailed", { error: message }));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUninstall() {
    setPendingAction("uninstall");
    try {
      await uninstallMutation.mutateAsync({
        slug: skill.slug,
        ...(toUninstallSource(installation?.source)
          ? { source: toUninstallSource(installation?.source) }
          : {}),
        ...(installation?.agentId ? { agentId: installation.agentId } : {}),
      });
      track("workspace_skill_uninstall", {
        skill_name: skill.name,
        skill_source: skillSource,
        success: true,
      });
      track("workspace_skill_disable", {
        name: skill.name,
        skill_source: skillSource,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("skills.uninstallRequestFailed", { error: message }));
      track("workspace_skill_uninstall", {
        skill_name: skill.name,
        skill_source: skillSource,
        success: false,
      });
    } finally {
      setPendingAction(null);
    }
  }

  const cardContent = (
    <>
      {/* Header: Icon + Name + Category */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-[10px] bg-white border border-border flex items-center justify-center shrink-0">
          <Zap size={18} className="text-text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text-heading truncate">
            {skill.name}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
            {skill.ownerHandle && (
              <span className="truncate">@{skill.ownerHandle}</span>
            )}
            {skill.ownerHandle && skill.version && (
              <span className="h-2.5 w-px shrink-0 bg-border" />
            )}
            {skill.version && (
              <span className="shrink-0">v{skill.version}</span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="min-h-9 text-[12px] text-text-tertiary leading-[1.5] line-clamp-2 mb-3">
        {skill.description}
      </p>

      <div className="mb-3 flex min-h-4 items-center justify-between gap-3 text-[11px] text-text-muted">
        <span
          className={cn("truncate", updateAvailable && "text-accent")}
          title={
            updateAvailable
              ? t("skills.updateAvailable", {
                  current: installation?.version,
                  latest: skill.version,
                })
              : undefined
          }
        >
          {updateAvailable
            ? t("skills.updateAvailable", {
                current: installation?.version,
                latest: skill.version,
              })
            : categoryLabel}
        </span>
        <div className="flex shrink-0 items-center gap-3 tabular-nums">
          {skill.downloads > 0 && (
            <span className="inline-flex items-center gap-1">
              <Download size={11} aria-hidden="true" />
              {formatMetric(skill.downloads, locale)}
            </span>
          )}
          {skill.stars > 0 && (
            <span className="inline-flex items-center gap-1">
              <Star size={11} aria-hidden="true" />
              {formatMetric(skill.stars, locale)}
            </span>
          )}
        </div>
      </div>

      {/* Failure notice — visible only when the queue reports a terminal failure. */}
      {isFailed && failedMessage && (
        <div className="mb-3 flex items-start gap-1.5 rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-2 py-1.5 text-[11px] leading-[1.4] text-[var(--color-danger)]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {failedMessage}
            {/* Surface the raw underlying error for unclassified failures so users
                aren't left guessing what went wrong (network, permissions, etc.). */}
            {queueErrorCode === "unknown" && queueErrorMessage && (
              <span className="mt-0.5 block break-words font-mono text-[10px] opacity-75">
                {queueErrorMessage}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Footer */}
      <div
        className="mt-auto flex items-center justify-between"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <span />
        {isQueueActive ||
        (isMutating &&
          (pendingAction === "install" || pendingAction === "update")) ? (
          <span className="inline-flex items-center gap-1.5 rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-border text-text-muted cursor-default">
            <Loader2 size={12} className="animate-spin" />
            {updateAvailable
              ? t("skills.updatingAction")
              : t("skills.installingAction")}
          </span>
        ) : isFailed ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCancel();
              }}
              disabled={isMutating}
              className="text-[12px] font-medium text-text-muted hover:text-text-primary transition-colors"
            >
              {pendingAction === "cancel"
                ? t("skills.cancelling")
                : t("skills.cancelInstall")}
            </button>
            {canRetry && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleInstall(updateAvailable);
                }}
                disabled={isMutating}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/5 transition-colors"
              >
                <RotateCcw size={12} />
                {t("skills.retryInstall")}
              </button>
            )}
          </div>
        ) : hasIdentityConflict ? (
          <span className="rounded-[8px] border border-border px-[14px] py-[5px] text-[12px] font-medium text-text-muted">
            {t("skills.publisherConflict")}
          </span>
        ) : isInstalled ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUninstall();
              }}
              disabled={isMutating}
              className="text-[12px] font-medium text-text-muted hover:text-[var(--color-danger)] transition-colors"
            >
              {pendingAction === "uninstall"
                ? t("skills.uninstallingAction")
                : t("skills.uninstallAction")}
            </button>
            {updateAvailable && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleInstall(true);
                }}
                disabled={isMutating}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-accent/40 px-[14px] py-[5px] text-[12px] font-medium text-accent transition-colors hover:bg-accent/5"
              >
                <RefreshCw size={12} />
                {t("skills.updateAction")}
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleInstall();
            }}
            disabled={isMutating}
            className="rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-border text-text-primary hover:bg-surface-2 hover:border-border-hover transition-colors"
          >
            {t("skills.installAction")}
          </button>
        )}
      </div>
    </>
  );

  if (!isDetailAvailable) {
    return (
      <div
        className={cn(
          "card flex flex-col p-4 cursor-default",
          isFailed &&
            "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/[0.02]",
        )}
      >
        {cardContent}
      </div>
    );
  }

  return (
    <Link
      to={detailTo}
      state={createSkillDetailState(installation)}
      draggable={false}
      className={cn(
        "card flex flex-col p-4",
        isFailed &&
          "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/[0.02]",
      )}
    >
      {cardContent}
    </Link>
  );
}

export function SkillsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktopClient = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron"),
    [],
  );
  const { locale } = useLocale();
  const refreshMutation = useRefreshCatalog();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const viewState = useMemo(
    () => parseSkillsViewState(searchParams),
    [searchParams],
  );
  const { topTab, yoursSubTab, activeTag, searchQuery, sort } = viewState;

  const [inputValue, setInputValue] = useState(searchQuery);
  const debouncedInput = useDebounce(inputValue, 150);

  useEffect(() => {
    if (debouncedInput !== searchQuery) {
      setSearchParams(
        (current) =>
          applySkillsViewStatePatch(current, { searchQuery: debouncedInput }),
        { replace: true },
      );
    }
  }, [debouncedInput, searchQuery, setSearchParams]);

  // `searchQuery` is already debounced before it is written to the URL.
  const debouncedQuery = searchQuery;
  const catalogQuery = useCommunitySkillPages({
    query: topTab === "explore" ? debouncedQuery.trim() : undefined,
    category: topTab === "explore" ? activeTag : null,
    sort,
    enabled: topTab === "explore",
  });
  const statusQuery = useCommunitySkillStatus();
  const isLoading =
    statusQuery.isLoading || (topTab === "explore" && catalogQuery.isLoading);
  const isError =
    statusQuery.isError || (topTab === "explore" && catalogQuery.isError);
  const hasNextPage = topTab === "explore" && catalogQuery.hasNextPage;
  const isFetchingNextPage =
    topTab === "explore" && catalogQuery.isFetchingNextPage;
  const fetchNextPage = catalogQuery.fetchNextPage;
  const catalogPages = catalogQuery.data?.pages;
  const firstPage = catalogPages?.[0];
  const status = statusQuery.data;
  const data =
    firstPage || status
      ? {
          ...(firstPage ?? {
            skills: [],
            meta: null,
            nextCursor: null,
            total: 0,
            facets: [],
            installedSlugs: [],
            installedSkills: [],
            queue: [],
          }),
          skills:
            topTab === "explore"
              ? (catalogPages?.flatMap((page) => page.skills) ?? [])
              : [],
          installedSlugs:
            status?.installedSlugs ?? firstPage?.installedSlugs ?? [],
          installedSkills:
            status?.installedSkills ?? firstPage?.installedSkills ?? [],
          queue: status?.queue ?? firstPage?.queue ?? [],
        }
      : undefined;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const pillScrollRef = useRef<HTMLDivElement>(null);
  const [showPillFade, setShowPillFade] = useState(false);
  const [showPillFadeLeft, setShowPillFadeLeft] = useState(false);

  const checkPillOverflow = useCallback(() => {
    const el = pillScrollRef.current;
    if (!el) {
      setShowPillFade(false);
      setShowPillFadeLeft(false);
      return;
    }
    const hasOverflow = el.scrollWidth > el.clientWidth;
    setShowPillFade(
      hasOverflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    );
    setShowPillFadeLeft(hasOverflow && el.scrollLeft > 2);
  }, []);

  const scrollPillBy = useCallback((direction: "left" | "right") => {
    const el = pillScrollRef.current;
    if (!el) return;
    // Scroll roughly 80% of the visible width so the user always sees a
    // bit of the previously-visible pills as a hint of continuity.
    const delta = el.clientWidth * 0.8;
    el.scrollBy({
      left: direction === "left" ? -delta : delta,
      behavior: "smooth",
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: topTab triggers re-check on tab switch
  useEffect(() => {
    checkPillOverflow();
    window.addEventListener("resize", checkPillOverflow);
    return () => window.removeEventListener("resize", checkPillOverflow);
  }, [checkPillOverflow, topTab]);

  const updateViewState = useCallback(
    (
      patch: Partial<{
        topTab: TopTab;
        yoursSubTab: YoursSubTab;
        activeTag: string | null;
        searchQuery: string;
        sort: SkillCatalogSort;
      }>,
    ) => {
      setSearchParams((current) => applySkillsViewStatePatch(current, patch), {
        replace: true,
      });
    },
    [setSearchParams],
  );

  const allSkills = data?.skills ?? [];
  const installedSlugs = useMemo(
    () => new Set(data?.installedSlugs ?? []),
    [data?.installedSlugs],
  );
  const installedSkills: InstalledSkill[] = data?.installedSkills ?? [];
  const installedIdentities = useMemo(
    () =>
      new Set(
        installedSkills.flatMap((skill) =>
          skill.ownerHandle ? [getSkillIdentity(skill)] : [],
        ),
      ),
    [installedSkills],
  );
  const legacyInstalledSlugs = useMemo(
    () =>
      new Set(
        installedSkills
          .filter((skill) => !skill.ownerHandle)
          .map((skill) => skill.slug),
      ),
    [installedSkills],
  );

  // Queue items that should appear in the Yours tab: active installs
  // (queued/downloading/installing-deps) plus terminal failures so the user
  // has a retry surface. Installed and silently "done" items are excluded —
  // those are already represented by `installedSkills`.
  const activeQueueItems = useMemo(() => {
    const visibleStatuses = new Set([
      "queued",
      "downloading",
      "installing-deps",
      "failed",
    ]);
    return (data?.queue ?? []).filter(
      (queueItem) =>
        visibleStatuses.has(queueItem.status) &&
        (queueItem.ownerHandle
          ? !installedIdentities.has(getSkillIdentity(queueItem)) &&
            !legacyInstalledSlugs.has(queueItem.slug)
          : !installedSlugs.has(queueItem.slug)),
    );
  }, [data?.queue, installedIdentities, installedSlugs, legacyInstalledSlugs]);
  const queueByIdentity = useMemo(() => {
    const map = new Map<string, QueueItem>();
    for (const item of data?.queue ?? []) {
      map.set(getSkillIdentity(item), item);
    }
    return map;
  }, [data?.queue]);
  const unavailableDetailSlugs = useMemo(
    () => getUnavailableSkillDetailSlugs(allSkills, activeQueueItems),
    [allSkills, activeQueueItems],
  );

  // Compute top tags
  const topTags = useMemo(() => {
    if (topTab === "explore" && data?.facets?.length) {
      return data.facets;
    }
    const counts: Record<string, number> = {};
    for (const s of allSkills) {
      for (const tag of s.tags) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag, count]) => ({ tag, count }));
  }, [allSkills, data?.facets, topTab]);

  // Explore keeps the server-provided order so cursor pagination remains stable.
  const exploreSkills = allSkills;
  const yourSkillsList = useMemo(() => {
    const installed = installedSkills.map((is) => {
      const catalogEntry = allSkills.find(
        (skill) =>
          (is.ownerHandle &&
            getSkillIdentity(skill) === getSkillIdentity(is)) ||
          (!is.ownerHandle && skill.slug === is.slug),
      );
      const skill = catalogEntry ?? {
        ...(is.ownerHandle ? { ownerHandle: is.ownerHandle } : {}),
        slug: is.slug,
        name: is.name || is.slug,
        description: is.description || "",
        downloads: 0,
        stars: 0,
        tags: [],
        version: is.version ?? "",
        updatedAt: "",
      };
      return {
        skill: {
          ...skill,
          identity: getInstalledSkillRenderKey(is),
        },
        source: is.source,
      };
    });

    // Map active queue items to MinimalSkill shape with source for filtering
    const downloadingWithSource = activeQueueItems.map((qi) => {
      const catalogEntry = allSkills.find((skill) =>
        qi.ownerHandle
          ? getSkillIdentity(skill) === getSkillIdentity(qi)
          : skill.slug === qi.slug,
      );
      return {
        skill: catalogEntry ?? {
          identity: getSkillIdentity(qi),
          ...(qi.ownerHandle ? { ownerHandle: qi.ownerHandle } : {}),
          slug: qi.slug,
          name: qi.slug,
          description: "",
          downloads: 0,
          stars: 0,
          tags: [],
          version: "",
          updatedAt: "",
        },
        source: qi.source,
      };
    });

    if (yoursSubTab === "builtin") {
      const filteredDownloading = downloadingWithSource
        .filter((d) => d.source === "curated" || d.source === "managed")
        .map((d) => d.skill);
      return [
        ...filteredDownloading,
        ...installed
          .filter(
            (item) => item.source === "curated" || item.source === "managed",
          )
          .map((item) => item.skill),
      ];
    }
    if (yoursSubTab === "custom") {
      const filteredDownloading = downloadingWithSource
        .filter(
          (d) =>
            d.source === "custom" ||
            d.source === "workspace" ||
            d.source === "user",
        )
        .map((d) => d.skill);
      return [
        ...filteredDownloading,
        ...installed
          .filter(
            (item) =>
              item.source === "custom" ||
              item.source === "workspace" ||
              item.source === "user",
          )
          .map((item) => item.skill),
      ];
    }
    return [
      ...downloadingWithSource.map((d) => d.skill),
      ...installed.map((item) => item.skill),
    ];
  }, [installedSkills, allSkills, yoursSubTab, activeQueueItems]);

  const baseSkills = topTab === "explore" ? exploreSkills : yourSkillsList;

  // Filter by tag and search
  const filteredSkills = useMemo(() => {
    if (topTab === "explore") {
      return baseSkills;
    }

    let list = [...baseSkills];

    if (activeTag) {
      list = list.filter((s) => s.tags.includes(activeTag));
    }

    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      list = list.filter((s) =>
        [s.slug, s.name, s.description].join("\n").toLowerCase().includes(q),
      );
    }

    return list;
  }, [baseSkills, activeTag, debouncedQuery, topTab]);

  // Reset visible count when filters change — deps are intentional triggers
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps trigger reset on filter change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedQuery, activeTag, sort, topTab, yoursSubTab]);

  // Intersection Observer for lazy loading
  const loadMore = useCallback(() => {
    if (topTab === "explore" && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
      return;
    }
    setVisibleCount((prev) =>
      prev >= filteredSkills.length ? prev : prev + PAGE_SIZE,
    );
  }, [
    fetchNextPage,
    filteredSkills.length,
    hasNextPage,
    isFetchingNextPage,
    topTab,
  ]);

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

  const visibleSkills =
    topTab === "explore"
      ? filteredSkills
      : filteredSkills.slice(0, visibleCount);

  const installationByIdentity = useMemo(() => {
    const map = new Map<string, SkillSelection>();
    for (const skill of installedSkills) {
      const identity = getSkillIdentity(skill);
      const selection = toSkillSelection(skill);
      map.set(getInstalledSkillRenderKey(skill), selection);

      const existing = map.get(identity);
      if (!existing) {
        map.set(identity, selection);
        continue;
      }

      if (existing.source === "workspace" && skill.source !== "workspace") {
        map.set(identity, selection);
      }
    }

    return map;
  }, [installedSkills]);

  // Category tabs for pills
  const categoryTabs = useMemo(() => {
    const base =
      topTab === "explore"
        ? [
            {
              id: "all",
              label: t("skills.all"),
              count: data?.total ?? exploreSkills.length,
            },
          ]
        : [{ id: "all", label: t("skills.all"), count: yourSkillsList.length }];

    const tagTabs = topTags
      .filter(
        (tag) =>
          topTab === "explore" ||
          yourSkillsList.some((skill) => skill.tags.includes(tag.tag)),
      )
      .map((t) => {
        return {
          id: t.tag,
          label: getTagLabel(t.tag, locale),
          count:
            topTab === "explore"
              ? t.count
              : yourSkillsList.filter((skill) => skill.tags.includes(t.tag))
                  .length,
        };
      });

    return [...base, ...tagTabs];
  }, [topTab, data?.total, exploreSkills, yourSkillsList, topTags, locale, t]);

  // Yours sub-tab counts (include actively downloading items)
  const builtinCount =
    installedSkills.filter(
      (is) => is.source === "curated" || is.source === "managed",
    ).length +
    activeQueueItems.filter(
      (qi) => qi.source === "curated" || qi.source === "managed",
    ).length;
  const customCount =
    installedSkills.filter(
      (is) =>
        is.source === "custom" ||
        is.source === "workspace" ||
        is.source === "user",
    ).length +
    activeQueueItems.filter(
      (qi) =>
        qi.source === "custom" ||
        qi.source === "workspace" ||
        qi.source === "user",
    ).length;
  const totalYoursCount = installedSkills.length + activeQueueItems.length;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto px-6 py-6">
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <Loader2 size={24} className="animate-spin text-text-muted" />
          <p className="text-[13px] text-text-muted">
            {t("skills.loadingCatalog")}
          </p>
        </div>
      </div>
    );
  }

  if (isError && allSkills.length === 0) {
    return (
      <div className="h-full overflow-y-auto px-6 py-6">
        <div className="text-center py-16">
          <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-red-500/10">
            <Zap size={20} className="text-red-500" />
          </div>
          <p className="text-[13px] text-text-muted mb-2">
            {t("skills.catalogUnavailable")}
          </p>
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="text-[12px] text-accent hover:underline"
          >
            {refreshMutation.isPending
              ? t("skills.retrying")
              : t("skills.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Fixed header area */}
      <div className="shrink-0 px-6 pt-6">
        <div style={{ paddingTop: isDesktopClient ? "2rem" : "0" }}>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-lg font-semibold text-[var(--color-tabby-foreground)]">
                {t("skills.pageTitle")}
              </h1>
              <p className="text-xs text-[var(--color-tabby-muted)] mt-0.5">
                {t("skills.pageSubtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {topTab === "explore" && (
                <div className="relative">
                  <ArrowDownUp
                    size={13}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                  />
                  <select
                    aria-label={t("skills.sortBy")}
                    value={sort}
                    onChange={(event) =>
                      updateViewState({
                        sort: event.target.value as SkillCatalogSort,
                      })
                    }
                    className="h-8 appearance-none rounded-lg border border-border bg-surface-1 py-1.5 pl-8 pr-8 text-[12px] text-text-primary focus:outline-none focus:border-[var(--color-brand-primary)]/30 focus:ring-1 focus:ring-[var(--color-brand-primary)]/20"
                  >
                    <option value="downloads">
                      {t("skills.sortDownloads")}
                    </option>
                    <option value="stars">{t("skills.sortStars")}</option>
                    <option value="updated">{t("skills.sortNewest")}</option>
                  </select>
                  <ChevronRight
                    size={12}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 text-text-muted"
                  />
                </div>
              )}
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={t("skills.searchPlaceholder")}
                  className="w-48 pl-9 pr-3 py-1.5 rounded-lg border border-border bg-surface-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[var(--color-brand-primary)]/30 focus:ring-1 focus:ring-[var(--color-brand-primary)]/20 transition-colors"
                />
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-text-primary text-white text-[12px] font-medium hover:opacity-85 transition-opacity"
              >
                <Plus size={12} />
                {t("skills.import")}
              </button>
              <ImportSkillModal
                open={importModalOpen}
                onClose={() => setImportModalOpen(false)}
              />
            </div>
          </div>

          {/* Top-level tabs: Yours / Explore — segment control */}
          <div className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-2 mb-4">
            {(
              [
                {
                  id: "yours" as const,
                  label: t("skills.yours"),
                  icon: Settings2,
                },
                {
                  id: "explore" as const,
                  label: t("skills.explore"),
                  icon: Compass,
                },
              ] as const
            ).map((tab) => {
              const active = topTab === tab.id;
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    updateViewState({
                      topTab: tab.id,
                      yoursSubTab: "all",
                      activeTag: tab.id === "yours" ? null : activeTag,
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
                  {tab.label}
                  {tab.id === "yours" && totalYoursCount > 0 && active && (
                    <span
                      className={cn(
                        "tabular-nums text-[12px]",
                        active ? "text-text-secondary" : "text-text-tertiary",
                      )}
                    >
                      {totalYoursCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Yours sub-tabs: All / Built-in / Custom */}
          {topTab === "yours" && (
            <div className="flex items-center gap-2 mb-3">
              {(
                [
                  {
                    id: "all" as const,
                    label: t("skills.all"),
                    count: totalYoursCount,
                  },
                  {
                    id: "builtin" as const,
                    label: t("skills.builtin"),
                    count: builtinCount,
                  },
                  {
                    id: "custom" as const,
                    label: t("skills.custom"),
                    count: customCount,
                  },
                ] as const
              ).map((tab) => {
                const active = yoursSubTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      updateViewState({
                        yoursSubTab: tab.id,
                        activeTag: null,
                      });
                    }}
                    className={cn(
                      "shrink-0 inline-flex items-center justify-center rounded-full h-7 px-3 text-[11px] leading-none font-medium transition-all",
                      active
                        ? "bg-[var(--color-accent)] text-white"
                        : "border border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-hover",
                    )}
                  >
                    {tab.label}
                    <span
                      className={cn(
                        "ml-1 tabular-nums",
                        active ? "opacity-80" : "opacity-50",
                      )}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Category pill filters (Explore only) */}
          {topTab === "explore" && (
            <div className="relative mb-3">
              <div
                ref={pillScrollRef}
                onScroll={checkPillOverflow}
                className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5"
              >
                {categoryTabs.map((tab) => {
                  const active =
                    (activeTag === null && tab.id === "all") ||
                    activeTag === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() =>
                        updateViewState({
                          activeTag: tab.id === "all" ? null : tab.id,
                        })
                      }
                      className={cn(
                        "shrink-0 inline-flex items-center justify-center rounded-full h-7 px-3 text-[11px] leading-none font-medium transition-all",
                        active
                          ? "bg-[var(--color-accent)] text-white"
                          : "border border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-hover",
                      )}
                    >
                      {tab.label}
                      <span
                        className={cn(
                          "ml-1 tabular-nums",
                          active ? "opacity-80" : "opacity-50",
                        )}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              {showPillFadeLeft && (
                <>
                  <div className="pointer-events-none absolute top-0 left-0 bottom-0 w-12 bg-gradient-to-r from-[var(--color-surface-0)] to-transparent z-[1]" />
                  <button
                    type="button"
                    aria-label="Scroll categories left"
                    onClick={() => scrollPillBy("left")}
                    className="absolute left-0 top-1/2 -translate-y-1/2 z-[2] flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-1/95 text-text-secondary shadow-sm backdrop-blur transition-colors hover:text-text-primary hover:border-border-hover cursor-pointer"
                  >
                    <ChevronLeft size={14} />
                  </button>
                </>
              )}
              {showPillFade && (
                <>
                  <div className="pointer-events-none absolute top-0 right-0 bottom-0 w-12 bg-gradient-to-l from-[var(--color-surface-0)] to-transparent z-[1]" />
                  <button
                    type="button"
                    aria-label="Scroll categories right"
                    onClick={() => scrollPillBy("right")}
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-[2] flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-1/95 text-text-secondary shadow-sm backdrop-blur transition-colors hover:text-text-primary hover:border-border-hover cursor-pointer"
                  >
                    <ChevronRight size={14} />
                  </button>
                </>
              )}
            </div>
          )}

          {topTab === "explore" && data?.meta && (
            <div className="mb-3 flex items-center gap-1.5 text-[11px] text-text-muted">
              <Clock3 size={12} aria-hidden="true" />
              <span>
                {t("skills.lastUpdated", {
                  time: formatCatalogAge(data.meta.updatedAt, t),
                  count: data.meta.skillCount,
                })}
              </span>
            </div>
          )}

          {/* ClawHub disclaimer */}
          <p className="text-[12px] text-text-tertiary mb-4 font-medium">
            {t("skills.clawhubDisclaimer")}{" "}
            <a
              href="https://github.com/coder-zkl1988/tabby/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              GitHub Issues
            </a>{" "}
            {t("skills.clawhubDisclaimerAfterLink")}
          </p>
        </div>
      </div>

      {/* Scrollable grid area */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Skill Grid */}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(max(160px,calc(25%-9px)),1fr))]">
          {visibleSkills.map((skill) => {
            const firstTag = skill.tags[0];
            const catalogIdentity = getSkillIdentity(skill);
            const renderIdentity =
              topTab === "explore"
                ? catalogIdentity
                : (skill.identity ?? catalogIdentity);
            const installedCatalogSkill =
              topTab === "explore"
                ? getCatalogSkillInstallation(skill, installedSkills)
                : undefined;
            const identityConflict =
              topTab === "explore"
                ? getCatalogSkillIdentityConflict(skill, installedSkills)
                : undefined;
            const installation = installedCatalogSkill
              ? toSkillSelection(installedCatalogSkill)
              : installationByIdentity.get(renderIdentity);
            const queueItem = queueByIdentity.get(catalogIdentity);
            return (
              <SkillCard
                key={renderIdentity}
                skill={skill}
                isInstalled={Boolean(installation)}
                queueStatus={queueItem?.status}
                queueErrorCode={queueItem?.errorCode ?? null}
                queueErrorMessage={queueItem?.error ?? null}
                detailTo={createSkillDetailPath(
                  skill.slug,
                  location.search,
                  installation ?? {
                    ownerHandle: skill.ownerHandle,
                    version: skill.version || undefined,
                  },
                )}
                installation={installation}
                hasIdentityConflict={Boolean(identityConflict)}
                isDetailAvailable={!unavailableDetailSlugs.has(catalogIdentity)}
                skillSource={
                  topTab === "explore"
                    ? "explore"
                    : mapInstalledSkillSource(
                        installation?.source ?? queueItem?.source ?? "managed",
                      )
                }
                categoryLabel={
                  firstTag ? getTagLabel(firstTag, locale) : undefined
                }
                locale={locale}
              />
            );
          })}
        </div>

        {/* Sentinel for infinite scroll */}
        {((topTab === "explore" && hasNextPage) ||
          (topTab !== "explore" && visibleCount < filteredSkills.length)) && (
          <div ref={sentinelRef} className="flex justify-center py-8">
            {isFetchingNextPage && (
              <Loader2 size={20} className="animate-spin text-text-muted" />
            )}
          </div>
        )}

        {/* Empty state */}
        {filteredSkills.length === 0 && (
          <div className="text-center py-12">
            <Search size={24} className="mx-auto text-text-muted mb-3" />
            <div className="text-[13px] text-text-muted">
              {topTab === "yours" && !debouncedQuery.trim()
                ? t("skills.noInstalledSkills")
                : t("skills.noMatchingSkills")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
