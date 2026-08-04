import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createScheduleSchema,
  scheduleListResponseSchema,
  scheduleResponseSchema,
  updateScheduleSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const scheduleIdParamSchema = z.object({ scheduleId: z.string() });
const errorSchema = z.object({ message: z.string() });

export function registerScheduleRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/schedules",
      tags: ["Schedules"],
      responses: {
        200: {
          content: {
            "application/json": { schema: scheduleListResponseSchema },
          },
          description: "Schedule list",
        },
      },
    }),
    async (c) =>
      c.json(
        { schedules: await container.scheduleService.listSchedules() },
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/schedules",
      tags: ["Schedules"],
      request: {
        body: {
          content: { "application/json": { schema: createScheduleSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: scheduleResponseSchema },
          },
          description: "Created",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Notification delivery target unavailable",
        },
        502: {
          content: { "application/json": { schema: errorSchema } },
          description: "OpenClaw schedule registration failed",
        },
      },
    }),
    async (c) =>
      c.json(
        await container.scheduleService.createSchedule(c.req.valid("json")),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/schedules/{scheduleId}",
      tags: ["Schedules"],
      request: {
        params: scheduleIdParamSchema,
        body: {
          content: { "application/json": { schema: updateScheduleSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: scheduleResponseSchema },
          },
          description: "Updated",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not found",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Notification delivery target unavailable",
        },
        502: {
          content: { "application/json": { schema: errorSchema } },
          description: "OpenClaw schedule update failed",
        },
      },
    }),
    async (c) => {
      const { scheduleId } = c.req.valid("param");
      const schedule = await container.scheduleService.updateSchedule(
        scheduleId,
        c.req.valid("json"),
      );
      if (schedule === null) {
        return c.json({ message: "Schedule not found" }, 404);
      }
      return c.json(schedule, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/schedules/{scheduleId}",
      tags: ["Schedules"],
      request: { params: scheduleIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ success: z.boolean() }) },
          },
          description: "Deleted",
        },
      },
    }),
    async (c) => {
      const { scheduleId } = c.req.valid("param");
      const success =
        await container.scheduleService.deleteSchedule(scheduleId);
      return c.json({ success }, 200);
    },
  );

  const scheduleRunSchema = z.object({
    ts: z.number(),
    jobId: z.string(),
    action: z.literal("finished"),
    status: z.enum(["ok", "error", "skipped"]).optional(),
    error: z.string().optional(),
    summary: z.string().optional(),
    runAtMs: z.number().optional(),
    durationMs: z.number().optional(),
    nextRunAtMs: z.number().optional(),
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/schedules/{scheduleId}/runs",
      tags: ["Schedules"],
      request: {
        params: scheduleIdParamSchema,
        query: z.object({
          limit: z.coerce.number().min(1).max(100).default(20),
          offset: z.coerce.number().min(0).default(0),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                entries: z.array(scheduleRunSchema),
                total: z.number(),
                hasMore: z.boolean(),
              }),
            },
          },
          description: "Schedule run history",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Schedule not found or no cron job registered",
        },
      },
    }),
    async (c) => {
      const { scheduleId } = c.req.valid("param");
      const { limit, offset } = c.req.valid("query");
      const result = await container.scheduleService.listRuns(scheduleId, {
        limit,
        offset,
      });
      if (!result) {
        return c.json({ message: "Schedule not found" }, 404);
      }
      return c.json(result, 200);
    },
  );
}
