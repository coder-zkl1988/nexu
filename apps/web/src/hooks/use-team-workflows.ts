import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getApiV1TeamsByIdWorkflowApprovals,
  postApiV1TeamsByIdWorkflowsByWorkflowIdRunsByRunIdStepsByStepIdApprove,
} from "../../lib/api/sdk.gen";

/** Polls runs paused on approval steps while a run view is open. */
export function useWorkflowApprovals(teamId: string | null, active: boolean) {
  return useQuery({
    queryKey: teamId
      ? ["teams", teamId, "workflow-approvals"]
      : ["teams", "__approvals_disabled__"],
    enabled: !!teamId && active,
    refetchInterval: 3000,
    queryFn: async () => {
      if (!teamId) throw new Error("Team id missing");
      const { data, error } = await getApiV1TeamsByIdWorkflowApprovals({
        path: { id: teamId },
      });
      if (error) throw new Error("Approvals fetch failed");
      if (!data) throw new Error("Approvals returned no data");
      return data;
    },
  });
}

export function useApproveWorkflowStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      workflowId,
      runId,
      stepId,
    }: {
      teamId: string;
      workflowId: string;
      runId: string;
      stepId: string;
    }) => {
      const { data, error } =
        await postApiV1TeamsByIdWorkflowsByWorkflowIdRunsByRunIdStepsByStepIdApprove(
          { path: { id: teamId, workflowId, runId, stepId } },
        );
      if (error) throw new Error("Approve failed");
      if (!data) throw new Error("Approve returned no data");
      return data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["teams", variables.teamId, "workflow-approvals"],
      });
    },
  });
}
