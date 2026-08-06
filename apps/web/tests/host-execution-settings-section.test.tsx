// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostExecutionSettingsSection } from "../src/pages/host-execution-settings-section";

const apiMocks = vi.hoisted(() => ({
  getBots: vi.fn(),
  patchBot: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Bots: apiMocks.getBots,
  patchApiV1BotsByBotId: apiMocks.patchBot,
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HostExecutionSettingsSection />
    </QueryClientProvider>,
  );
}

function bot(overrides: Record<string, unknown> = {}) {
  return {
    id: "bot-1",
    name: "Assistant",
    slug: "assistant",
    poolId: null,
    status: "active",
    modelId: "m",
    systemPrompt: null,
    expertSlug: null,
    origin: "user",
    hostExecution: { channels: "restricted", automations: "restricted" },
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("HostExecutionSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getBots.mockResolvedValue({ data: { bots: [bot()] } });
    apiMocks.patchBot.mockResolvedValue({ data: bot() });
  });

  afterEach(() => cleanup());

  it("shows both surfaces off by default", async () => {
    renderSection();

    await waitFor(() => {
      expect(
        document.querySelector('[data-host-execution-switch="bot-1:channels"]'),
      ).not.toBeNull();
    });

    for (const surface of ["channels", "automations"]) {
      const node = document.querySelector(
        `[data-host-execution-switch="bot-1:${surface}"]`,
      );
      // Radix switches expose state through aria-checked / data-state.
      expect(node?.getAttribute("data-state")).toBe("unchecked");
    }
  });

  it("opens exactly the surface that was toggled", async () => {
    renderSection();
    await waitFor(() => {
      expect(
        document.querySelector('[data-host-execution-switch="bot-1:channels"]'),
      ).not.toBeNull();
    });

    const channelSwitch = document.querySelector(
      '[data-host-execution-switch="bot-1:channels"]',
    ) as HTMLElement;
    fireEvent.click(channelSwitch);

    await waitFor(() => {
      expect(apiMocks.patchBot).toHaveBeenCalledWith({
        path: { botId: "bot-1" },
        body: { hostExecution: { channels: "host" } },
      });
    });
    // The automations switch must not be sent along for the ride.
    expect(apiMocks.patchBot).toHaveBeenCalledTimes(1);
  });

  it("reflects a bot that already opted in", async () => {
    apiMocks.getBots.mockResolvedValue({
      data: {
        bots: [
          bot({
            hostExecution: { channels: "host", automations: "restricted" },
          }),
        ],
      },
    });
    renderSection();

    await waitFor(() => {
      expect(
        document
          .querySelector('[data-host-execution-switch="bot-1:channels"]')
          ?.getAttribute("data-state"),
      ).toBe("checked");
    });
    expect(
      document
        .querySelector('[data-host-execution-switch="bot-1:automations"]')
        ?.getAttribute("data-state"),
    ).toBe("unchecked");
  });

  it("surfaces a failure instead of pretending it saved", async () => {
    apiMocks.patchBot.mockResolvedValue({ error: { message: "nope" } });
    renderSection();
    await waitFor(() => {
      expect(
        document.querySelector('[data-host-execution-switch="bot-1:channels"]'),
      ).not.toBeNull();
    });

    fireEvent.click(
      document.querySelector(
        '[data-host-execution-switch="bot-1:channels"]',
      ) as HTMLElement,
    );

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    expect(toastMocks.success).not.toHaveBeenCalled();
  });
});
