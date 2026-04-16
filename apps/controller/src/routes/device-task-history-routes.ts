import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  deviceTaskHistoryEntrySchema,
  deviceTaskHistoryListResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const taskIdParamSchema = z.object({ taskId: z.string() });
const errorSchema = z.object({ message: z.string() });

export function registerDeviceTaskHistoryRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/devices/tasks",
      tags: ["Device Control"],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: deviceTaskHistoryListResponseSchema,
            },
          },
          description: "Task history (newest first, max 200)",
        },
      },
    }),
    async (c) => {
      const entries = await container.deviceTaskHistoryStore.list();
      return c.json({ entries }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/devices/tasks/{taskId}",
      tags: ["Device Control"],
      request: { params: taskIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: deviceTaskHistoryEntrySchema },
          },
          description: "Task history entry",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Task not found in history",
        },
      },
    }),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const entry = await container.deviceTaskHistoryStore.getByTaskId(taskId);
      if (entry === null) {
        return c.json({ message: "Task not found in history" }, 404);
      }
      return c.json(entry, 200);
    },
  );
}
