import { useQuery } from "@tanstack/react-query";
import { getApiV1Bots } from "../../lib/api/sdk.gen";

export const BOTS_QUERY_KEY = ["bots"] as const;

export function useBots() {
  const { data, isLoading, error } = useQuery({
    queryKey: BOTS_QUERY_KEY,
    queryFn: async () => {
      const { data } = await getApiV1Bots();
      return data;
    },
    staleTime: 30_000,
  });

  return {
    bots: data?.bots ?? [],
    isLoading,
    error,
  };
}
