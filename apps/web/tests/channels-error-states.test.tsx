import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsPage } from "../src/pages/channels";

const apiMocks = vi.hoisted(() => ({
  getChannels: vi.fn(),
  getLiveStatus: vi.fn(),
  deleteChannel: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/use-bot-quota", () => ({
  useBotQuota: () => ({ available: true, resetsAt: "" }),
}));

vi.mock("@/hooks/use-bots", () => ({
  useBots: () => ({ bots: [] }),
}));

vi.mock("@/hooks/use-countdown", () => ({
  useCountdown: () => "0m",
}));

vi.mock("@/lib/tracking", () => ({ track: vi.fn() }));

vi.mock("@/components/channels/channel-instance-card", () => ({
  ChannelInstanceCard: ({
    channel,
    liveStatus,
  }: {
    channel: { status: string };
    liveStatus?: string;
  }) => (
    <div data-testid="channel-instance-status">
      {liveStatus ?? `saved:${channel.status}`}
    </div>
  ),
}));

vi.mock("@/components/channel-setup/dingtalk-setup-view", () => ({
  DingtalkSetupView: () => <div>dingtalk-setup</div>,
}));
vi.mock("@/components/channel-setup/discord-setup-view", () => ({
  DiscordSetupView: () => <div>discord-setup</div>,
}));
vi.mock("@/components/channel-setup/feishu-setup-view", () => ({
  FeishuSetupView: () => <div>feishu-setup</div>,
}));
vi.mock("@/components/channel-setup/qqbot-setup-view", () => ({
  QqbotSetupView: () => <div>qq-setup</div>,
}));
vi.mock("@/components/channel-setup/slack-oauth-view", () => ({
  SlackOAuthView: () => <div>slack-setup</div>,
}));
vi.mock("@/components/channel-setup/telegram-setup-view", () => ({
  TelegramSetupView: () => <div>telegram-setup</div>,
}));
vi.mock("@/components/channel-setup/wechat-setup-view", () => ({
  WechatSetupView: () => <div>wechat-setup</div>,
}));
vi.mock("@/components/channel-setup/wecom-setup-view", () => ({
  WecomSetupView: () => <div>wecom-setup</div>,
}));
vi.mock("@/components/channel-setup/whatsapp-setup-view", () => ({
  WhatsappSetupView: () => <div>whatsapp-setup</div>,
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Channels: (...args: unknown[]) => apiMocks.getChannels(...args),
  getApiV1ChannelsLiveStatus: (...args: unknown[]) =>
    apiMocks.getLiveStatus(...args),
  deleteApiV1ChannelsByChannelId: (...args: unknown[]) =>
    apiMocks.deleteChannel(...args),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChannelsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getLiveStatus.mockResolvedValue({
    data: { gatewayConnected: true, channels: [] },
  });
  apiMocks.deleteChannel.mockResolvedValue({ data: {} });
});

describe("ChannelsPage unavailable states", () => {
  it("does not treat a channel-list SDK error as an empty configuration", async () => {
    apiMocks.getChannels
      .mockResolvedValueOnce({ error: { message: "controller offline" } })
      .mockResolvedValueOnce({ data: { channels: [] } });

    renderPage();

    expect(await screen.findByText("channels.listUnavailable")).toBeTruthy();
    expect(screen.queryByText("wechat-setup")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "channels.retry" }));

    expect(await screen.findByText("wechat-setup")).toBeTruthy();
    expect(apiMocks.getChannels).toHaveBeenCalledTimes(2);
  });

  it("keeps saved channels visible while live status is retryably unavailable", async () => {
    apiMocks.getChannels.mockResolvedValue({
      data: {
        channels: [
          {
            id: "channel-1",
            botId: "bot-1",
            channelType: "wechat",
            accountId: "wechat-account",
            teamName: null,
            status: "connected",
          },
        ],
      },
    });
    apiMocks.getLiveStatus
      .mockResolvedValueOnce({ error: { message: "runtime offline" } })
      .mockResolvedValue({
        data: {
          gatewayConnected: true,
          channels: [
            {
              channelType: "wechat",
              channelId: "channel-1",
              status: "connected",
              lastError: null,
            },
          ],
        },
      });

    renderPage();

    expect(
      await screen.findByText("channels.liveStatusUnavailable"),
    ).toBeTruthy();
    expect(screen.getByTestId("channel-instance-status").textContent).toBe(
      "saved:connected",
    );

    fireEvent.click(screen.getByRole("button", { name: "channels.retry" }));

    await waitFor(() =>
      expect(screen.queryByText("channels.liveStatusUnavailable")).toBeNull(),
    );
    expect(screen.getByTestId("channel-instance-status").textContent).toBe(
      "connected",
    );
    expect(apiMocks.getLiveStatus).toHaveBeenCalledTimes(2);
  });
});
