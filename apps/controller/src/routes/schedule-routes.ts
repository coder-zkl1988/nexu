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
  // Reported by nexu-toolcall-guard when it refuses host execution to an
  // automation run. The guard knows the tool was blocked; only the controller
  // knows which schedule that session belongs to and how to surface it.
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/runtime/host-execution-blocked",
      tags: ["Runtime Operations", "Internal"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                sessionKey: z.string().min(1),
                toolName: z.string().min(1),
                reason: z.string().min(1),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ recorded: z.boolean() }),
            },
          },
          description: "Block recorded against the owning schedule, if any",
        },
      },
    }),
    async (c) => {
      const { sessionKey, toolName, reason } = c.req.valid("json");
      // openclaw-cron-gateway mints `agent:<botId>:schedule-<scheduleId>`.
      const match = /^agent:[^:]+:schedule-(.+)$/.exec(sessionKey);
      if (!match?.[1]) return c.json({ recorded: false }, 200);

      const updated =
        await container.configStore.recordScheduleHostExecutionBlock(match[1], {
          at: new Date().toISOString(),
          toolName,
          reason,
        });
      return c.json({ recorded: updated !== null }, 200);
    },
  );

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
    // Isolated cron runs: identifies the per-run transcript (see cron gateway).
    sessionKey: z.string().optional(),
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

  // Conversation transcript of one automation run. OpenClaw >=2026.7 keys
  // isolated cron run transcripts per run and never surfaces them as
  // regular sessions, so the run history is the only place they are
  // reachable from.
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/schedules/{scheduleId}/runs/{ts}/messages",
      tags: ["Schedules"],
      request: {
        params: scheduleIdParamSchema.extend({
          ts: z.coerce.number().int(),
        }),
        query: z.object({
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                messages: z.array(
                  z.object({
                    id: z.string(),
                    role: z.enum(["user", "assistant", "toolResult"]),
                    content: z.unknown(),
                    timestamp: z.number().nullable(),
                    createdAt: z.string().nullable(),
                    aborted: z.boolean().optional(),
                    failed: z.boolean().optional(),
                    toolName: z.string().optional(),
                    toolCallId: z.string().optional(),
                  }),
                ),
                sessionKey: z.string(),
              }),
            },
          },
          description: "Run conversation transcript",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description:
            "Schedule or run not found, or the run transcript is no longer retained",
        },
      },
    }),
    async (c) => {
      const { scheduleId, ts } = c.req.valid("param");
      const { limit } = c.req.valid("query");
      const result = await container.scheduleService.getRunTranscript(
        scheduleId,
        ts,
        limit,
      );
      if (!result) {
        return c.json({ message: "Run transcript not available" }, 404);
      }
      return c.json(result, 200);
    },
  );
}
