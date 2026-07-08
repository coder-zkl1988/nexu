import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  approveWorkflowStepResponseSchema,
  composeTeamWorkflowRequestSchema,
  composeTeamWorkflowResponseSchema,
  createTeamWorkflowRequestSchema,
  deleteTeamWorkflowResponseSchema,
  instantiateTeamWorkflowRequestSchema,
  pendingWorkflowApprovalListResponseSchema,
  runTeamWorkflowRequestSchema,
  runTeamWorkflowResponseSchema,
  teamWorkflowListResponseSchema,
  teamWorkflowSchema,
  teamWorkflowTemplateListResponseSchema,
  updateTeamWorkflowRequestSchema,
} from "@nexu/shared";
import { TeamNotFoundError } from "../services/teams/team-service.js";
import {
  type TeamWorkflowService,
  WorkflowApprovalNotFoundError,
  WorkflowInputError,
  WorkflowNotFoundError,
  WorkflowTemplateNotFoundError,
  WorkflowValidationError,
} from "../services/teams/team-workflow-service.js";
import { teamRunUpstreamFailure } from "./team-route-helpers.js";

export type TeamWorkflowRoutesDeps = {
  teamWorkflowService: Pick<
    TeamWorkflowService,
    | "listWorkflows"
    | "getWorkflow"
    | "createWorkflow"
    | "updateWorkflow"
    | "deleteWorkflow"
    | "runWorkflow"
    | "listTemplates"
    | "instantiateTemplate"
    | "composeWorkflow"
    | "listPendingApprovals"
    | "approveStep"
  >;
};

const errorSchema = z.object({ message: z.string() });
const teamIdParamSchema = z.object({ id: z.string().min(1) });
const workflowParamSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1),
});

function isNotFound(error: unknown): boolean {
  return (
    error instanceof TeamNotFoundError ||
    error instanceof WorkflowNotFoundError ||
    error instanceof WorkflowTemplateNotFoundError ||
    error instanceof WorkflowApprovalNotFoundError
  );
}

function isBadRequest(error: unknown): boolean {
  return (
    error instanceof WorkflowValidationError ||
    error instanceof WorkflowInputError
  );
}

/**
 * Team workflow (SOP) HTTP routes. Mounted at `/api/v1/teams` alongside the
 * team CRUD routes: declarative workflow definitions plus a `run` endpoint
 * that materializes a Workboard run and returns immediately (progress is
 * observable via GET /teams/{id}/board).
 */
