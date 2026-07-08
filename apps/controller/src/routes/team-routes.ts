import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  autoRunTeamTaskRequestSchema,
  createTeamRequestSchema,
  createTeamResponseSchema,
  deleteTeamResponseSchema,
  runAutoTeamTaskResponseSchema,
  runTeamTaskRequestSchema,
  runTeamTaskResponseSchema,
  teamBoardResponseSchema,
  teamListResponseSchema,
  teamResponseSchema,
  updateTeamRequestSchema,
  updateTeamResponseSchema,
} from "@nexu/shared";
import {
  TeamAssigneeNotMemberError,
  TeamMemberNotInstalledError,
  TeamNotFoundError,
  type TeamService,
} from "../services/teams/team-service.js";
import {
  type TeamWorkflowService,
  WorkflowInputError,
  WorkflowValidationError,
} from "../services/teams/team-workflow-service.js";

export type TeamRoutesDeps = {
  teamService: Pick<
    TeamService,
    | "listTeams"
    | "getTeam"
    | "getBoard"
    | "createTeam"
    | "updateTeam"
    | "deleteTeam"
    | "runTask"
    | "ensureDefaultTeam"
  >;
  teamWorkflowService: Pick<TeamWorkflowService, "autoComposeAndRun">;
};

/**
 * Compose/validation failures from the DAG engine (bad LLM draft, cycle,
 * dangling {{var}}, unknown dep/member, or a required input the ephemeral run
 * cannot supply) plus member-install failures during enrollment — all
 * client-facing "no usable plan" outcomes, mapped to 400.
 */
function isAutoRunBadRequest(error: unknown): boolean {
  return (
    error instanceof WorkflowValidationError ||
    error instanceof WorkflowInputError ||
    error instanceof TeamMemberNotInstalledError
  );
}

const errorSchema = z.object({ message: z.string() });
const teamIdParamSchema = z.object({ id: z.string().min(1) });

/**
 * Team HTTP routes. Mounted at `/api/v1/teams`. Phase 1 surface: CRUD plus a
 * `run` endpoint that decomposes a task into member-assigned Workboard cards
 * and dispatches workers (see TeamService).
 */
export function buildTeamRoutes(deps: TeamRoutesDeps) {
  const app = new OpenAPIHono();

  // GET /teams
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["Teams"],
      responses: {
        200: {
          content: { "application/json": { schema: teamListResponseSchema } },
          description: "List of teams",
        },
      },
    }),
    async (c) => {
      return c.json({ teams: deps.teamService.listTeams() }, 200);
    },
  );

  // POST /teams
  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["Teams"],
      request: {
        body: {
          content: { "application/json": { schema: createTeamRequestSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: createTeamResponseSchema } },
          description: "Team created",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "A member expert is not installed",
        },
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      try {
        const team = await deps.teamService.createTeam(input);
        return c.json(team, 200);
      } catch (error) {
        if (error instanceof TeamMemberNotInstalledError) {
          return c.json({ message: error.message }, 400);
        }
        throw error;
      }
    },
  );

  // POST /teams/default/run-auto — teamless dispatch onto the lazily-created
  // default team, planning against the whole expert catalog. Registered
  // before the /{id} routes so the static segment wins the match.
  app.openapi(
    createRoute({
      method: "post",
      path: "/default/run-auto",
      tags: ["Teams"],
      request: {
        body: {
          content: {
            "application/json": { schema: autoRunTeamTaskRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: runAutoTeamTaskResponseSchema },
          },
          description:
            "Task auto-composed into a DAG and run on the default team",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "No usable plan could be produced",
        },
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      try {
        const team = await deps.teamService.ensureDefaultTeam();
        const result = await deps.teamWorkflowService.autoComposeAndRun(
          team.id,
          input.task,
        );
        return c.json({ ...result, teamId: team.id }, 200);
      } catch (error) {
        if (isAutoRunBadRequest(error)) {
          return c.json({ message: (error as Error).message }, 400);
        }
        throw error;
      }
    },
  );

  // GET /teams/{id}
  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["Teams"],
      request: { params: teamIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: teamResponseSchema } },
          description: "Team detail",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const team = deps.teamService.getTeam(id);
      if (!team) {
        return c.json({ message: "Team not found" }, 404);
      }
      return c.json(team, 200);
    },
  );

  // PATCH /teams/{id} — rename and/or replace the member set
  app.openapi(
    createRoute({
      method: "patch",
      path: "/{id}",
      tags: ["Teams"],
      request: {
        params: teamIdParamSchema,
        body: {
          content: { "application/json": { schema: updateTeamRequestSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: updateTeamResponseSchema } },
          description: "Team updated",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "A member expert could not be installed",
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
        const team = await deps.teamService.updateTeam(id, input);
        return c.json(team, 200);
      } catch (error) {
        if (error instanceof TeamNotFoundError) {
          return c.json({ message: error.message }, 404);
        }
        if (error instanceof TeamMemberNotInstalledError) {
          return c.json({ message: error.message }, 400);
        }
        throw error;
      }
    },
  );

  // GET /teams/{id}/board — live Workboard snapshot for the Kanban view
  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}/board",
      tags: ["Teams"],
      request: { params: teamIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: teamBoardResponseSchema },
          },
          description: "Team board cards",
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
        const board = await deps.teamService.getBoard(id);
        return c.json(board, 200);
      } catch (error) {
        if (error instanceof TeamNotFoundError) {
          return c.json({ message: error.message }, 404);
        }
        throw error;
      }
    },
  );

  // DELETE /teams/{id}
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["Teams"],
      request: { params: teamIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: deleteTeamResponseSchema } },
          description: "Team deleted",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Team not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const removed = await deps.teamService.deleteTeam(id);
      if (!removed) {
        return c.json({ message: "Team not found" }, 404);
      }
      return c.json({ ok: true as const }, 200);
    },
  );

  // POST /teams/{id}/run
  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/run",
      tags: ["Teams"],
      request: {
        params: teamIdParamSchema,
        body: {
          content: { "application/json": { schema: runTeamTaskRequestSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: runTeamTaskResponseSchema },
          },
          description: "Task decomposed and dispatched",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "A subtask assignee is not a team member",
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
        const result = await deps.teamService.runTask(id, input);
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof TeamNotFoundError) {
          return c.json({ message: error.message }, 404);
        }
        if (error instanceof TeamAssigneeNotMemberError) {
          return c.json({ message: error.message }, 400);
        }
        throw error;
      }
    },
  );

  // POST /teams/{id}/run-auto — lead decomposes the task automatically
  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/run-auto",
      tags: ["Teams"],
      request: {
        params: teamIdParamSchema,
        body: {
          content: {
            "application/json": { schema: autoRunTeamTaskRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: runAutoTeamTaskResponseSchema },
          },
          description: "Task auto-composed into a DAG and run",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "The task could not be composed into a usable plan",
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
        const result = await deps.teamWorkflowService.autoComposeAndRun(
          id,
          input.task,
        );
        return c.json({ ...result, teamId: id }, 200);
      } catch (error) {
        if (error instanceof TeamNotFoundError) {
          return c.json({ message: error.message }, 404);
        }
        if (isAutoRunBadRequest(error)) {
          return c.json({ message: (error as Error).message }, 400);
        }
        throw error;
      }
    },
  );

  return app;
}
