import type { CreateTeamRequest, UpdateTeamRequest } from "@nexu/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteApiV1TeamsById,
  getApiV1Teams,
  getApiV1TeamsByIdBoard,
  patchApiV1TeamsById,
  postApiV1Teams,
} from "../../lib/api/sdk.gen";

const TEAMS_QUERY_KEY = ["teams"] as const;
const TEAM_DETAIL_QUERY_KEY = (id: string) => ["teams", id] as const;

export function useTeams() {
  return useQuery({
    queryKey: TEAMS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await getApiV1Teams();
      if (error) throw new Error("Teams fetch failed");
      if (!data) throw new Error("Teams returned no data");
      return data;
    },
  });
}

/** Polls the team's Workboard for a near-real-time Kanban snapshot. */
export function useTeamBoard(
  id: string | null,
  options: { live?: boolean } = {},
) {
  return useQuery({
    queryKey: id ? ["teams", id, "board"] : ["teams", "__board_disabled__"],
    enabled: !!id,
    // live=false stops polling (e.g. a finished run card in chat history).
    refetchInterval: options.live === false ? false : 3000,
    queryFn: async () => {
      if (!id) throw new Error("Team id missing");
      const { data, error } = await getApiV1TeamsByIdBoard({ path: { id } });
      if (error) throw new Error("Team board fetch failed");
      if (!data) throw new Error("Team board returned no data");
      if (!data.available) throw new Error("Team board is unavailable");
      return data;
    },
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTeamRequest) => {
      const { data, error } = await postApiV1Teams({ body });
      if (error) throw new Error("Create team request failed");
      if (!data) throw new Error("Create team returned no data");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
    },
  });
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: { id: string; body: UpdateTeamRequest }) => {
      const { data, error } = await patchApiV1TeamsById({ path: { id }, body });
      if (error) throw new Error("Update team request failed");
      if (!data) throw new Error("Update team returned no data");
      return data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: TEAM_DETAIL_QUERY_KEY(variables.id),
      });
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
    },
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await deleteApiV1TeamsById({ path: { id } });
      if (error) throw new Error("Delete team request failed");
      if (!data) throw new Error("Delete team returned no data");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
    },
  });
}