export function buildTeamWorkflowRoutes(deps: TeamWorkflowRoutesDeps) {
  const app = new OpenAPIHono();

  // GET /teams/{id}/workflows
  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}/workflows",
      tags: ["Teams"],
      request: { params: teamIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: teamWorkflowListResponseSchema },
          },
          description: "Workflows owned by the team",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      try {
        return c.json(
          { workflows: deps.teamWorkflowService.listWorkflows(id) },
          200,
        );
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        throw error;
      }
    },
  );

  // POST /teams/{id}/workflows
  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/workflows",
      tags: ["Teams"],
      request: {
        params: teamIdParamSchema,
        body: {
          content: {
            "application/json": { schema: createTeamWorkflowRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: teamWorkflowSchema } },
          description: "Workflow created",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid workflow definition",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      try {
        const workflow = await deps.teamWorkflowService.createWorkflow(
          id,
          input,
        );
        return c.json(workflow, 200);
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        if (isBadRequest(error)) {
          return c.json({ message: (error as Error).message }, 400);
        }
        throw error;
      }
    },
  );

  // GET /teams/{id}/workflows/{workflowId}
  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}/workflows/{workflowId}",
      tags: ["Teams"],
      request: { params: workflowParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: teamWorkflowSchema } },
          description: "Workflow detail",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team or workflow not found",
        },
      },
    }),
    async (c) => {
      const { id, workflowId } = c.req.valid("param");
      try {
        return c.json(
          deps.teamWorkflowService.getWorkflow(id, workflowId),
          200,
        );
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        throw error;
      }
    },
  );

  // PATCH /teams/{id}/workflows/{workflowId}
  app.openapi(
    createRoute({
      method: "patch",
      path: "/{id}/workflows/{workflowId}",
      tags: ["Teams"],
      request: {
        params: workflowParamSchema,
        body: {
          content: {
            "application/json": { schema: updateTeamWorkflowRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: teamWorkflowSchema } },
          description: "Workflow updated",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid workflow definition",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team or workflow not found",
        },
      },
    }),
    async (c) => {
      const { id, workflowId } = c.req.valid("param");
      const patch = c.req.valid("json");
      try {
        const workflow = await deps.teamWorkflowService.updateWorkflow(
          id,
          workflowId,
          patch,
        );
        return c.json(workflow, 200);
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        if (isBadRequest(error)) {
          return c.json({ message: (error as Error).message }, 400);
        }
        throw error;
      }
    },
  );

  // DELETE /teams/{id}/workflows/{workflowId}
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{id}/workflows/{workflowId}",
      tags: ["Teams"],
      request: { params: workflowParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: deleteTeamWorkflowResponseSchema },
          },
          description: "Workflow deleted",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team or workflow not found",
        },
      },
    }),
    async (c) => {
      const { id, workflowId } = c.req.valid("param");
      try {
        await deps.teamWorkflowService.deleteWorkflow(id, workflowId);
        return c.json({ ok: true as const }, 200);
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        throw error;
      }
    },
  );

  // POST /teams/{id}/workflows/{workflowId}/run
  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/workflows/{workflowId}/run",
      tags: ["Teams"],
      request: {
        params: workflowParamSchema,
        body: {
          content: {
            "application/json": { schema: runTeamWorkflowRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: runTeamWorkflowResponseSchema },
          },
          description: "Run materialized; execution continues in background",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid inputs or stale workflow definition",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team or workflow not found",
        },
        502: {
          content: { "application/json": { schema: errorSchema } },
          description: "Upstream run/compose failure",
        },
      },
    }),
    async (c) => {
      const { id, workflowId } = c.req.valid("param");
      const input = c.req.valid("json");
      try {
        const result = await deps.teamWorkflowService.runWorkflow(
          id,
          workflowId,
          input,
        );
        return c.json(result, 200);
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        if (isBadRequest(error)) {
          return c.json({ message: (error as Error).message }, 400);
        }
        return c.json(teamRunUpstreamFailure(error), 502);
      }
    },
  );

  // POST /teams/{id}/workflows/from-template — copy a starter SOP onto the
  // team (auto-adding any experts it needs). Static segment, so it never
  // collides with the {workflowId} param routes (those have no POST).
  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/workflows/from-template",
      tags: ["Teams"],
      request: {
        params: teamIdParamSchema,
        body: {
          content: {
            "application/json": {
              schema: instantiateTeamWorkflowRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: teamWorkflowSchema } },
          description: "Template instantiated as a team workflow",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Template invalid for this team",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team or template not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { templateId } = c.req.valid("json");
      try {
        const workflow = await deps.teamWorkflowService.instantiateTemplate(
          id,
          templateId,
        );
        return c.json(workflow, 200);
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        if (isBadRequest(error)) {
          return c.json({ message: (error as Error).message }, 400);
        }
        throw error;
      }
    },
  );

  // POST /teams/{id}/workflows/compose — one-sentence auto-compose. Returns
  // a draft (NOT saved); the user reviews and saves via POST /workflows.
  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/workflows/compose",
      tags: ["Teams"],
      request: {
        params: teamIdParamSchema,
        body: {
          content: {
            "application/json": { schema: composeTeamWorkflowRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: composeTeamWorkflowResponseSchema },
          },
          description: "Composed draft workflow (not persisted)",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "The model could not produce a sound workflow",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team not found",
        },
        502: {
          content: { "application/json": { schema: errorSchema } },
          description: "Upstream run/compose failure",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { description } = c.req.valid("json");
      try {
        const result = await deps.teamWorkflowService.composeWorkflow(
          id,
          description,
        );
        return c.json(result, 200);
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        if (isBadRequest(error)) {
          return c.json({ message: (error as Error).message }, 400);
        }
        return c.json(teamRunUpstreamFailure(error), 502);
      }
    },
  );

  // GET /teams/{id}/workflow-approvals — runs paused on an approval step.
  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}/workflow-approvals",
      tags: ["Teams"],
      request: { params: teamIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: pendingWorkflowApprovalListResponseSchema,
            },
          },
          description: "Pending workflow approvals for the team",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      try {
        return c.json(
          { approvals: deps.teamWorkflowService.listPendingApprovals(id) },
          200,
        );
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        throw error;
      }
    },
  );

  // POST /teams/{id}/workflows/{workflowId}/runs/{runId}/steps/{stepId}/approve
  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/workflows/{workflowId}/runs/{runId}/steps/{stepId}/approve",
      tags: ["Teams"],
      request: {
        params: workflowParamSchema.extend({
          runId: z.string().min(1),
          stepId: z.string().min(1),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: approveWorkflowStepResponseSchema },
          },
          description: "Run released past the approval step",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "No pending approval for this run step",
        },
      },
    }),
    async (c) => {
      const { id, workflowId, runId, stepId } = c.req.valid("param");
      try {
        await deps.teamWorkflowService.approveStep(
          id,
          workflowId,
          runId,
          stepId,
        );
        return c.json({ ok: true as const }, 200);
      } catch (error) {
        if (isNotFound(error)) {
          return c.json({ message: (error as Error).message }, 404);
        }
        throw error;
      }
    },
  );

  return app;
}

/**
 * Template catalog routes. Mounted at `/api/v1/team-workflow-templates` —
 * kept off the `/teams` base so the listing path can't be shadowed by the
 * `/{id}` param routes.
 */
export function buildTeamWorkflowTemplateRoutes(deps: TeamWorkflowRoutesDeps) {
  const app = new OpenAPIHono();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["Teams"],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: teamWorkflowTemplateListResponseSchema,
            },
          },
          description: "Shipped starter SOP templates",
        },
      },
    }),
    async (c) => {
      return c.json(
        { templates: deps.teamWorkflowService.listTemplates() },
        200,
      );
    },
  );

  return app;
}
