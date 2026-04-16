import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import {
  controllerRuntimeConfigSchema,
  deviceControlConfigSchema,
} from "../store/schemas.js";
import type { ControllerBindings } from "../types.js";

const runtimeConfigEnvelopeSchema = z.object({
  runtime: controllerRuntimeConfigSchema,
  deviceControl: deviceControlConfigSchema,
});

const runtimeConfigPutEnvelopeSchema = z.object({
  runtime: controllerRuntimeConfigSchema,
});

export function registerRuntimeConfigRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/runtime-config",
      tags: ["Runtime Config"],
      responses: {
        200: {
          content: {
            "application/json": { schema: runtimeConfigEnvelopeSchema },
          },
          description: "Runtime config",
        },
      },
    }),
    async (c) => {
      const [runtime, deviceControl] = await Promise.all([
        container.runtimeConfigService.getRuntimeConfig(),
        container.configStore.getDeviceControlConfig(),
      ]);
      return c.json({ runtime, deviceControl }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/runtime-config",
      tags: ["Runtime Config"],
      request: {
        body: {
          content: {
            "application/json": { schema: controllerRuntimeConfigSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: runtimeConfigPutEnvelopeSchema },
          },
          description: "Updated runtime config",
        },
      },
    }),
    async (c) => {
      const runtime = await container.runtimeConfigService.setRuntimeConfig(
        c.req.valid("json"),
      );
      return c.json({ runtime }, 200);
    },
  );

  const deviceControlPatchSchema = z.object({
    enabled: z.boolean().optional(),
    wsPort: z.number().int().positive().optional(),
    rpcPort: z.number().int().positive().optional(),
  });

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/runtime-config/device-control",
      tags: ["Runtime Config"],
      request: {
        body: {
          content: {
            "application/json": { schema: deviceControlPatchSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ ok: z.boolean() }) },
          },
          description: "Updated",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      await container.configStore.setDeviceControlConfig(body);
      await container.openclawSyncService.syncAll();
      return c.json({ ok: true }, 200);
    },
  );
}
