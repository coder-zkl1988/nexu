import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteApiV1TeamsByIdWorkflowsByWorkflowId,
  getApiV1TeamWorkflowTemplates,
  getApiV1TeamsByIdWorkflowApprovals,
  getApiV1TeamsByIdWorkflows,
  postApiV1TeamsByIdWorkflows,
  postApiV1TeamsByIdWorkflowsByWorkflowIdRun,
  postApiV1TeamsByIdWorkflowsByWorkflowIdRunsByRunIdStepsByStepIdApprove,
  postApiV1TeamsByIdWorkflowsCompose,
  postApiV1TeamsByIdWorkflowsFromTemplate,
} from "../../lib/api/sdk.gen";
import type {
  PostApiV1TeamsByIdWorkflowsByWorkflowIdRunData,
  PostApiV1TeamsByIdWorkflowsComposeData,
  PostApiV1TeamsByIdWorkflowsData,
} from "../../lib/api/types.gen";

// Wire-side (z.input) request bodies — schema defaults stay optional here.
type CreateWorkflowBody = PostApiV1TeamsByIdWorkflowsData["body"];
type ComposeWorkflowBody = PostApiV1TeamsByIdWorkflowsComposeData["body"];
type RunWorkflowBody = PostApiV1TeamsByIdWorkflowsByWorkflowIdRunData["body"];

const WORKFLOWS_QUERY_KEY = (teamId: string) =>
  ["teams", teamId, "workflows"] as const;

export function useTeamWorkflows(teamId: string | null) {
  return useQuery({
    queryKey: teamId
      ? WORKFLOWS_QUERY_KEY(teamId)
      : ["teams", "__wf_disabled__"],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) throw new Error("Team id missing");
      const { data, error } = await getApiV1TeamsByIdWorkflows({
        path: { id: teamId },
      });
      if (error) throw new Error("Workflows fetch failed");
      if (!data) throw new Error("Workflows returned no data");
      return data;
    },
  });
}

export function useWorkflowTemplates() {
  return useQuery({
    queryKey: ["team-workflow-templates"],
    queryFn: async () => {
      const { data, error } = await getApiV1TeamWorkflowTemplates();
      if (error) throw new Error("Templates fetch failed");
      if (!data) throw new Error("Templates returned no data");
      return data;
    },
  });
}

export function useInstantiateWorkflowTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      templateId,
    }: { teamId: string; templateId: string }) => {
      const { data, error } = await postApiV1TeamsByIdWorkflowsFromTemplate({
        path: { id: teamId },
        body: { templateId },
      });
      if (error) throw new Error("Template instantiation failed");
      if (!data) throw new Error("Template instantiation returned no data");
      return data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: WORKFLOWS_QUERY_KEY(variables.teamId),
      });
      // Instantiation may auto-add members (and install experts).
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

export function useComposeWorkflow() {
  return useMutation({
    mutationFn: async ({
      teamId,
      body,
    }: { teamId: string; body: ComposeWorkflowBody }) => {
      const { data, error } = await postApiV1TeamsByIdWorkflowsCompose({
        path: { id: teamId },
        body,
      });
      if (error) throw new Error("Workflow compose failed");
      if (!data) throw new Error("Workflow compose returned no data");
      return data;
    },
  });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      body,
    }: { teamId: string; body: CreateWorkflowBody }) => {
      const { data, error } = await postApiV1TeamsByIdWorkflows({
        path: { id: teamId },
        body,
      });
      if (error) throw new Error("Workflow create failed");
      if (!data) throw new Error("Workflow create returned no data");
      return data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: WORKFLOWS_QUERY_KEY(variables.teamId),
      });
      // Saving may auto-add members (compose drafts reference the catalog).
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      workflowId,
    }: { teamId: string; workflowId: string }) => {
      const { data, error } = await deleteApiV1TeamsByIdWorkflowsByWorkflowId({
        path: { id: teamId, workflowId },
      });
      if (error) throw new Error("Workflow delete failed");
      if (!data) throw new Error("Workflow delete returned no data");
      return data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: WORKFLOWS_QUERY_KEY(variables.teamId),
      });
    },
  });
}

export function useRunWorkflow() {
  return useMutation({
    mutationFn: async ({
      teamId,
      workflowId,
      body,
    }: {
      teamId: string;
      workflowId: string;
      body: RunWorkflowBody;
    }) => {
      const { data, error } = await postApiV1TeamsByIdWorkflowsByWorkflowIdRun({
        path: { id: teamId, workflowId },
        body,
      });
      if (error) throw new Error("Workflow run failed");
      if (!data) throw new Error("Workflow run returned no data");
      return data;
    },
  });
}

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
