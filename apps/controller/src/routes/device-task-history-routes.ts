import path from "node:path";
import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  deviceTaskHistoryEntrySchema,
  deviceTaskHistoryListResponseSchema,
} from "@nexu/shared";
import { z } from "zod";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const taskIdParamSchema = z.object({ taskId: z.string() });
const errorSchema = z.object({ message: z.string() });

function toMediaUrl(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const filename = path.basename(filePath);
  return `/api/v1/media/screenshots/${filename}`;
}

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
      const rawEntries = await container.deviceTaskHistoryStore.list();
      const entries = rawEntries.map((entry) => ({
        ...entry,
        deviceName: container.deviceNameStore.get(entry.deviceId),
        result: {
          ...entry.result,
          finalScreenshot: toMediaUrl(entry.result.finalScreenshot),
        },
      }));
      return c.json({ entries } as never, 200);
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
      return c.json(
        {
          ...entry,
          deviceName: container.deviceNameStore.get(entry.deviceId),
          result: {
            ...entry.result,
            finalScreenshot: toMediaUrl(entry.result.finalScreenshot),
          },
        } as never,
        200,
      );
    },
  );
}
