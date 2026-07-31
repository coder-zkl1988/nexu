import type { SkillCatalogSort } from "@/lib/skills-view-state";
import type {
  SkillSource,
  SkillhubCatalogData,
  SkillhubCatalogPageData,
  SkillhubStatusData,
} from "@/types/desktop";
import "@/lib/api";
import {
  type QueryClient,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiV1SkillhubCatalog,
  getApiV1SkillhubCatalogPage,
  getApiV1SkillhubStatus,
  postApiV1SkillhubCancel,
  postApiV1SkillhubImport,
  postApiV1SkillhubInstall,
  postApiV1SkillhubRefresh,
  postApiV1SkillhubUninstall,
} from "../../lib/api/sdk.gen";

export type SkillUninstallInput = {
  slug: string;
  source?: Exclude<SkillSource, "curated">;
  agentId?: string | null;
};

export type SkillInstallInput = {
  slug: string;
  ownerHandle?: string;
  version?: string;
  update?: boolean;
};

const CATALOG_QUERY_KEY = ["skillhub", "catalog"] as const;
const CATALOG_PAGES_QUERY_KEY = ["skillhub", "catalog-page"] as const;
const STATUS_QUERY_KEY = ["skillhub", "status"] as const;
const DETAIL_QUERY_KEY = ["skillhub", "detail"] as const;

const POLLING_QUEUE_STATUSES = new Set([
  "queued",
  "downloading",
  "installing-deps",
]);

export class CatalogRevisionChangedError extends Error {
  constructor() {
    super("Catalog revision changed; restart pagination");
    this.name = "CatalogRevisionChangedError";
  }
}

export function isCatalogRevisionChangedResponse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "catalog_revision_changed"
  );
}

export async function resetCatalogPaginationOnRevisionChange(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  error: unknown,
): Promise<boolean> {
  if (!(error instanceof CatalogRevisionChangedError)) return false;
  await queryClient.resetQueries({ queryKey, exact: true });
  return true;
}

export function hasPollingQueueItems(
  data: Pick<SkillhubCatalogData, "queue"> | undefined,
): boolean {
  if (!data?.queue?.length) return false;
  return data.queue.some((item) => POLLING_QUEUE_STATUSES.has(item.status));
}

export function useCommunitySkills(opts?: { refetchInterval?: number }) {
  const query = useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async (): Promise<SkillhubCatalogData> => {
      const { data, error } = await getApiV1SkillhubCatalog();
      if (error) throw new Error("Catalog fetch failed");
      return data as unknown as SkillhubCatalogData;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval:
      opts?.refetchInterval ??
      ((q) => {
        const data = q.state.data as SkillhubCatalogData | undefined;
        return hasPollingQueueItems(data) ? 3_000 : false;
      }),
  });

  return query;
}

export function useCommunitySkillPages(options: {
  query?: string;
  category?: string | null;
  sort?: SkillCatalogSort;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => [
      ...CATALOG_PAGES_QUERY_KEY,
      options.query ?? "",
      options.category ?? "",
      options.sort ?? "downloads",
    ],
    [options.category, options.query, options.sort],
  );
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<SkillhubCatalogPageData> => {
      const { data, error } = await getApiV1SkillhubCatalogPage({
        query: {
          limit: 50,
          sort: options.sort ?? "downloads",
          ...(options.query ? { q: options.query } : {}),
          ...(options.category ? { category: options.category } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      });
      if (error) {
        if (isCatalogRevisionChangedResponse(error)) {
          throw new CatalogRevisionChangedError();
        }
        throw new Error("Catalog page fetch failed");
      }
      return data as unknown as SkillhubCatalogPageData;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) =>
      !(error instanceof CatalogRevisionChangedError) && failureCount < 3,
    enabled: options.enabled ?? true,
  });

  useEffect(() => {
    void resetCatalogPaginationOnRevisionChange(
      queryClient,
      queryKey,
      query.error,
    );
  }, [query.error, queryClient, queryKey]);

  return query;
}

export function useCommunitySkillStatus() {
  return useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: async (): Promise<SkillhubStatusData> => {
      const { data, error } = await getApiV1SkillhubStatus();
      if (error) throw new Error("Skill status fetch failed");
      return data as unknown as SkillhubStatusData;
    },
    staleTime: 30_000,
    refetchInterval: (query) => {
      const data = query.state.data as SkillhubStatusData | undefined;
      return hasPollingQueueItems(data) ? 3_000 : false;
    },
  });
}

export function useInstallSkill() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (input: string | SkillInstallInput) => {
      const request = typeof input === "string" ? { slug: input } : input;
      const { data, error } = await postApiV1SkillhubInstall({
        body: request,
      });
      if (error) throw new Error("Install request failed");
      const result = data as {
        ok: boolean;
        queued?: boolean;
        slug?: string;
        status?: string;
        position?: number;
        error?: string;
      };
      if (!result.ok) {
        throw new Error(result.error ?? "Install failed");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY }),
      ]);
      if (result.queued) {
        toast.info(t("skills.installQueued"));
      }
      return result;
    },
  });
}

export function useCancelInstall() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slug: string) => {
      const { data, error } = await postApiV1SkillhubCancel({
        body: { slug },
      });
      if (error) throw new Error("Cancel request failed");
      const result = data as { ok: boolean; cancelled: boolean };
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CATALOG_PAGES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY }),
      ]);
      return result;
    },
  });
}

export function useUninstallSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ slug, source, agentId }: SkillUninstallInput) => {
      const { data, error } = await postApiV1SkillhubUninstall({
        body: {
          slug,
          ...(source ? { source } : {}),
          ...(agentId ? { agentId } : {}),
        },
      });
      if (error) throw new Error("Uninstall request failed");
      const result = data as { ok: boolean; error?: string };
      if (!result.ok) {
        throw new Error(result.error ?? "Uninstall failed");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CATALOG_PAGES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY }),
      ]);
      return result;
    },
  });
}

export function useImportSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const { data, error } = await postApiV1SkillhubImport({
        body: { file },
      });
      if (error) throw new Error("Import request failed");
      const result = data as { ok: boolean; slug?: string; error?: string };
      if (!result.ok) {
        throw new Error(result.error ?? "Import failed");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CATALOG_PAGES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY }),
      ]);
      return result;
    },
  });
}

export function useRefreshCatalog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await postApiV1SkillhubRefresh();
      if (error) throw new Error("Refresh request failed");
      return data as { ok: boolean; skillCount: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CATALOG_PAGES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });
}
