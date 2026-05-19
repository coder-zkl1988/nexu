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
}
