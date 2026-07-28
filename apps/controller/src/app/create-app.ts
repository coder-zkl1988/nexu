import crypto from "node:crypto";
import path from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { isTrustedLocalRequest } from "../lib/local-request-guard.js";
import { registerAgentBrowserRoutes } from "../routes/agent-browser-routes.js";
import { registerArtifactRoutes } from "../routes/artifact-routes.js";
import { registerBotRoutes } from "../routes/bot-routes.js";
import { registerCanvasRoutes } from "../routes/canvas-routes.js";
import { registerChannelRoutes } from "../routes/channel-routes.js";
import { registerChatRoutes } from "../routes/chat-routes.js";
import { registerDesktopCompatRoutes } from "../routes/desktop-compat-routes.js";
import { registerDesktopRewardsRoutes } from "../routes/desktop-rewards-routes.js";
import { registerDesktopRoutes } from "../routes/desktop-routes.js";
import { registerDeviceControlRoutes } from "../routes/device-control-routes.js";
import { registerDeviceTaskHistoryRoutes } from "../routes/device-task-history-routes.js";
import { buildExperthubRoutes } from "../routes/experthub-routes.js";
import { registerIntegrationRoutes } from "../routes/integration-routes.js";
import { registerMediaRoutes } from "../routes/media-routes.js";
import { registerMiscCompatRoutes } from "../routes/misc-compat-routes.js";
import { registerModelRoutes } from "../routes/model-routes.js";
import { registerProviderOAuthRoutes } from "../routes/provider-oauth-routes.js";
import { registerRuntimeConfigRoutes } from "../routes/runtime-config-routes.js";
import { registerScheduleRoutes } from "../routes/schedule-routes.js";
import { registerSessionRoutes } from "../routes/session-routes.js";
import { registerSkillhubRoutes } from "../routes/skillhub-routes.js";
import { buildTeamRoutes } from "../routes/team-routes.js";
import {
  buildTeamWorkflowRoutes,
  buildTeamWorkflowTemplateRoutes,
} from "../routes/team-workflow-routes.js";
import { registerUserRoutes } from "../routes/user-routes.js";
import { registerWorkspaceTemplateRoutes } from "../routes/workspace-template-routes.js";
import type { ControllerBindings } from "../types.js";
import type { ControllerContainer } from "./container.js";

export function createApp(container: ControllerContainer) {
  const app = new OpenAPIHono<ControllerBindings>();

  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
  });
  app.use("*", async (c, next) => {
    if (
      !isTrustedLocalRequest({
        requestUrl: c.req.url,
        host: c.req.header("host"),
        origin: c.req.header("origin"),
        secFetchSite: c.req.header("sec-fetch-site"),
      })
    ) {
      return c.text("Forbidden", 403);
    }
    await next();
  });
  app.use(
    "*",
    cors({
      origin: container.env.webUrl,
      credentials: true,
    }),
  );

  registerBotRoutes(app, container);
  registerMiscCompatRoutes(app, container);
  registerDesktopRoutes(app, container);
  registerDesktopCompatRoutes(app, container);
  registerDesktopRewardsRoutes(app, container);
  registerChannelRoutes(app, container);
  registerChatRoutes(app, container);
  registerSessionRoutes(app, container);
  registerModelRoutes(app, container);
  registerProviderOAuthRoutes(app, container);
  registerIntegrationRoutes(app, container);
  registerArtifactRoutes(app, container);
  registerSkillhubRoutes(app, container);
  app.route(
    "/api/v1/experthub",
    buildExperthubRoutes({
      catalog: container.experthubCatalogManager,
      installExpert: container.installExpertFn,
      createCustomExpert: container.createCustomExpertFn,
      updateExpertSkills: container.updateExpertSkillsFn,
      botService: container.agentService,
      agentsDir: path.join(container.env.openclawStateDir, "agents"),
      platformTemplatesDir: container.env.platformTemplatesDir ?? "",
    }),
  );
  app.route(
    "/api/v1/teams",
    buildTeamRoutes({
      teamService: container.teamService,
      teamWorkflowService: container.teamWorkflowService,
    }),
  );
  app.route(
    "/api/v1/teams",
    buildTeamWorkflowRoutes({
      teamWorkflowService: container.teamWorkflowService,
    }),
  );
  app.route(
    "/api/v1/team-workflow-templates",
    buildTeamWorkflowTemplateRoutes({
      teamWorkflowService: container.teamWorkflowService,
    }),
  );
  registerUserRoutes(app, container);
  registerRuntimeConfigRoutes(app, container);
  registerWorkspaceTemplateRoutes(app, container);
  registerDeviceTaskHistoryRoutes(app, container);
  registerDeviceControlRoutes(app, container);
  registerScheduleRoutes(app, container);
  registerMediaRoutes(app, container);
  registerCanvasRoutes(app);
  registerAgentBrowserRoutes(app, container);

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Tabby Controller API",
      version: "0.1.0",
    },
  });

  app.get("/health", async (c) => {
    const controlPlane = await container.controlPlaneHealth.bootstrapProbe();
    return c.json(
      {
        status: container.runtimeState.status,
        controlPlane,
        sync: {
          config: container.runtimeState.configSyncStatus,
          skills: container.runtimeState.skillsSyncStatus,
          templates: container.runtimeState.templatesSyncStatus,
        },
        gateway: {
          status: container.runtimeState.gatewayStatus,
          lastProbeAt: container.runtimeState.lastGatewayProbeAt,
          lastError: container.runtimeState.lastGatewayError,
        },
      },
      200,
    );
  });

  return app;
}
