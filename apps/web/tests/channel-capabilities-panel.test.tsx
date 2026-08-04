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
import { ChannelCapabilitiesPanel } from "../src/components/channels/channel-capabilities-panel";

const apiMocks = vi.hoisted(() => ({
  updateCapabilities: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../lib/api/sdk.gen", () => ({
  patchApiV1ChannelsByChannelIdCapabilities: (...args: unknown[]) =>
    apiMocks.updateCapabilities(...args),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

function renderPanel(
  props:
    | {
        channelId: string;
        channelType: "slack";
        initial: null;
      }
    | {
        channelId: string;
        channelType: "feishu";
        initial: null;
      },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChannelCapabilitiesPanel {...props} />
    </QueryClientProvider>,
  );
}

describe("ChannelCapabilitiesPanel", () => {
  beforeEach(() => {
    apiMocks.updateCapabilities.mockReset();
    apiMocks.updateCapabilities.mockResolvedValue({
      data: { id: "channel-1" },
    });
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
  });

  afterEach(() => cleanup());

  it("saves Slack thread, progress, and native task-card settings", async () => {
    renderPanel({ channelId: "slack-1", channelType: "slack", initial: null });

    fireEvent.click(screen.getByText("channels.capabilities.title"));
    fireEvent.change(
      screen.getByLabelText("channels.capabilities.slack.threads"),
      { target: { value: "all" } },
    );
    fireEvent.change(
      screen.getByLabelText("channels.capabilities.slack.streaming"),
      { target: { value: "progress" } },
    );
    fireEvent.click(
      screen.getByLabelText("channels.capabilities.slack.taskCards"),
    );
    fireEvent.click(screen.getByText("channels.capabilities.save"));

    await waitFor(() => {
      expect(apiMocks.updateCapabilities).toHaveBeenCalledWith({
        path: { channelId: "slack-1" },
        body: {
          channelType: "slack",
          settings: {
            replyToMode: "all",
            streamingMode: "progress",
            nativeTaskCards: true,
          },
        },
      });
    });
    expect(toastMocks.success).toHaveBeenCalledWith(
      "channels.capabilities.saved",
    );
  });

  it("shows Feishu media support and saves card, voice, and media controls", async () => {
    renderPanel({
      channelId: "feishu-1",
      channelType: "feishu",
      initial: null,
    });

    fireEvent.click(screen.getByText("channels.capabilities.title"));
    expect(screen.getByText("channels.capabilities.audio")).toBeTruthy();
    expect(screen.getByText("channels.capabilities.images")).toBeTruthy();
    expect(screen.getByText("channels.capabilities.files")).toBeTruthy();
    expect(screen.getByText("channels.capabilities.video")).toBeTruthy();

    fireEvent.change(
      screen.getByLabelText("channels.capabilities.feishu.voiceReplies"),
      { target: { value: "inbound" } },
    );
    fireEvent.change(
      screen.getByLabelText("channels.capabilities.feishu.mediaLimit"),
      { target: { value: "48" } },
    );
    fireEvent.click(screen.getByText("channels.capabilities.save"));

    await waitFor(() => {
      expect(apiMocks.updateCapabilities).toHaveBeenCalledWith({
        path: { channelId: "feishu-1" },
        body: {
          channelType: "feishu",
          settings: {
            streaming: true,
            renderMode: "card",
            replyInThread: false,
            voiceReplyMode: "inbound",
            mediaMaxMb: 48,
          },
        },
      });
    });
  });
});
