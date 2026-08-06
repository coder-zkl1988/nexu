import { z } from "zod";
import {
  runTeamWorkflowResponseSchema,
  workflowStepSchema,
} from "./team-workflow.js";

/**
 * A team is a named group of installed experts that collaborate on a task.
 *
 * Runtime mapping (see specs/design-docs/2026-06-15-nexu-orchestrator-plugin.md):
 *   - 1 lead/orchestrator bot + N member expert bots + 1 Workboard board.
 *   - A task becomes a Workboard orchestration card that is decomposed into
 *     dependency-linked child cards (`card.agentId = member botId`) and run by
 *     the Workboard dispatcher. Each member's persona is injected via
 *     `card.notes` (the dispatcher worker does not load the member AGENTS.md).
 */

export const teamMemberSchema = z.object({
  /** Installed expert slug this member was created from. */
  expertSlug: z.string(),
  /** Bot id of the member expert (the Workboard card assignee). */
  botId: z.string(),
  /** Display name, mirrored from the expert manifest at create time. */
  name: z.string().optional(),
});

export const teamResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Bot id of the orchestrator/lead agent. */
  leadBotId: z.string(),
  members: z.array(teamMemberSchema),
  /** Workboard board id owned by this team. */
  boardId: z.string(),
  /**
   * The system-managed default team: lazily created the first time a plain
   * (non-lead) bot dispatches work via expert_run_auto. Its member set grows
   * automatically as planners enroll experts from the catalog.
   */
  isDefault: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const teamListResponseSchema = z.object({
  teams: z.array(teamResponseSchema),
});

export const createTeamRequestSchema = z.object({
  name: z.string().min(1).max(80),
  /** Expert slugs to add as members. Uninstalled experts are auto-installed. */
  memberSlugs: z.array(z.string().min(1)).min(1).max(10),
  /** Model for the lead orchestrator. Falls back to the runtime default. */
  leadModelId: z.string().min(1).optional(),
});

export const createTeamResponseSchema = teamResponseSchema;

/** Partial update: rename and/or replace the member set. */
export const updateTeamRequestSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  /** Replacement member set. Uninstalled experts are auto-installed. */
  memberSlugs: z.array(z.string().min(1)).min(1).max(10).optional(),
});

export const updateTeamResponseSchema = teamResponseSchema;

export const deleteTeamResponseSchema = z.object({ ok: z.literal(true) });

/**
 * Phase 1: the caller supplies the subtask breakdown explicitly (manual
 * decomposition, no automatic expert routing yet). Each subtask is assigned to
 * one of the team's members by expert slug.
 */
export const teamSubtaskInputSchema = z.object({
  title: z.string().min(1).max(200),
  /** Member expert slug to run this subtask. Must be a team member. */
  assigneeSlug: z.string().min(1),
  /** Extra task detail appended to the worker card notes. */
  notes: z.string().max(8_000).optional(),
});

export const runTeamTaskRequestSchema = z.object({
  /** The overall task; becomes the parent orchestration card title. */
  task: z.string().min(1).max(8_000),
  subtasks: z.array(teamSubtaskInputSchema).min(1).max(20),
});

export const runTeamTaskResponseSchema = z.object({
  boardId: z.string(),
  parentCardId: z.string(),
  /** Worker subagent runs started by the dispatch pass. */
  started: z.array(
    z.object({
      cardId: z.string(),
      sessionKey: z.string(),
    }),
  ),
});

/**
 * Phase 2: the lead orchestrator decomposes the task automatically. The caller
 * supplies only the goal; the lead's model produces the subtask breakdown.
 */
export const autoRunTeamTaskRequestSchema = z.object({
  task: z.string().min(1).max(8_000),
  maxSubtasks: z.number().int().min(1).max(20).optional(),
});

/**
 * Auto team run response (DAG engine). Both auto endpoints
 * (`/teams/default/run-auto`, `/teams/{id}/run-auto`) compose a workflow DAG
 * and run it topologically via TeamWorkflowService.autoComposeAndRun. The
 * response carries the run identity + per-step cards (from
 * runTeamWorkflowResponseSchema), the team the run landed on, and the composed
 * DAG steps (with `dependsOn`) so the run-card can render real dependencies.
 */
export const runAutoTeamTaskResponseSchema =
  runTeamWorkflowResponseSchema.extend({
    /** The team the run landed on (the default team for `/default/run-auto`). */
    teamId: z.string(),
    /** The composed DAG steps, in workflow order (carry `dependsOn`). */
    steps: z.array(workflowStepSchema),
  });

/**
 * Phase 3: a live snapshot of the team's Workboard for the Kanban view.
 * `status` mirrors the Workboard lifecycle (triage/backlog/todo/scheduled/
 * ready/running/review/blocked/done) and is kept as a string so new runtime
 * statuses don't break the contract.
 */
export const teamBoardCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  /**
   * The lead bot's id for a run's orchestration (parent) card; the assignee bot
   * id for a member step card. Null only when the workboard card carries no
   * assignee.
   */
  agentId: z.string().nullable(),
  /** Display name of the assigned member, when resolvable. */
  assigneeName: z.string().nullable(),
  /** Latest recorded output (workflow step reply), when any. */
  output: z.string().nullable(),
  /** OpenClaw lane that executes this card, when the card has a runtime step. */
  sessionKey: z.string().nullable().optional(),
  /** Upstream Workboard cards that must complete before this card. */
  parentIds: z.array(z.string()).default([]),
  /** Downstream Workboard cards unlocked by this card. */
  childIds: z.array(z.string()).default([]),
});

export const teamBoardResponseSchema = z.object({
  boardId: z.string(),
  available: z.boolean(),
  cards: z.array(teamBoardCardSchema),
});

export type TeamMember = z.infer<typeof teamMemberSchema>;
export type TeamResponse = z.infer<typeof teamResponseSchema>;
export type TeamListResponse = z.infer<typeof teamListResponseSchema>;
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;
export type CreateTeamResponse = z.infer<typeof createTeamResponseSchema>;
export type UpdateTeamRequest = z.infer<typeof updateTeamRequestSchema>;
export type UpdateTeamResponse = z.infer<typeof updateTeamResponseSchema>;
export type DeleteTeamResponse = z.infer<typeof deleteTeamResponseSchema>;
export type TeamSubtaskInput = z.infer<typeof teamSubtaskInputSchema>;
export type RunTeamTaskRequest = z.infer<typeof runTeamTaskRequestSchema>;
export type RunTeamTaskResponse = z.infer<typeof runTeamTaskResponseSchema>;
export type AutoRunTeamTaskRequest = z.infer<
  typeof autoRunTeamTaskRequestSchema
>;
export type RunAutoTeamTaskResponse = z.infer<
  typeof runAutoTeamTaskResponseSchema
>;
export type TeamBoardCard = z.infer<typeof teamBoardCardSchema>;
export type TeamBoardResponse = z.infer<typeof teamBoardResponseSchema>;
