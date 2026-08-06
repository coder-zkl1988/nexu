// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackOAuthView } from "../src/components/channel-setup/slack-oauth-view";

const apiMocks = vi.hoisted(() => ({
  getChannels: vi.fn(),
  getOauthUrl: vi.fn(),
  getRedirectUri: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/channels/bot-picker", () => ({
  BotPicker: ({ disabled }: { disabled?: boolean }) => (
    <select aria-label="bot-picker" disabled={disabled} />
  ),
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Channels: (...args: unknown[]) => apiMocks.getChannels(...args),
  getApiV1ChannelsSlackOauthUrl: (...args: unknown[]) =>
    apiMocks.getOauthUrl(...args),
  getApiV1ChannelsSlackRedirectUri: (...args: unknown[]) =>
    apiMocks.getRedirectUri(...args),
  postApiV1ChannelsSlackConnect: (...args: unknown[]) =>
    apiMocks.connect(...args),
}));

describe("SlackOAuthView manual-only mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiMocks.getChannels.mockResolvedValue({ data: { channels: [] } });
    apiMocks.getRedirectUri.mockResolvedValue({
      data: { redirectUri: "http://127.0.0.1:3010/manual-slack-connect" },
    });
    apiMocks.connect.mockResolvedValue({ data: { teamName: "Example" } });
  });

  afterEach(cleanup);

  function renderManualView() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <SlackOAuthView onConnected={vi.fn()} manualOnly />
      </QueryClientProvider>,
    );
  }

  it("does not expose the deprecated OAuth placeholder", async () => {
    renderManualView();

    expect(screen.getByText("slackSetup.manualConnection")).toBeTruthy();
    expect(screen.getByText("slackSetup.createAppTitle")).toBeTruthy();
    expect(screen.queryByText("slackSetup.addToSlack")).toBeNull();
    expect(screen.queryByText("slackSetup.tryOauthAgain")).toBeNull();
    expect(screen.queryByText("slackSetup.tryOauthSuffix")).toBeNull();
    expect(screen.queryByText("slackSetup.back")).toBeNull();
    expect(apiMocks.getOauthUrl).not.toHaveBeenCalled();

    const createAppLink = await screen.findByText("slackSetup.createSlackApp");
    expect(createAppLink.getAttribute("href")).toContain(
      encodeURIComponent("http://127.0.0.1:3010/api/slack/events"),
    );
    expect(createAppLink.getAttribute("href")).not.toContain(
      encodeURIComponent(
        "http://127.0.0.1:3010/manual-slack-connect/api/slack/events",
      ),
    );
  });

  it("shows a retryable unavailable state for redirect URI SDK errors", async () => {
    apiMocks.getRedirectUri
      .mockResolvedValueOnce({ error: { message: "controller offline" } })
      .mockResolvedValueOnce({
        data: {
          redirectUri: "http://127.0.0.1:3010/api/oauth/slack/callback",
        },
      });

    renderManualView();

    expect(
      await screen.findByText("slackSetup.redirectUriUnavailable"),
    ).toBeTruthy();
    expect(screen.queryByText("slackSetup.createSlackApp")).toBeNull();
    expect(document.querySelector('a[href*="manifest_json"]')).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "slackSetup.retryRedirectUri" }),
    );

    expect(await screen.findByText("slackSetup.createSlackApp")).toBeTruthy();
    expect(apiMocks.getRedirectUri).toHaveBeenCalledTimes(2);
  });

  it("does not generate a manifest from an invalid redirect URI", async () => {
    apiMocks.getRedirectUri.mockResolvedValue({
      data: { redirectUri: "not-a-valid-uri" },
    });

    renderManualView();

    expect(
      await screen.findByText("slackSetup.redirectUriUnavailable"),
    ).toBeTruthy();
    expect(screen.queryByText("slackSetup.createSlackApp")).toBeNull();
    expect(document.querySelector('a[href*="manifest_json"]')).toBeNull();
  });

  it("disables channel operations until a failed bindings query is retried", async () => {
    apiMocks.getChannels
      .mockResolvedValueOnce({ error: { message: "bindings unavailable" } })
      .mockResolvedValueOnce({ data: { channels: [] } });

    renderManualView();

    expect(
      await screen.findByText("slackSetup.channelsUnavailable"),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("slackSetup.stepEnableDMs"));
    expect(
      (screen.getByLabelText("bot-picker") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "slackSetup.connect" })
        .getAttribute("data-slack-channel-operations-disabled"),
    ).toBe("true");

    fireEvent.click(
      screen.getByRole("button", { name: "slackSetup.retryChannels" }),
    );

    await waitFor(() => {
      expect(screen.queryByText("slackSetup.channelsUnavailable")).toBeNull();
      expect(
        (screen.getByLabelText("bot-picker") as HTMLSelectElement).disabled,
      ).toBe(false);
    });
    expect(apiMocks.getChannels).toHaveBeenCalledTimes(2);
  });
});
