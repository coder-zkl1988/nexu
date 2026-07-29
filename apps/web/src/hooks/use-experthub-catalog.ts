import type { SkillReference } from "@nexu/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getApiV1ExperthubCatalog,
  getApiV1ExperthubExpertsBySlug,
  postApiV1ExperthubInstall,
  postApiV1ExperthubRefresh,
  postApiV1ExperthubUninstall,
  putApiV1ExperthubExpertsBySlugSkills,
} from "../../lib/api/sdk.gen";

const CATALOG_QUERY_KEY = ["experthub", "catalog"] as const;
const EXPERT_DETAIL_QUERY_KEY = (slug: string) =>
  ["experthub", "expert", slug] as const;
const EXPERT_DETAIL_DISABLED_KEY = [
  "experthub",
  "expert",
  "__disabled__",
] as const;

export function useExperthubCatalog() {
  return useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await getApiV1ExperthubCatalog();
      if (error) throw new Error("Expert catalog fetch failed");
      if (!data) throw new Error("Expert catalog returned no data");
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useExpertDetail(slug: string | null) {
  return useQuery({
    queryKey: slug ? EXPERT_DETAIL_QUERY_KEY(slug) : EXPERT_DETAIL_DISABLED_KEY,
    enabled: !!slug,
    queryFn: async () => {
      if (!slug) throw new Error("Expert slug missing");
      const { data, error } = await getApiV1ExperthubExpertsBySlug({
        path: { slug },
      });
      if (error) throw new Error("Expert detail fetch failed");
      if (!data) throw new Error("Expert detail returned no data");
      return data;
    },
  });
}

export function useInstallExpert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slug: string) => {
      const { data, error } = await postApiV1ExperthubInstall({
        body: { slug },
      });
      if (error) throw new Error("Install expert request failed");
      if (!data) throw new Error("Install expert returned no data");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      void queryClient.invalidateQueries({ queryKey: ["skillhub", "status"] });
    },
  });
}

export function useUninstallExpert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slug: string) => {
      const { data, error } = await postApiV1ExperthubUninstall({
        body: { slug },
      });
      if (error) throw new Error("Uninstall expert request failed");
      if (!data) throw new Error("Uninstall expert returned no data");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["skillhub", "status"] });
    },
  });
}

export function useUpdateExpertSkills() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      slug,
      skills,
      skillRefs,
    }: { slug: string; skills: string[]; skillRefs: SkillReference[] }) => {
      const { data, error } = await putApiV1ExperthubExpertsBySlugSkills({
        path: { slug },
        body: { skills, skillRefs },
      });
      if (error) throw new Error("Update expert skills request failed");
      if (!data) throw new Error("Update expert skills returned no data");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      void queryClient.invalidateQueries({ queryKey: ["skillhub", "status"] });
    },
  });
}

export function useRefreshExperts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await postApiV1ExperthubRefresh();
      if (error) throw new Error("Refresh experts request failed");
      if (!data) throw new Error("Refresh experts returned no data");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    },
  });
}
