import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  cloudConnectBodySchema,
  cloudConnectResponseSchema,
  cloudDisconnectResponseSchema,
  cloudModelsBodySchema,
  cloudModelsResponseSchema,
  cloudProfileConnectBodySchema,
  cloudProfileConnectResponseSchema,
  cloudProfileCreateBodySchema,
  cloudProfileCreateResponseSchema,
  cloudProfileDeleteBodySchema,
  cloudProfileDeleteResponseSchema,
  cloudProfileDisconnectBodySchema,
  cloudProfileDisconnectResponseSchema,
  cloudProfileSelectBodySchema,
  cloudProfileSelectResponseSchema,
  cloudProfileUpdateBodySchema,
  cloudProfileUpdateResponseSchema,
  cloudProfilesImportBodySchema,
  cloudProfilesImportResponseSchema,
  cloudRefreshResponseSchema,
  cloudStatusResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const defaultModelBodySchema = z.object({ modelId: z.string() });
const defaultModelResponseSchema = z.object({ modelId: z.string().nullable() });
const defaultModelSetResponseSchema = z.object({
  ok: z.boolean(),
  modelId: z.string(),
  configPushed: z.boolean(),
});
// Empty string clears the utility model (the SDK generator drops `nullable`,
// so null cannot round-trip through the generated client types).
const utilityModelBodySchema = z.object({ modelId: z.string() });
const utilityModelSetResponseSchema = z.object({
  ok: z.boolean(),
  modelId: z.string().nullable(),
  configPushed: z.boolean(),
});
// Phone control VLM (settings page "手机控制模型"). Empty string clears the
// override back to the gateway default (tabby-phone), mirroring utility-model.
const phoneVlmModelBodySchema = z.object({ modelId: z.string() });
const phoneVlmModelResponseSchema = z.object({
  modelId: z.string().nullable(),
});
const phoneVlmModelSetResponseSchema = z.object({
  ok: z.boolean(),
  modelId: z.string().nullable(),
});
const desktopAuthSessionResponseSchema = z.object({
  session: z.object({
    id: z.string(),
    expiresAt: z.string(),
  }),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    image: z.string().nullable(),
  }),
});

