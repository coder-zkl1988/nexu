import type {
  AutoRunTeamTaskRequest,
  CreateTeamRequest,
  RunTeamTaskRequest,
} from "@nexu/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteApiV1TeamsById,
  getApiV1Teams,
  getApiV1TeamsById,
  postApiV1Teams,
  postApiV1TeamsByIdRun,
  postApiV1TeamsByIdRunAuto,
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

export function useTeam(id: string | null) {
  return useQuery({
    queryKey: id ? TEAM_DETAIL_QUERY_KEY(id) : ["teams", "__disabled__"],
    enabled: !!id,
    queryFn: async () => {
      if (!id) throw new Error("Team id missing");
      const { data, error } = await getApiV1TeamsById({ path: { id } });
      if (error) throw new Error("Team fetch failed");
      if (!data) throw new Error("Team returned no data");
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

export function useRunTeamTask() {
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: { id: string; body: RunTeamTaskRequest }) => {
      const { data, error } = await postApiV1TeamsByIdRun({
        path: { id },
        body,
      });
      if (error) throw new Error("Run team task request failed");
      if (!data) throw new Error("Run team task returned no data");
      return data;
    },
  });
}

export function useRunTeamTaskAuto() {
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: { id: string; body: AutoRunTeamTaskRequest }) => {
      const { data, error } = await postApiV1TeamsByIdRunAuto({
        path: { id },
        body,
      });
      if (error) throw new Error("Auto-run team task request failed");
      if (!data) throw new Error("Auto-run team task returned no data");
      return data;
    },
  });
}
