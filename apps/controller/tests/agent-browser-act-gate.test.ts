import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { registerAgentBrowserRoutes } from "../src/routes/agent-browser-routes.js";
import type { ControllerBindings } from "../src/types.js";

// Third gate in the browser-origin chain (toolcall guard → nexu-browser
// plugin → this route). Desktop-shaped keys pass as before; the one
// channel-shaped exception is a direct-DM key listed in a connected feishu
// channel's browserOwnerIds, read live from the config store.

const OWNER_KEY = "agent:bot-1:direct:ou_owner";

function createApp({
  channels = [
    {
      channelType: "feishu",
      status: "connected",
      botId: "bot-1",
      feishuPermissions: { browserOwnerIds: ["ou_owner"] },
    },
  ],
  getConfig,
}: {
  channels?: unknown[];
  getConfig?: () => Promise<unknown>;
} = {}) {
  const dispatch = vi.fn(async () => ({ observation: null }));
  const app = new OpenAPIHono<ControllerBindings>();
  registerAgentBrowserRoutes(app, {
    agentBrowserBridge: { dispatch },
    configStore: {
      getConfig: getConfig ?? (async () => ({ channels })),
    },
  } as unknown as ControllerContainer);
  return { app, dispatch };
}

async function act(app: OpenAPIHono<ControllerBindings>, sessionKey: string) {
  return app.request("/api/v1/browser/agent/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey, command: { action: "snapshot" } }),
  });
}

describe("agent browser act gate", () => {
  it("still accepts a desktop main session without touching the store", async () => {
    const getConfig = vi.fn(async () => ({ channels: [] }));
    const { app, dispatch } = createApp({ getConfig });

    const response = await act(app, "agent:bot-1:main");

    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("accepts the paired owner's feishu DM key", async () => {
    const { app, dispatch } = createApp();

    const response = await act(app, OWNER_KEY);

    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalled();
  });

  it("rejects a direct key that no connected channel lists as owner", async () => {
    const { app, dispatch } = createApp();

    const response = await act(app, "agent:bot-1:direct:ou_stranger");

    expect(response.status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects the owner key once the channel is disconnected", async () => {
    const { app, dispatch } = createApp({
      channels: [
        {
          channelType: "feishu",
          status: "disconnected",
          botId: "bot-1",
          feishuPermissions: { browserOwnerIds: ["ou_owner"] },
        },
      ],
    });

    const response = await act(app, OWNER_KEY);

    expect(response.status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fails closed when the store read throws", async () => {
    const { app, dispatch } = createApp({
      getConfig: async () => {
        throw new Error("store down");
      },
    });

    const response = await act(app, OWNER_KEY);

    expect(response.status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