export function registerDesktopCompatRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/auth/get-session",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopAuthSessionResponseSchema },
          },
          description: "Desktop-local auth session",
        },
      },
    }),
    async (c) =>
      c.json(
        {
          session: {
            id: "desktop-local-session",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
          user: {
            id: "desktop-local-user",
            email: "desktop@nexu.local",
            name: "Desktop User",
            image: null,
          },
        },
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/cloud-status",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudStatusResponseSchema },
          },
          description: "Cloud status",
        },
      },
    }),
    async (c) =>
      c.json(await container.desktopLocalService.getCloudStatus(), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-connect",
      tags: ["Desktop"],
      request: {
        body: {
          required: false,
          content: {
            "application/json": { schema: cloudConnectBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudConnectResponseSchema },
          },
          description: "Cloud connect",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      return c.json(
        await container.desktopLocalService.connectCloud({
          source: body?.source ?? null,
        }),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-profile/connect",
      tags: ["Desktop"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: cloudProfileConnectBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudProfileConnectResponseSchema },
          },
          description: "Connect cloud profile",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const result = await container.desktopLocalService.connectCloudProfile(
        body.name,
        { source: body.source ?? null },
      );
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ...result, configPushed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-refresh",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudRefreshResponseSchema },
          },
          description: "Cloud refresh",
        },
      },
    }),
    async (c) => {
      const status = await container.desktopLocalService.refreshCloudStatus();
      await container.modelProviderService.ensureValidDefaultModel();
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ...status, configPushed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-profile/create",
      tags: ["Desktop"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: cloudProfileCreateBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudProfileCreateResponseSchema },
          },
          description: "Create cloud profile",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const status = await container.desktopLocalService.createCloudProfile(
        body.profile,
      );
      await container.modelProviderService.ensureValidDefaultModel();
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ok: true, ...status, configPushed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-profile/update",
      tags: ["Desktop"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: cloudProfileUpdateBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudProfileUpdateResponseSchema },
          },
          description: "Update cloud profile",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const status = await container.desktopLocalService.updateCloudProfile(
        body.previousName,
        body.profile,
      );
      await container.modelProviderService.ensureValidDefaultModel();
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ok: true, ...status, configPushed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-profile/delete",
      tags: ["Desktop"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: cloudProfileDeleteBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudProfileDeleteResponseSchema },
          },
          description: "Delete cloud profile",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const status = await container.desktopLocalService.deleteCloudProfile(
        body.name,
      );
      await container.modelProviderService.ensureValidDefaultModel();
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ok: true, ...status, configPushed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-disconnect",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudDisconnectResponseSchema },
          },
          description: "Cloud disconnect",
        },
      },
    }),
    async (c) =>
      c.json(await container.desktopLocalService.disconnectCloud(), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-profile/disconnect",
      tags: ["Desktop"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: cloudProfileDisconnectBodySchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: cloudProfileDisconnectResponseSchema,
            },
          },
          description: "Disconnect cloud profile",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const status = await container.desktopLocalService.disconnectCloudProfile(
        body.name,
      );
      await container.modelProviderService.ensureValidDefaultModel();
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ok: true, ...status, configPushed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-profile/select",
      tags: ["Desktop"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: cloudProfileSelectBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudProfileSelectResponseSchema },
          },
          description: "Switch cloud profile",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const status = await container.desktopLocalService.switchCloudProfile(
        body.name,
      );
      await container.modelProviderService.ensureValidDefaultModel();
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ok: true, ...status, configPushed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-profiles/import",
      tags: ["Desktop"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: cloudProfilesImportBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudProfilesImportResponseSchema },
          },
          description: "Import cloud profiles",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const status = await container.desktopLocalService.importCloudProfiles(
        body.profiles,
      );
      await container.modelProviderService.ensureValidDefaultModel();
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ok: true, ...status, configPushed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/internal/desktop/cloud-models",
      tags: ["Desktop"],
      request: {
        body: {
          content: { "application/json": { schema: cloudModelsBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudModelsResponseSchema },
          },
          description: "Cloud models",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      return c.json(
        await container.desktopLocalService.setCloudModels(
          body.enabledModelIds,
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/default-model",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: defaultModelResponseSchema },
          },
          description: "Default model",
        },
      },
    }),
    async (c) => {
      const config = await container.configStore.getConfig();
      const rawModelId = config.runtime.defaultModelId;
      const modelId = rawModelId || null;
      return c.json({ modelId }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/internal/desktop/default-model",
      tags: ["Desktop"],
      request: {
        body: {
          content: { "application/json": { schema: defaultModelBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: defaultModelSetResponseSchema },
          },
          description: "Set default model",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      await container.desktopLocalService.setDefaultModel(body.modelId);
      const config = await container.configStore.getConfig();
      // Immediately sync so OpenClaw picks up the change
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json(
        {
          ok: true,
          modelId: config.runtime.defaultModelId,
          configPushed,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/utility-model",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: defaultModelResponseSchema },
          },
          description:
            "Utility model for short internal tasks (session titles)",
        },
      },
    }),
    async (c) => {
      const config = await container.configStore.getConfig();
      return c.json({ modelId: config.runtime.utilityModelId ?? null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/internal/desktop/utility-model",
      tags: ["Desktop"],
      request: {
        body: {
          content: { "application/json": { schema: utilityModelBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: utilityModelSetResponseSchema },
          },
          description: "Set utility model (null clears it)",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      await container.desktopLocalService.setUtilityModel(
        body.modelId.trim() ? body.modelId : null,
      );
      const config = await container.configStore.getConfig();
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json(
        {
          ok: true,
          modelId: config.runtime.utilityModelId ?? null,
          configPushed,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/phone-vlm-model",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: phoneVlmModelResponseSchema },
          },
          description:
            "Gateway model pushed to phones as the device-control VLM (null = gateway default tabby-phone)",
        },
      },
    }),
    async (c) => {
      const config = await container.configStore.getConfig();
      return c.json(
        { modelId: config.deviceControl.phoneVlmModel ?? null },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/internal/desktop/phone-vlm-model",
      tags: ["Desktop"],
      request: {
        body: {
          content: { "application/json": { schema: phoneVlmModelBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: phoneVlmModelSetResponseSchema },
          },
          description:
            "Set the phone control VLM model (empty string resets to the gateway default)",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const modelId = body.modelId.trim() ? body.modelId.trim() : null;
      await container.configStore.setDeviceControlConfig({
        phoneVlmModel: modelId,
      });
      // Re-push the credential so already-connected phones pick up the new
      // model live (tabby-control broadcasts it); best-effort like other pushes.
      void container.deviceControlService.pushVlmCredential();
      return c.json({ ok: true, modelId }, 200);
    },
  );
}
