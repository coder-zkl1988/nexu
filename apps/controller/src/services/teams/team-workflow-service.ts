import type {
  ComposeTeamWorkflowResponse,
  CreateTeamWorkflowRequest,
  PendingWorkflowApproval,
  RunTeamWorkflowRequest,
  RunTeamWorkflowResponse,
  TeamResponse,
  TeamWorkflow,
  TeamWorkflowTemplate,
  UpdateTeamWorkflowRequest,
  WorkflowStep,
} from "@nexu/shared";
import { logger } from "../../lib/logger.js";
import type { ApprovalAuditService } from "../approval-audit-service.js";
import type { OpenClawGatewayService } from "../openclaw-gateway-service.js";
import { TeamNotFoundError } from "./team-service.js";
import type { TeamWorkflowLedgerStore } from "./team-workflow-ledger.js";
import {
  TEAM_WORKFLOW_TEMPLATES,
  getTeamWorkflowTemplate,
} from "./team-workflow-templates.js";

/** Cap the member persona block so the task message stays lean. */
const MAX_PERSONA_CHARS = 3_000;
/** Workboard rejects comment bodies over 2000 chars ("comment body must be
 * 2000 characters or fewer", verified live) — cap the recorded step output. */
const MAX_COMMENT_CHARS = 2_000;
/** `{{variable}}` placeholder — same snake_case grammar as the schema. */
const TEMPLATE_VAR_RE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

type TeamApprovalAuditContext = {
  operation: "requested" | "resolved";
  approvalId: string;
  teamId: string;
  workflowId: string;
  runId: string;
  stepId: string;
};

