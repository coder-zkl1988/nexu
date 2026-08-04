import { OpenAPIHono } from "@hono/zod-openapi";
import type { ChannelResponse } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { compileChannelsConfig } from "../src/lib/channel-binding-compiler.js";
import { registerChannelRoutes } from "../src/routes/channel-routes.js";
import { ChannelService } from "../src/services/channel-service.js";
import type { ControllerBindings } from "../src/types.js";

const timestamp = "2026-08-04T00:00:00.000Z";

function makeChannel(
  channel: Pick<
    ChannelResponse,
    | "id"
    | "botId"
    | "channelType"
    | "accountId"
    | "slackCapabilities"
    | "feishuCapabilities"
  >,
): ChannelResponse {
  return {
    ...channel,
    status: "connected",
    teamName: null,
    appId: null,
    botUserId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("channel delivery capabilities", () => {
  it("compiles Slack threads, progress streaming, and native task cards", () => {
    const channel = makeChannel({
      id: "slack-channel",
      botId: "bot-1",
      channelType: "slack",
      accountId: "slack-account",
      slackCapabilities: {
        replyToMode: "all",
        streamingMode: "progress",
        nativeTaskCards: true,
      },
    });

    const result = compileChannelsConfig({
      channels: [channel],
      secrets: {
        "channel:slack-channel:botToken": "xoxb-test",
        "channel:slack-channel:signingSecret": "signing-secret",
      },
      gatewayBaseUrl: "http://127.0.0.1:18789",
    });

    expect(result.slack?.accounts["slack-account"]).toMatchObject({
      replyToMode: "all",
      streaming: {
        mode: "progress",
        nativeTransport: true,
        progress: {
          nativeTaskCards: true,
          render: "rich",
          toolProgress: true,
          commandText: "status",
        },
      },
    });
  });

  it("compiles Feishu cards, threads, voice replies, and media limits", () => {
    const channel = makeChannel({
      id: "feishu-channel",
      botId: "bot-1",
      channelType: "feishu",
      accountId: "feishu-account",
      feishuCapabilities: {
        streaming: true,
        renderMode: "card",
        replyInThread: true,
        voiceReplyMode: "inbound",
        mediaMaxMb: 48,
      },
    });

    const result = compileChannelsConfig({
      channels: [channel],
      secrets: {
        "channel:feishu-channel:appId": "cli_test",
        "channel:feishu-channel:appSecret": "app-secret",
      },
      gatewayBaseUrl: "http://127.0.0.1:18789",
    });

    expect(result.feishu?.accounts["feishu-account"]).toMatchObject({
      streaming: true,
      renderMode: "card",
      replyInThread: "enabled",
      mediaMaxMb: 48,
      tts: { auto: "inbound" },
    });
  });

  it("updates capabilities through the generated OpenAPI route", async () => {
    const updateChannelCapabilities = vi.fn(async () =>
      makeChannel({
        id: "slack-channel",
        botId: "bot-1",
        channelType: "slack",
        accountId: "slack-account",
        slackCapabilities: {
          replyToMode: "first",
          streamingMode: "partial",
          nativeTaskCards: false,
        },
      }),
    );
    const app = new OpenAPIHono<ControllerBindings>();
    registerChannelRoutes(app, {
      channelService: { updateChannelCapabilities },
    } as unknown as ControllerContainer);

    const response = await app.request(
      "/api/v1/channels/slack-channel/capabilities",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channelType: "slack",
          settings: {
            replyToMode: "first",
            streamingMode: "partial",
            nativeTaskCards: false,
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateChannelCapabilities).toHaveBeenCalledWith("slack-channel", {
      channelType: "slack",
      settings: {
        replyToMode: "first",
        streamingMode: "partial",
        nativeTaskCards: false,
      },
    });
  });

  it("restores the previous capabilities when runtime sync fails", async () => {
    const previous = makeChannel({
      id: "slack-channel",
      botId: "bot-1",
      channelType: "slack",
      accountId: "slack-account",
      slackCapabilities: null,
      feishuCapabilities: null,
    });
    const updated = makeChannel({
      ...previous,
      slackCapabilities: {
        replyToMode: "all",
        streamingMode: "progress",
        nativeTaskCards: true,
      },
    });
    const configStore = {
      getChannel: vi.fn(async () => previous),
      updateChannelCapabilities: vi.fn(async () => updated),
      updateChannel: vi.fn(async () => previous),
    };
    const syncAll = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("runtime sync failed"))
      .mockResolvedValueOnce(undefined);
    const service = new ChannelService(
      {} as ConstructorParameters<typeof ChannelService>[0],
      configStore as unknown as ConstructorParameters<typeof ChannelService>[1],
      { syncAll } as unknown as ConstructorParameters<typeof ChannelService>[2],
      {} as ConstructorParameters<typeof ChannelService>[3],
      {} as ConstructorParameters<typeof ChannelService>[4],
      {} as ConstructorParameters<typeof ChannelService>[5],
      {} as ConstructorParameters<typeof ChannelService>[6],
    );

    const slackCapabilities = updated.slackCapabilities;
    if (!slackCapabilities) {
      throw new Error("expected Slack capabilities fixture");
    }

    await expect(
      service.updateChannelCapabilities("slack-channel", {
        channelType: "slack",
        settings: slackCapabilities,
      }),
    ).rejects.toThrow("runtime sync failed");

    expect(configStore.updateChannel).toHaveBeenCalledWith("slack-channel", {
      slackCapabilities: null,
    });
    expect(syncAll).toHaveBeenCalledTimes(2);
  });
});
