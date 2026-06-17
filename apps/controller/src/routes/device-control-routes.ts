import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  cancelTaskResponseSchema,
  deviceExecuteTaskBodySchema,
  deviceExecuteTaskResponseSchema,
  deviceInfoSchema,
  deviceListResponseSchema,
  devicePushMediaBodySchema,
  devicePushMediaResponseSchema,
  deviceRenameBodySchema,
} from "@nexu/shared";
import { streamSSE } from "hono/streaming";
import type { ControllerContainer } from "../app/container.js";
import { DeviceControlRpcError } from "../services/device-control-service.js";
import {
  type DeviceChangeEvent,
  deviceEventEmitter,
} from "../services/device-event-emitter.js";
import type { ControllerBindings } from "../types.js";

const deviceIdParamSchema = z.object({ deviceId: z.string() });
const taskIdParamSchema = z.object({
  deviceId: z.string(),
  taskId: z.string(),
});
const renameParamSchema = z.object({ deviceId: z.string() });
const errorSchema = z.object({ message: z.string() });

function mapRpcErrorToStatus(err: unknown): {
  status: 404 | 503 | 504 | 500;
  message: string;
} {
  if (err instanceof DeviceControlRpcError) {
    if (err.code === "DEVICE_NOT_FOUND") {
      return { status: 404, message: err.message };
    }
    if (err.code === "DEVICE_OFFLINE") {
      return { status: 503, message: err.message };
    }
    if (err.code === "TIMEOUT") {
      return { status: 504, message: err.message };
    }
    return { status: 500, message: err.message };
  }
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return { status: 504, message: "Device control request timed out" };
  }
  return {
    status: 500,
    message: err instanceof Error ? err.message : "Unknown error",
  };
}

export function registerDeviceControlRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  // ── Non-OpenAPI endpoints (SSE + internal webhook) ──────────────────────────

  // GET /api/v1/devices/stream — SSE for real-time device list updates
  app.get("/api/v1/devices/stream", async (c) => {
    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      await stream.writeSSE({ data: "connected", event: "connected" });

      // Send initial device list
      if (await container.deviceControlService.isAvailable()) {
        try {
          const list = await container.deviceControlService.listDevices();
          const devices = list.devices.map((d) => ({
            ...d,
            name: container.deviceNameStore.get(d.deviceId) ?? d.name,
          }));
          await stream.writeSSE({
            data: JSON.stringify({ type: "device_list", devices }),
            event: "device_list",
          });
        } catch {
          /* ignore */
        }
      }

      // Listen for changes — broadcast immediately without re-checking
      // isAvailable(). The polling service already gates events on availability.
      const unsub = deviceEventEmitter.onChange(async (event) => {
        if (aborted) return;
        try {
          await stream.writeSSE({
            data: JSON.stringify({
              type: event.type,
              deviceId: event.deviceId,
            }),
            event: event.type,
          });
        } catch {
          /* ignore — likely client disconnected */
        }
      });

      // Keep-alive ping every 15s
      while (!aborted) {
        await stream.writeSSE({ data: "ping", event: "ping" });
        await stream.sleep(15_000);
      }

      unsub();
    });
  });

  // POST /api/v1/devices/_internal/webhook — internal webhook for tabby-control
  app.post("/api/v1/devices/_internal/webhook", async (c) => {
    const body = await c.req.json<{ type: string; deviceId: string }>();
    if (body.type && body.deviceId) {
      deviceEventEmitter.emitChange({
        type: body.type as DeviceChangeEvent["type"],
        deviceId: body.deviceId,
      });
    }
    return c.json({ ok: true });
  });

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
        return c.json({ message: "Device control plugin is not running" }, 503);
      }

      const list = await container.deviceControlService.listDevices();
      return c.json(
        {
          devices: list.devices.map((d) => ({
            ...d,
            name: container.deviceNameStore.get(d.deviceId) ?? d.name,
          })),
        },
        200,
      );
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

      return c.json(
        {
          ...device,
          name: container.deviceNameStore.get(deviceId) ?? device.name,
        },
        200,
      );
    },
  );

  // PATCH /api/v1/devices/{deviceId} — rename device
  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/devices/{deviceId}",
      tags: ["Device Control"],
      request: {
        params: renameParamSchema,
        body: {
          content: {
            "application/json": { schema: deviceRenameBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: deviceInfoSchema } },
          description: "Device renamed",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device not found",
        },
      },
    }),
    async (c) => {
      const { deviceId } = c.req.valid("param");
      const { name } = c.req.valid("json");
      container.deviceNameStore.set(deviceId, name);
      const device = await container.deviceControlService.getDevice(deviceId);
      if (device === null) {
        return c.json({ message: "Device not found" }, 404);
      }
      return c.json({ ...device, name }, 200);
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
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device not found",
        },
        503: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device control plugin is not running",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Internal error",
        },
        504: {
          content: { "application/json": { schema: errorSchema } },
          description: "Task execution timed out",
        },
      },
    }),
    async (c) => {
      if (!(await container.deviceControlService.isAvailable())) {
        return c.json({ message: "Device control plugin is not running" }, 503);
      }

      const { deviceId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const result = await container.deviceControlService.executeTask(
          deviceId,
          body,
        );
        return c.json(result, 200);
      } catch (err) {
        const mapped = mapRpcErrorToStatus(err);
        return c.json({ message: mapped.message }, mapped.status);
      }
    },
  );

  // POST /api/v1/devices/{deviceId}/media — push images into the gallery
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/devices/{deviceId}/media",
      tags: ["Device Control"],
      request: {
        params: deviceIdParamSchema,
        body: {
          content: {
            "application/json": { schema: devicePushMediaBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: devicePushMediaResponseSchema },
          },
          description: "Per-image push results",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device not found",
        },
        503: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device control plugin is not running",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Internal error",
        },
        504: {
          content: { "application/json": { schema: errorSchema } },
          description: "Media push timed out",
        },
      },
    }),
    async (c) => {
      if (!(await container.deviceControlService.isAvailable())) {
        return c.json({ message: "Device control plugin is not running" }, 503);
      }
      const { deviceId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const result = await container.deviceControlService.pushMedia(
          deviceId,
          body,
        );
        return c.json(result, 200);
      } catch (err) {
        const mapped = mapRpcErrorToStatus(err);
        return c.json({ message: mapped.message }, mapped.status);
      }
    },
  );

  // DELETE /api/v1/devices/{deviceId}/tasks/{taskId} — cancel task
  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/devices/{deviceId}/tasks/{taskId}",
      tags: ["Device Control"],
      request: {
        params: taskIdParamSchema,
      },
      responses: {
        200: {
          content: { "application/json": { schema: cancelTaskResponseSchema } },
          description: "Task cancelled",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device or task not found",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Internal error",
        },
        503: {
          content: { "application/json": { schema: errorSchema } },
          description: "Device offline",
        },
        504: {
          content: { "application/json": { schema: errorSchema } },
          description: "Request timed out",
        },
      },
    }),
    async (c) => {
      const { deviceId, taskId } = c.req.valid("param");
      try {
        const result = await container.deviceControlService.cancelTask(
          deviceId,
          { taskId },
        );
        return c.json(result, 200);
      } catch (err) {
        const mapped = mapRpcErrorToStatus(err);
        return c.json({ message: mapped.message }, mapped.status);
      }
    },
  );
}