function persistApprovalAuditBestEffort(
  context: TeamApprovalAuditContext,
  write: (() => Promise<unknown>) | undefined,
) {
  if (!write) return;
  void write().catch((error: unknown) => {
    logger.warn(
      {
        ...context,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "team_workflow_approval_audit_persist_failed",
    );
  });
}

export class WorkflowNotFoundError extends Error {
  constructor(public readonly workflowId: string) {
    super(`Workflow not found: ${workflowId}`);
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowTemplateNotFoundError extends Error {
  constructor(public readonly templateId: string) {
    super(`Workflow template not found: ${templateId}`);
    this.name = "WorkflowTemplateNotFoundError";
  }
}

export class WorkflowApprovalNotFoundError extends Error {
  constructor(runId: string, stepId: string) {
    super(`No pending approval for run ${runId} step ${stepId}`);
    this.name = "WorkflowApprovalNotFoundError";
  }
}

/** Structural problems in a workflow definition (cycle, bad refs, ...). */
export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

/** A run request that is missing required inputs or passes unknown ones. */
export class WorkflowInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowInputError";
  }
}

export type TeamWorkflowServiceDeps = {
  workflows: Pick<
    TeamWorkflowLedgerStore,
    "get" | "listByTeam" | "upsert" | "remove"
  >;
  getTeam: (teamId: string) => TeamResponse | null;
  gateway: Pick<
    OpenClawGatewayService,
    | "workboardBoardUpsert"
    | "workboardCardCreate"
    | "workboardCardDecompose"
    | "workboardCardMove"
    | "workboardCardLinkDependency"
    | "workboardCardUpdate"
    | "workboardCardComment"
    | "workboardCardComplete"
    | "workboardCardBlock"
  >;
  /** Resolve a member expert's persona text (SOUL.md / systemPrompt). */
  resolveExpertPersona: (slug: string) => Promise<string | null>;
  /** Send one chat turn to a (possibly brand-new) subagent lane. */
  sendChat: (input: {
    botId: string;
    sessionKey: string;
    message: string;
  }) => Promise<unknown>;
  /** Poll the lane's completion state (design doc §10.3). */
  readSessionEntry: (
    botId: string,
    sessionKey: string,
  ) => Promise<{ status?: string; sessionFile?: string } | null>;
  /** Extract the member's reply once the lane is done. */
  readAssistantReply: (sessionFile: string) => Promise<string | null>;
  /**
   * Make sure every slug is a team member (auto-installing/adding missing
   * experts) and return the refreshed team. Used by template instantiation
   * and workflow save (compose drafts may reference non-members).
   */
  ensureTeamMembers: (
    teamId: string,
    memberSlugs: string[],
  ) => Promise<TeamResponse>;
  /** One-sentence auto-compose (design doc P2). Wired to WorkflowComposer. */
  composeDraft: (
    team: TeamResponse,
    description: string,
  ) => Promise<ComposeTeamWorkflowResponse>;
  approvalAudit?: Pick<
    ApprovalAuditService,
    "recordRequested" | "recordResolved"
  >;
  getReviewerName?: () => Promise<string>;
  genId: () => string;
};

export type TeamWorkflowServiceOptions = {
  /** Interval between session-status polls. */
  pollIntervalMs?: number;
  /** Per-step budget before the card is blocked as timed out. */
  stepTimeoutMs?: number;
  /**
   * Grace window after a lane reports `done` with no reply text. A worker
   * can end a turn on a bare tool call (e.g. it poured the whole deliverable
   * into render_a2ui), and OpenClaw may replay the queued message as a second
   * turn moments later — keep polling instead of failing instantly.
   */
  emptyDoneTimeoutMs?: number;
};

/**
 * Declarative team workflow (SOP) engine. Workboard owns the durable state
 * (cards, dependency links, board UI); the controller owns execution — it
 * renders each step's task from inputs + upstream outputs, drives the member
 * agent over `chat.send` to a dedicated subagent lane, decides completion by
 * polling the session status itself (worker tool-call compliance is
 * probabilistic — design doc §10.4), and feeds the reply downstream.
 */
export class TeamWorkflowService {
  private readonly pollIntervalMs: number;
  private readonly stepTimeoutMs: number;
  private readonly emptyDoneTimeoutMs: number;
  /**
   * Runs paused on an approval step, keyed `runId:stepId`. In-memory by
   * design: the card state survives a controller restart (visible/blocked on
   * the board), but the paused run itself does not — v1 limitation.
   */
  private readonly pendingApprovals = new Map<
    string,
    {
      info: PendingWorkflowApproval;
      resolve: () => void;
      approval?: Promise<void>;
    }
  >();

  constructor(
    private readonly deps: TeamWorkflowServiceDeps,
    options: TeamWorkflowServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.stepTimeoutMs = options.stepTimeoutMs ?? 10 * 60_000;
    this.emptyDoneTimeoutMs = options.emptyDoneTimeoutMs ?? 60_000;
  }

  listWorkflows(teamId: string): TeamWorkflow[] {
    this.requireTeam(teamId);
    return this.deps.workflows.listByTeam(teamId);
  }

  getWorkflow(teamId: string, workflowId: string): TeamWorkflow {
    this.requireTeam(teamId);
    const workflow = this.deps.workflows.get(workflowId);
    if (!workflow || workflow.teamId !== teamId) {
      throw new WorkflowNotFoundError(workflowId);
    }
    return workflow;
  }

  async createWorkflow(
    teamId: string,
    input: CreateTeamWorkflowRequest,
  ): Promise<TeamWorkflow> {
    this.requireTeam(teamId);
    // Authors (and compose drafts) may assign steps to experts that are not
    // members yet — add them (auto-installing) before validating membership.
    const team = await this.deps.ensureTeamMembers(teamId, [
      ...new Set(input.steps.map((step) => step.assigneeSlug)),
    ]);
    validateWorkflowDefinition(input, team);
    const now = new Date().toISOString();
    const workflow: TeamWorkflow = {
      id: this.deps.genId(),
      teamId,
      name: input.name,
      description: input.description,
      inputs: input.inputs,
      steps: input.steps,
      source: "user",
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.workflows.upsert(workflow);
    return workflow;
  }

  async updateWorkflow(
    teamId: string,
    workflowId: string,
    patch: UpdateTeamWorkflowRequest,
  ): Promise<TeamWorkflow> {
    const team = this.requireTeam(teamId);
    const existing = this.getWorkflow(teamId, workflowId);
    const updated: TeamWorkflow = {
      ...existing,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      inputs: patch.inputs ?? existing.inputs,
      steps: patch.steps ?? existing.steps,
      updatedAt: new Date().toISOString(),
    };
    validateWorkflowDefinition(updated, team);
    await this.deps.workflows.upsert(updated);
    return updated;
  }

  async deleteWorkflow(teamId: string, workflowId: string): Promise<boolean> {
    this.getWorkflow(teamId, workflowId); // throws when absent / wrong team
    return this.deps.workflows.remove(workflowId);
  }

  listTemplates(): TeamWorkflowTemplate[] {
    return TEAM_WORKFLOW_TEMPLATES;
  }

  /** One-sentence auto-compose. Returns a draft — the user reviews and saves. */
  async composeWorkflow(
    teamId: string,
    description: string,
  ): Promise<ComposeTeamWorkflowResponse> {
    const team = this.requireTeam(teamId);
    return this.deps.composeDraft(team, description);
  }

  /**
   * Auto-compose a workflow DAG from a one-sentence task and run it
   * immediately. Ephemeral: the composed workflow is NOT persisted to the
   * ledger. Compose → enroll assignees (auto-install) → run topologically via
   * runWorkflowDefinition (which validates the definition first).
   */
  async autoComposeAndRun(
    teamId: string,
    description: string,
    input: RunTeamWorkflowRequest = { inputs: {} },
  ): Promise<RunTeamWorkflowResponse & { steps: WorkflowStep[] }> {
    this.requireTeam(teamId);
    const { draft } = await this.composeWorkflow(teamId, description);
    // Compose drafts may assign steps to experts that are not members yet —
    // enroll the distinct assignees (auto-installing) before running.
    const team = await this.deps.ensureTeamMembers(teamId, [
      ...new Set(draft.steps.map((step) => step.assigneeSlug)),
    ]);
    const now = new Date().toISOString();
    const workflow: TeamWorkflow = {
      id: this.deps.genId(),
      teamId,
      name: draft.name,
      description: draft.description,
      inputs: draft.inputs,
      steps: draft.steps,
      // The source enum is builtin|user (no "auto"); an ephemeral run is never
      // written to the ledger, so this label is not persisted regardless.
      source: "user",
      createdAt: now,
      updatedAt: now,
    };
    // Ephemeral — the composed workflow is intentionally NOT persisted.
    const run = await this.runWorkflowDefinition(team, workflow, input);
    // Carry the composed DAG back so the route/run-card can render real step
    // dependencies (dependsOn) rather than a flat list.
    return { ...run, steps: workflow.steps };
  }

  /** Runs currently paused on an approval step for this team. */
  listPendingApprovals(teamId: string): PendingWorkflowApproval[] {
    this.requireTeam(teamId);
    return [...this.pendingApprovals.values()]
      .map((pending) => pending.info)
      .filter((info) => info.teamId === teamId);
  }

  /** Release a run paused on an approval step (spike S3: unblock semantics). */
  async approveStep(
    teamId: string,
    workflowId: string,
    runId: string,
    stepId: string,
  ): Promise<void> {
    this.requireTeam(teamId);
    const key = `${runId}:${stepId}`;
    const pending = this.pendingApprovals.get(key);
    if (
      !pending ||
      pending.info.teamId !== teamId ||
      pending.info.workflowId !== workflowId
    ) {
      throw new WorkflowApprovalNotFoundError(runId, stepId);
    }
    if (!pending.approval) {
      pending.approval = (async () => {
        await this.deps.gateway.workboardCardComplete({
          id: pending.info.cardId,
          summary: "approved",
        });
        if (this.pendingApprovals.get(key) !== pending) return;
        this.pendingApprovals.delete(key);
        pending.resolve();
        persistApprovalAuditBestEffort(
          {
            operation: "resolved",
            approvalId: key,
            teamId,
            workflowId,
            runId,
            stepId,
          },
          this.deps.approvalAudit
            ? async () =>
                this.deps.approvalAudit?.recordResolved({
                  approvalId: key,
                  source: "team",
                  kind: "team",
                  status: "approved",
                  decision: "approved",
                  reviewer: await this.deps.getReviewerName?.(),
                  teamId,
                  workflowId,
                  runId,
                  stepId,
                  cardId: pending.info.cardId,
                })
            : undefined,
        );
      })();
    }
    const approval = pending.approval;
    try {
      await approval;
    } catch (error) {
      if (pending.approval === approval) pending.approval = undefined;
      throw error;
    }
  }

  /**
   * Copy a starter template into the team's workflows. Experts the template
   * needs but the team lacks are auto-added first (which auto-installs them),
   * so instantiation is one click.
   */
  async instantiateTemplate(
    teamId: string,
    templateId: string,
  ): Promise<TeamWorkflow> {
    this.requireTeam(teamId);
    const template = getTeamWorkflowTemplate(templateId);
    if (!template) {
      throw new WorkflowTemplateNotFoundError(templateId);
    }
    const team = await this.deps.ensureTeamMembers(
      teamId,
      template.requiredExperts,
    );
    validateWorkflowDefinition(template, team);
    const now = new Date().toISOString();
    const workflow: TeamWorkflow = {
      id: this.deps.genId(),
      teamId,
      name: template.name,
      description: template.description,
      inputs: template.inputs,
      steps: template.steps,
      source: "builtin",
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.workflows.upsert(workflow);
    return workflow;
  }

  /**
   * Run a persisted workflow: resolve the team and stored workflow, then hand
   * off to the shared run engine.
   */
  async runWorkflow(
    teamId: string,
    workflowId: string,
    input: RunTeamWorkflowRequest,
  ): Promise<RunTeamWorkflowResponse> {
    const team = this.requireTeam(teamId);
    const workflow = this.getWorkflow(teamId, workflowId);
    return this.runWorkflowDefinition(team, workflow, input);
  }

  /**
   * Materialize a run: board + parent card + one gated card per step, then
   * kick off background execution and return immediately. Progress is
   * observable through the existing team board endpoint.
   *
   * Operates on an already-resolved team and an in-memory workflow definition,
   * so a composed (non-persisted) workflow can run through the same machinery.
   */
  async runWorkflowDefinition(
    team: TeamResponse,
    workflow: TeamWorkflow,
    input: RunTeamWorkflowRequest,
  ): Promise<RunTeamWorkflowResponse> {
    // Members may have changed since the workflow was authored.
    validateWorkflowDefinition(workflow, team);
    const context = resolveRunInputs(workflow, input.inputs);
    const levels = topologicalLevels(workflow.steps);
    const memberBySlug = new Map(team.members.map((m) => [m.expertSlug, m]));

    const runId = this.deps.genId();
    await this.deps.gateway.workboardBoardUpsert({
      id: team.boardId,
      name: team.name,
    });
    const { card: parentCard } = await this.deps.gateway.workboardCardCreate({
      title: workflow.name,
      boardId: team.boardId,
      agentId: team.leadBotId,
      priority: "high",
    });
    const { children } = await this.deps.gateway.workboardCardDecompose({
      id: parentCard.id,
      children: workflow.steps.map((step) => {
        // biome-ignore lint/style/noNonNullAssertion: validated against team members
        const botId = memberBySlug.get(step.assigneeSlug)!.botId;
        const sessionKey = `agent:${botId}:subagent:wf-${runId}-${step.id}`;
        return {
          title: step.name ?? step.id,
          boardId: team.boardId,
          agentId: botId,
          ...(step.type === "approval" ? {} : { sessionKey }),
          notes: "(waiting for upstream steps)",
        };
      }),
    });
    const cardByStep = new Map<string, string>();
    workflow.steps.forEach((step, index) => {
      const child = children[index];
      if (child) {
        cardByStep.set(step.id, child.id);
      }
    });
    // Native sibling gating: a step's card cannot go ready until every
    // dependency card is done (spike S1).
    for (const step of workflow.steps) {
      for (const upstream of step.dependsOn) {
        const parentCardId = cardByStep.get(upstream);
        const childCardId = cardByStep.get(step.id);
        if (parentCardId && childCardId) {
          await this.deps.gateway.workboardCardLinkDependency({
            parentId: parentCardId,
            childId: childCardId,
          });
        }
      }
    }

    // Fire-and-forget: the run endpoint returns immediately; the UI polls the
    // board for card-level progress.
    void this.executeRun({
      team,
      workflow,
      levels,
      cardByStep,
      context,
      runId,
      parentCardId: parentCard.id,
    }).catch((error) => {
      logger.error(
        {
          teamId: team.id,
          workflowId: workflow.id,
          runId,
          error: error instanceof Error ? error.message : String(error),
        },
        "team workflow run crashed",
      );
    });

    return {
      runId,
      boardId: team.boardId,
      parentCardId: parentCard.id,
      cards: workflow.steps.map((step) => ({
        stepId: step.id,
        // biome-ignore lint/style/noNonNullAssertion: populated from decompose above
        cardId: cardByStep.get(step.id)!,
      })),
    };
  }

  private requireTeam(teamId: string): TeamResponse {
    const team = this.deps.getTeam(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }
    return team;
  }

  private async executeRun(run: {
    team: TeamResponse;
    workflow: TeamWorkflow;
    levels: WorkflowStep[][];
    cardByStep: Map<string, string>;
    context: Map<string, string>;
    runId: string;
    parentCardId: string;
  }): Promise<void> {
    const { team, workflow, levels, cardByStep, context, runId } = run;
    const memberBySlug = new Map(team.members.map((m) => [m.expertSlug, m]));

    try {
      for (const level of levels) {
        const results = await Promise.allSettled(
          level.map((step) =>
            this.runStep({
              step,
              teamId: team.id,
              workflowId: workflow.id,
              // biome-ignore lint/style/noNonNullAssertion: validated membership
              botId: memberBySlug.get(step.assigneeSlug)!.botId,
              // biome-ignore lint/style/noNonNullAssertion: card created per step
              cardId: cardByStep.get(step.id)!,
              context,
              runId,
            }),
          ),
        );
        const failed = results
          .map((result, index) => ({ result, step: level[index] }))
          .filter(({ result }) => result.status === "rejected");
        if (failed.length > 0) {
          const failedIds = failed.map(({ step }) => step?.id).join(", ");
          await this.abortRemaining(run, `upstream step failed: ${failedIds}`);
          return;
        }
      }

      await this.deps.gateway.workboardCardComplete({
        id: run.parentCardId,
        summary: `Workflow ${workflow.name} completed (run ${runId}).`,
      });
    } finally {
      // A run that ends (success, abort, or crash) leaves no dangling
      // approval entries behind.
      const interrupted: PendingWorkflowApproval[] = [];
      for (const key of this.pendingApprovals.keys()) {
        if (key.startsWith(`${runId}:`)) {
          const pending = this.pendingApprovals.get(key);
          if (pending) interrupted.push(pending.info);
          this.pendingApprovals.delete(key);
        }
      }
      for (const info of interrupted) {
        const approvalId = `${info.runId}:${info.stepId}`;
        persistApprovalAuditBestEffort(
          {
            operation: "resolved",
            approvalId,
            teamId: info.teamId,
            workflowId: info.workflowId,
            runId: info.runId,
            stepId: info.stepId,
          },
          this.deps.approvalAudit
            ? () =>
                // biome-ignore lint/style/noNonNullAssertion: guarded above
                this.deps.approvalAudit!.recordResolved({
                  approvalId,
                  source: "team",
                  kind: "team",
                  status: "interrupted",
                  decision: "interrupted",
                  reviewer: "system",
                  teamId: info.teamId,
                  workflowId: info.workflowId,
                  runId: info.runId,
                  stepId: info.stepId,
                  cardId: info.cardId,
                })
            : undefined,
        );
      }
    }
  }

  private async runStep(input: {
    step: WorkflowStep;
    teamId: string;
    workflowId: string;
    botId: string;
    cardId: string;
    context: Map<string, string>;
    runId: string;
  }): Promise<void> {
    const { step, teamId, workflowId, botId, cardId, context, runId } = input;
    const task = renderTemplate(step.task, context);

    if (step.type === "approval") {
      // Human gate (spike S3): block the card with the rendered prompt and
      // pause until approveStep() releases the run.
      await this.deps.gateway.workboardCardUpdate({
        id: cardId,
        notes: `[APPROVAL]\n${task}`.slice(0, MAX_COMMENT_CHARS),
      });
      await this.deps.gateway.workboardCardBlock({
        id: cardId,
        reason: "awaiting approval",
      });
      const approvalId = `${runId}:${step.id}`;
      const approvalGate = new Promise<void>((resolve) => {
        this.pendingApprovals.set(`${runId}:${step.id}`, {
          info: {
            teamId,
            workflowId,
            runId,
            stepId: step.id,
            cardId,
            prompt: task,
          },
          resolve,
        });
      });
      persistApprovalAuditBestEffort(
        {
          operation: "requested",
          approvalId,
          teamId,
          workflowId,
          runId,
          stepId: step.id,
        },
        this.deps.approvalAudit
          ? () =>
              // biome-ignore lint/style/noNonNullAssertion: guarded above
              this.deps.approvalAudit!.recordRequested({
                approvalId,
                source: "team",
                kind: "team",
                title: "Team approval",
                teamId,
                workflowId,
                runId,
                stepId: step.id,
                cardId,
                requestedAt: Date.now(),
              })
          : undefined,
      );
      await approvalGate;
      return;
    }

    const persona = (
      (await this.deps.resolveExpertPersona(step.assigneeSlug)) ?? ""
    ).slice(0, MAX_PERSONA_CHARS);
    const sessionKey = `agent:${botId}:subagent:wf-${runId}-${step.id}`;

    // Record the rendered task on the card (board UI) and mark it running —
    // the controller, not the dispatcher, owns this card's lifecycle.
    await this.deps.gateway.workboardCardUpdate({
      id: cardId,
      sessionKey,
      notes: `[TASK]\n${task}`.slice(0, MAX_COMMENT_CHARS),
    });
    await this.deps.gateway.workboardCardMove({
      id: cardId,
      status: "running",
    });

    const message = [
      persona.trim()
        ? `[PERSONA — follow this exactly for your entire reply]\n${persona.trim()}\n`
        : "",
      `[TASK]\n${task}`,
      "",
      // "plain text" matters: a worker that pours the deliverable into a UI
      // tool (render_a2ui) ends its turn with no reply text to harvest.
      "Reply with the deliverable itself only, as plain text — no preamble, no meta commentary, no questions back, and do NOT render UI (no render_a2ui).",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await this.deps.sendChat({ botId, sessionKey, message });
      const reply = await this.awaitLaneReply(botId, sessionKey);
      await this.deps.gateway.workboardCardComment({
        id: cardId,
        body: reply.slice(0, MAX_COMMENT_CHARS),
      });
      await this.deps.gateway.workboardCardComplete({
        id: cardId,
        summary: `${step.name ?? step.id} done`,
      });
      if (step.output) {
        context.set(step.output, reply);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.deps.gateway
        .workboardCardBlock({ id: cardId, reason })
        .catch(() => undefined);
      throw error;
    }
  }

  /** Poll the lane's session entry until done, then read the reply. */
  private async awaitLaneReply(
    botId: string,
    sessionKey: string,
  ): Promise<string> {
    const deadline = Date.now() + this.stepTimeoutMs;
    // First time we saw `done` with no reply text yet. A turn can end on a
    // bare tool call, and the lane may still run a queued follow-up turn —
    // keep polling within a grace window instead of failing on first sight.
    let emptyDoneSince: number | null = null;
    while (Date.now() < deadline) {
      const entry = await this.deps.readSessionEntry(botId, sessionKey);
      if (entry?.status === "done") {
        const reply = entry.sessionFile
          ? await this.deps.readAssistantReply(entry.sessionFile)
          : null;
        if (reply?.trim()) {
          return reply.trim();
        }
        emptyDoneSince ??= Date.now();
        if (Date.now() - emptyDoneSince >= this.emptyDoneTimeoutMs) {
          throw new Error(
            `step session finished without a reply: ${sessionKey}`,
          );
        }
      } else {
        emptyDoneSince = null; // a new turn started — reset the grace window
      }
      if (entry?.status === "failed") {
        throw new Error(`step session failed: ${sessionKey}`);
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error(`step timed out after ${this.stepTimeoutMs}ms`);
  }

  /** Block every card that has not finished — an upstream step failed. */
  private async abortRemaining(
    run: {
      workflow: TeamWorkflow;
      cardByStep: Map<string, string>;
      parentCardId: string;
    },
    reason: string,
  ): Promise<void> {
    for (const step of run.workflow.steps) {
      const cardId = run.cardByStep.get(step.id);
      if (!cardId) {
        continue;
      }
      // Blocking an already-done/blocked card is a no-op level concern; the
      // gateway call is tolerated to fail per card.
      await this.deps.gateway
        .workboardCardBlock({ id: cardId, reason })
        .catch(() => undefined);
    }
    await this.deps.gateway
      .workboardCardBlock({ id: run.parentCardId, reason })
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Structural validation beyond the Zod schema: unique ids/outputs, resolvable
 * dependencies, acyclicity, team membership, and — AO-style — every
 * `{{var}}` in a step's task must come from a workflow input or the output of
 * a step in its *transitive upstream* (so the value is guaranteed to exist
 * when the step runs).
 */
export function validateWorkflowDefinition(
  workflow: Pick<TeamWorkflow, "inputs" | "steps">,
  team: Pick<TeamResponse, "members">,
): void {
  const stepIds = new Set<string>();
  for (const step of workflow.steps) {
    if (stepIds.has(step.id)) {
      throw new WorkflowValidationError(`duplicate step id: ${step.id}`);
    }
    stepIds.add(step.id);
  }

  const inputNames = new Set(workflow.inputs.map((input) => input.name));
  const outputOwner = new Map<string, string>();
  for (const step of workflow.steps) {
    if (step.type === "approval" && step.output) {
      throw new WorkflowValidationError(
        `approval step "${step.id}" must not declare an output`,
      );
    }
    if (!step.output) {
      continue;
    }
    if (inputNames.has(step.output)) {
      throw new WorkflowValidationError(
        `step "${step.id}" output "${step.output}" collides with an input name`,
      );
    }
    if (outputOwner.has(step.output)) {
      throw new WorkflowValidationError(
        `duplicate output variable: ${step.output}`,
      );
    }
    outputOwner.set(step.output, step.id);
  }

  const memberSlugs = new Set(team.members.map((m) => m.expertSlug));
  for (const step of workflow.steps) {
    if (!memberSlugs.has(step.assigneeSlug)) {
      throw new WorkflowValidationError(
        `step "${step.id}" assignee is not a team member: ${step.assigneeSlug}`,
      );
    }
    for (const upstream of step.dependsOn) {
      if (!stepIds.has(upstream)) {
        throw new WorkflowValidationError(
          `step "${step.id}" depends on unknown step: ${upstream}`,
        );
      }
      if (upstream === step.id) {
        throw new WorkflowValidationError(
          `step "${step.id}" depends on itself`,
        );
      }
    }
  }

  // Throws on cycles.
  topologicalLevels(workflow.steps);

  // Variable provenance: inputs ∪ transitive-upstream outputs.
  const upstreamClosure = transitiveUpstream(workflow.steps);
  const stepById = new Map(workflow.steps.map((step) => [step.id, step]));
  for (const step of workflow.steps) {
    const reachableOutputs = new Set<string>();
    for (const upstreamId of upstreamClosure.get(step.id) ?? []) {
      const output = stepById.get(upstreamId)?.output;
      if (output) {
        reachableOutputs.add(output);
      }
    }
    for (const varName of templateVariables(step.task)) {
      if (!inputNames.has(varName) && !reachableOutputs.has(varName)) {
        throw new WorkflowValidationError(
          `step "${step.id}" references {{${varName}}} which is not a workflow input or an upstream step output (add the producing step to dependsOn)`,
        );
      }
    }
  }
}

/** Kahn's algorithm: parallel-safe waves in dependency order. Throws on cycles. */
export function topologicalLevels(
  steps: readonly WorkflowStep[],
): WorkflowStep[][] {
  const remainingDeps = new Map(
    steps.map((step) => [step.id, new Set(step.dependsOn)]),
  );
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const levels: WorkflowStep[][] = [];
  const placed = new Set<string>();

  while (placed.size < steps.length) {
    const wave = steps.filter(
      (step) =>
        !placed.has(step.id) &&
        [...(remainingDeps.get(step.id) ?? [])].every((dep) => placed.has(dep)),
    );
    if (wave.length === 0) {
      const stuck = steps
        .filter((step) => !placed.has(step.id))
        .map((step) => step.id)
        .join(", ");
      throw new WorkflowValidationError(`dependency cycle involving: ${stuck}`);
    }
    for (const step of wave) {
      placed.add(step.id);
    }
    levels.push(wave.map((step) => stepById.get(step.id) as WorkflowStep));
  }
  return levels;
}

/** All step ids reachable via dependsOn edges, per step. */
function transitiveUpstream(
  steps: readonly WorkflowStep[],
): Map<string, Set<string>> {
  const direct = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const closure = new Map<string, Set<string>>();
  const visit = (id: string): Set<string> => {
    const cached = closure.get(id);
    if (cached) {
      return cached;
    }
    const acc = new Set<string>();
    closure.set(id, acc); // pre-set breaks cycles; real cycles fail elsewhere
    for (const dep of direct.get(id) ?? []) {
      acc.add(dep);
      for (const upstream of visit(dep)) {
        acc.add(upstream);
      }
    }
    return acc;
  };
  for (const step of steps) {
    visit(step.id);
  }
  return closure;
}

export function templateVariables(task: string): Set<string> {
  const names = new Set<string>();
  for (const match of task.matchAll(TEMPLATE_VAR_RE)) {
    const name = match[1];
    if (name) {
      names.add(name);
    }
  }
  return names;
}

export function renderTemplate(
  task: string,
  context: Map<string, string>,
): string {
  return task.replace(TEMPLATE_VAR_RE, (_match, name: string) => {
    const value = context.get(name);
    if (value === undefined) {
      throw new Error(`template variable has no value: {{${name}}}`);
    }
    return value;
  });
}

/** Merge run inputs over declared defaults; reject missing/unknown values. */
function resolveRunInputs(
  workflow: Pick<TeamWorkflow, "inputs">,
  provided: Record<string, string>,
): Map<string, string> {
  const declared = new Set(workflow.inputs.map((input) => input.name));
  for (const key of Object.keys(provided)) {
    if (!declared.has(key)) {
      throw new WorkflowInputError(`unknown input: ${key}`);
    }
  }
  const context = new Map<string, string>();
  for (const input of workflow.inputs) {
    const value = provided[input.name] ?? input.default;
    if (value === undefined) {
      if (input.required) {
        throw new WorkflowInputError(`missing required input: ${input.name}`);
      }
      continue;
    }
    context.set(input.name, value);
  }
  return context;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
