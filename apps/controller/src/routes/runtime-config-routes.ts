import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { ControllerContainer } from "../app/container.js";
import { getLocalIp } from "../lib/local-ip.js";
import { LocalAutomationUnavailableError } from "../services/local-automation-service.js";
import {
  controllerRuntimeConfigSchema,
  deviceControlConfigSchema,
  localAutomationConfigSchema,
} from "../store/schemas.js";
import type { ControllerBindings } from "../types.js";

const localAutomationStatusSchema = z.object({
  previewEnabled: z.boolean(),
  computerUseAvailable: z.boolean(),
  // Preserve null in the generated SDK while the Hono generator emits an OAS 3.1 document.
  computerUseUnavailableReason: z
    .enum(["missing-sidecar", "unsupported-os"])
    .nullable()
    .openapi({
      type: ["string", "null"],
      enum: ["missing-sidecar", "unsupported-os", null],
    }),
  computerUseBinaryPath: z
    .string()
    .nullable()
    .openapi({ type: ["string", "null"] }),
  computerUseBackend: z
    .enum(["cua-driver"])
    .nullable()
    .openapi({
      type: ["string", "null"],
      enum: ["cua-driver", null],
    }),
  computerUsePermissionState: z.enum([
    "ready",
    "permission-required",
    "unavailable",
    "unknown",
    "disabled",
  ]),
  computerUsePermissions: z.array(
    z.object({
      name: z.string(),
      granted: z.boolean(),
      required: z.boolean(),
    }),
  ),
});

const runtimeConfigEnvelopeSchema = z.object({
  runtime: controllerRuntimeConfigSchema,
  deviceControl: deviceControlConfigSchema,
  localAutomation: localAutomationConfigSchema,
  localAutomationStatus: localAutomationStatusSchema,
});

const runtimeConfigPutEnvelopeSchema = z.object({
  runtime: controllerRuntimeConfigSchema,
});

const hostStatusResponseSchema = z.object({
  connected: z.boolean(),
  machineName: z.string().optional(),
  hostname: z.string().optional(),
  platform: z.string().optional(),
  arch: z.string().optional(),
  osLabel: z.string().optional(),
  nodeVersion: z.string().optional(),
  uptimeMs: z.number().optional(),
  cpuCount: z.number().optional(),
  cpuModel: z.string().optional(),
  loadAverage: z.array(z.number()).optional(),
  memoryTotalBytes: z.number().optional(),
  memoryFreeBytes: z.number().optional(),
  diskTotalBytes: z.number().optional(),
  diskAvailableBytes: z.number().optional(),
  diskPath: z.string().optional(),
});

function assertJsonContentType(contentType: string | undefined): void {
  if (!contentType?.trim().toLowerCase().startsWith("application/json")) {
    throw new HTTPException(415, {
      message: "Content-Type must be application/json",
    });
  }
}

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
      const [runtime, deviceControl, localAutomation] = await Promise.all([
        container.runtimeConfigService.getRuntimeConfig(),
        container.configStore.getDeviceControlConfig(),
        container.configStore.getLocalAutomationConfig(),
      ]);
      const localAutomationStatus =
        await container.localAutomationService.getStatus(localAutomation);
      return c.json(
        {
          runtime,
          deviceControl: { ...deviceControl, localIp: getLocalIp() },
          localAutomation,
          localAutomationStatus,
        },
        200,
      );
    },
  );

  const localAutomationPatchSchema = z.object({
    browser: z.object({ enabled: z.boolean() }).optional(),
    computerUse: z.object({ enabled: z.boolean() }).optional(),
  });

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/runtime-config/local-automation",
      tags: ["Runtime Config"],
      request: {
        body: {
          content: {
            "application/json": { schema: localAutomationPatchSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                localAutomation: localAutomationConfigSchema,
              }),
            },
          },
          description: "Updated local automation settings",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const localAutomation =
          await container.localAutomationService.updateConfig(body);
        return c.json({ localAutomation }, 200);
      } catch (error: unknown) {
        if (error instanceof LocalAutomationUnavailableError) {
          throw new HTTPException(409, { message: error.message });
        }
        throw error;
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/runtime-config/local-automation/computer-use/permissions",
      tags: ["Runtime Config"],
      request: {
        body: {
          content: { "application/json": { schema: z.object({}) } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ requested: z.literal(true) }),
            },
          },
          description: "Requested the platform grants Computer Use needs",
        },
      },
    }),
    async (c) => {
      assertJsonContentType(c.req.header("content-type"));
      c.req.valid("json");
      try {
        await container.localAutomationService.requestComputerUsePermissions();
        return c.json({ requested: true as const }, 200);
      } catch (error: unknown) {
        if (error instanceof LocalAutomationUnavailableError) {
          throw new HTTPException(409, { message: error.message });
        }
        throw error;
      }
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

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/runtime/host-status",
      tags: ["Runtime Config"],
      responses: {
        200: {
          content: {
            "application/json": { schema: hostStatusResponseSchema },
          },
          description:
            "Runtime host status (CPU/memory/disk/uptime) from OpenClaw system.info",
        },
      },
    }),
    async (c) => {
      if (!container.gatewayService.isConnected()) {
        return c.json({ connected: false }, 200);
      }
      try {
        const info = await container.gatewayService.systemInfo();
        const parsed = hostStatusResponseSchema
          .omit({ connected: true })
          .partial()
          .safeParse(info);
        return c.json(
          { connected: true, ...(parsed.success ? parsed.data : {}) },
          200,
        );
      } catch {
        return c.json({ connected: false }, 200);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/tts/speak",
      tags: ["Runtime Config"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ text: z.string().min(1).max(4000) }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                audioBase64: z.string(),
                mimeType: z.string(),
                provider: z.string().optional(),
              }),
            },
          },
          description: "Synthesized speech audio (OpenClaw tts.speak)",
        },
        409: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description:
            "TTS unavailable (no provider configured / synth failed)",
        },
      },
    }),
    async (c) => {
      const { text } = c.req.valid("json");
      if (!container.gatewayService.isConnected()) {
        return c.json({ message: "OpenClaw gateway is not connected" }, 409);
      }
      try {
        const result = await container.gatewayService.ttsSpeak(text);
        if (!result.audioBase64) {
          return c.json({ message: "TTS synthesis returned no audio" }, 409);
        }
        return c.json(
          {
            audioBase64: result.audioBase64,
            mimeType: result.mimeType ?? "audio/mpeg",
            ...(result.provider ? { provider: result.provider } : {}),
          },
          200,
        );
      } catch (err) {
        return c.json(
          { message: err instanceof Error ? err.message : String(err) },
          409,
        );
      }
    },
  );
}
