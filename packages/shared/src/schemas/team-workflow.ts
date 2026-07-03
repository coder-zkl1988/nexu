import { z } from "zod";

/**
 * A declarative, reusable team workflow (SOP): a small DAG of steps, each
 * assigned to a team member expert. Steps reference workflow inputs and
 * upstream step outputs via `{{variable}}` placeholders in their task text.
 *
 * Execution rides the existing Workboard board (cards + dependency links);
 * the controller renders each step's task, drives the member agent, and
 * feeds its output into downstream steps. See
 * specs/design-docs/2026-07-01-team-workflow-sop-and-autocompose.md.
 */

const variableNameSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "snake_case identifier");

export const workflowInputSchema = z.object({
  /** Variable name referenced as `{{name}}` in step tasks. */
  name: variableNameSchema,
  description: z.string().max(200).optional(),
  required: z.boolean().default(false),
  default: z.string().max(4_000).optional(),
});

export const workflowStepSchema = z.object({
  /** Step id — DAG node id, referenced by `dependsOn`. */
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_-]*$/),
  /**
   * task: the member agent runs the task text.
   * approval: the run pauses at this step until a human approves it
   * (spike S3 — the card blocks and an approve call releases it).
   */
  type: z.enum(["task", "approval"]).default("task"),
  /** Team member expert slug that runs this step. */
  assigneeSlug: z.string().min(1),
  /** Display name (e.g. 选题导师). Falls back to the step id. */
  name: z.string().max(60).optional(),
  /** Task text; `{{var}}` placeholders resolve from inputs + upstream outputs. */
  task: z.string().min(1).max(8_000),
  /** Output variable name this step produces (referable downstream). */
  output: variableNameSchema.optional(),
  /** Upstream step ids that must complete before this step runs. */
  dependsOn: z.array(z.string()).max(20).default([]),
});

export const teamWorkflowSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  inputs: z.array(workflowInputSchema).max(10).default([]),
  steps: z.array(workflowStepSchema).min(1).max(20),
  /** builtin = shipped template; user = authored/edited in this install. */
  source: z.enum(["builtin", "user"]).default("user"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createTeamWorkflowRequestSchema = teamWorkflowSchema.pick({
  name: true,
  description: true,
  inputs: true,
  steps: true,
});

export const updateTeamWorkflowRequestSchema = createTeamWorkflowRequestSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "empty patch",
  });

export const teamWorkflowListResponseSchema = z.object({
  workflows: z.array(teamWorkflowSchema),
});

export const runTeamWorkflowRequestSchema = z.object({
  /** Values for the workflow's declared inputs. */
  inputs: z.record(z.string(), z.string().max(8_000)).default({}),
});

export const runTeamWorkflowResponseSchema = z.object({
  runId: z.string(),
  boardId: z.string(),
  parentCardId: z.string(),
  /** Workboard card created for each step, in workflow order. */
  cards: z.array(z.object({ stepId: z.string(), cardId: z.string() })),
});

export const deleteTeamWorkflowResponseSchema = z.object({
  ok: z.literal(true),
});

/**
 * A shipped starter SOP (adapted from proven multi-agent workflow shapes).
 * Instantiating one onto a team copies it into the team's workflows —
 * missing member experts are auto-added to the team first.
 */
export const teamWorkflowTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(280),
  inputs: z.array(workflowInputSchema).max(10),
  steps: z.array(workflowStepSchema).min(1).max(20),
  /** Distinct expert slugs the template needs on the team. */
  requiredExperts: z.array(z.string().min(1)),
});

export const teamWorkflowTemplateListResponseSchema = z.object({
  templates: z.array(teamWorkflowTemplateSchema),
});

export const instantiateTeamWorkflowRequestSchema = z.object({
  templateId: z.string().min(1),
});

export type TeamWorkflowTemplate = z.infer<typeof teamWorkflowTemplateSchema>;
export type InstantiateTeamWorkflowRequest = z.infer<
  typeof instantiateTeamWorkflowRequestSchema
>;

/** One-sentence auto-compose: the model drafts a workflow for the team. */
export const composeTeamWorkflowRequestSchema = z.object({
  description: z.string().min(4).max(2_000),
});

export const composeTeamWorkflowResponseSchema = z.object({
  /** Draft definition — NOT persisted; save via POST /workflows after review. */
  draft: createTeamWorkflowRequestSchema,
  /** Repairs applied / caveats the reviewer should know about. */
  warnings: z.array(z.string()),
});

/** A run paused on an approval step, waiting for a human decision. */
export const pendingWorkflowApprovalSchema = z.object({
  teamId: z.string(),
  workflowId: z.string(),
  runId: z.string(),
  stepId: z.string(),
  cardId: z.string(),
  /** Rendered approval prompt shown to the approver. */
  prompt: z.string(),
});

export const pendingWorkflowApprovalListResponseSchema = z.object({
  approvals: z.array(pendingWorkflowApprovalSchema),
});

export const approveWorkflowStepResponseSchema = z.object({
  ok: z.literal(true),
});

export type ComposeTeamWorkflowRequest = z.infer<
  typeof composeTeamWorkflowRequestSchema
>;
export type ComposeTeamWorkflowResponse = z.infer<
  typeof composeTeamWorkflowResponseSchema
>;
export type PendingWorkflowApproval = z.infer<
  typeof pendingWorkflowApprovalSchema
>;

export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type TeamWorkflow = z.infer<typeof teamWorkflowSchema>;
export type CreateTeamWorkflowRequest = z.infer<
  typeof createTeamWorkflowRequestSchema
>;
export type UpdateTeamWorkflowRequest = z.infer<
  typeof updateTeamWorkflowRequestSchema
>;
export type TeamWorkflowListResponse = z.infer<
  typeof teamWorkflowListResponseSchema
>;
export type RunTeamWorkflowRequest = z.infer<
  typeof runTeamWorkflowRequestSchema
>;
export type RunTeamWorkflowResponse = z.infer<
  typeof runTeamWorkflowResponseSchema
>;
