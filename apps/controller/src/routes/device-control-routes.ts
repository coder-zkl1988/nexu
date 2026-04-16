import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  cancelTaskBodySchema,
  cancelTaskResponseSchema,
  deviceExecuteTaskBodySchema,
  deviceExecuteTaskResponseSchema,
  deviceInfoSchema,
  deviceListResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const deviceIdParamSchema = z.object({ deviceId: z.string() });
const errorSchema = z.object({ message: z.string() });

export function registerDeviceControlRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  // GET /api/v1/devices — list devices
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/devices",
      tags: ["Device Control"],
      responses: {
        200: {
          content: { "application/json": { schema: deviceListResponseSchema } },
          description: "Device list",
        },
        503: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device control plugin is not running",
        },
      },
    }),
    async (c) => {
      if (!(await container.deviceControlService.isAvailable())) {
        return c.json(
          { message: "Device control plugin is not running" },
          503,
        );
      }

      return c.json(await container.deviceControlService.listDevices(), 200);
    },
  );

  // GET /api/v1/devices/{deviceId} — get device
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/devices/{deviceId}",
      tags: ["Device Control"],
      request: { params: deviceIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: deviceInfoSchema } },
          description: "Device info",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device not found",
        },
      },
    }),
    async (c) => {
      const { deviceId } = c.req.valid("param");
      const device = await container.deviceControlService.getDevice(deviceId);

      if (device === null) {
        return c.json({ message: "Device not found" }, 404);
      }

      return c.json(device, 200);
    },
  );

  // POST /api/v1/devices/{deviceId}/tasks — execute task
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/devices/{deviceId}/tasks",
      tags: ["Device Control"],
      request: {
        params: deviceIdParamSchema,
        body: {
          content: {
            "application/json": { schema: deviceExecuteTaskBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: deviceExecuteTaskResponseSchema },
          },
          description: "Task result",
        },
        503: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device control plugin is not running",
        },
      },
    }),
    async (c) => {
      if (!(await container.deviceControlService.isAvailable())) {
        return c.json(
          { message: "Device control plugin is not running" },
          503,
        );
      }

      const { deviceId } = c.req.valid("param");
      const body = c.req.valid("json");
      const result = await container.deviceControlService.executeTask(
        deviceId,
        body,
      );

      return c.json(result, 200);
    },
  );

  // DELETE /api/v1/devices/{deviceId}/tasks — cancel task
  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/devices/{deviceId}/tasks",
      tags: ["Device Control"],
      request: {
        params: deviceIdParamSchema,
        body: {
          content: {
            "application/json": { schema: cancelTaskBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: cancelTaskResponseSchema } },
          description: "Task cancelled",
        },
      },
    }),
    async (c) => {
      const { deviceId } = c.req.valid("param");
      const body = c.req.valid("json");
      const result = await container.deviceControlService.cancelTask(
        deviceId,
        body,
      );

      return c.json(result, 200);
    },
  );
}
