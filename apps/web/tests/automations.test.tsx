// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationsPage } from "../src/pages/automations";

const apiMocks = vi.hoisted(() => ({
  getSchedules: vi.fn(),
  getBots: vi.fn(),
  getChannels: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  getRuns: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.count === undefined ? key : `${key}:${String(values.count)}`,
  }),
}));

vi.mock("@/components/inline-model-selector", () => ({
  InlineModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Schedules: (...args: unknown[]) => apiMocks.getSchedules(...args),
  getApiV1Bots: (...args: unknown[]) => apiMocks.getBots(...args),
  getApiV1Channels: (...args: unknown[]) => apiMocks.getChannels(...args),
  postApiV1Schedules: (...args: unknown[]) => apiMocks.createSchedule(...args),
  patchApiV1SchedulesByScheduleId: (...args: unknown[]) =>
    apiMocks.updateSchedule(...args),
  deleteApiV1SchedulesByScheduleId: (...args: unknown[]) =>
    apiMocks.deleteSchedule(...args),
  getApiV1SchedulesByScheduleIdRuns: (...args: unknown[]) =>
    apiMocks.getRuns(...args),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getBots.mockResolvedValue({
    data: { bots: [{ id: "bot-1", name: "Reporter", status: "active" }] },
  });
  apiMocks.getChannels.mockResolvedValue({
    data: {
      channels: [
        {
          channelType: "feishu",
          accountId: "feishu-account",
          botId: "bot-1",
          status: "connected",
        },
      ],
    },
  });
  apiMocks.createSchedule.mockResolvedValue({ data: {} });
  apiMocks.updateSchedule.mockResolvedValue({ data: {} });
  apiMocks.deleteSchedule.mockResolvedValue({ data: {} });
});

describe("AutomationsPage", () => {
  it("shows an unavailable state and retries schedule loading", async () => {
    apiMocks.getSchedules
      .mockResolvedValueOnce({ error: { message: "gateway offline" } })
      .mockResolvedValueOnce({
        data: {
          schedules: [
            {
              id: "schedule-recovered",
              botId: "bot-1",
              name: "Recovered automation",
              cron: "0 9 * * *",
              timezone: "Asia/Shanghai",
              prompt: "Summarize the project",
              enabled: true,
              source: "ui",
              createdAt: "2026-08-03T00:00:00.000Z",
              updatedAt: "2026-08-03T00:00:00.000Z",
            },
          ],
        },
      });

    render(<AutomationsPage />);

    expect(await screen.findByText("automations.loadError")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "automations.retry" }));

    expect(await screen.findByText("Recovered automation")).toBeTruthy();
    expect(apiMocks.getSchedules).toHaveBeenCalledTimes(2);
  });

  it("treats missing schedule data as unavailable instead of empty", async () => {
    apiMocks.getSchedules.mockResolvedValue({ data: undefined, error: null });

    render(<AutomationsPage />);

    expect(await screen.findByText("automations.loadError")).toBeTruthy();
    expect(screen.queryByText("automations.noAutomations")).toBeNull();
  });

  it("shows retryable bot and channel errors instead of empty create choices", async () => {
    apiMocks.getSchedules.mockResolvedValue({ data: { schedules: [] } });
    apiMocks.getBots
      .mockResolvedValueOnce({ error: { message: "bots offline" } })
      .mockResolvedValueOnce({
        data: { bots: [{ id: "bot-1", name: "Reporter", status: "active" }] },
      });
    apiMocks.getChannels
      .mockResolvedValueOnce({ error: { message: "channels offline" } })
      .mockResolvedValueOnce({
        data: {
          channels: [
            {
              channelType: "feishu",
              accountId: "feishu-account",
              botId: "bot-1",
              status: "connected",
            },
          ],
        },
      });

    render(<AutomationsPage />);
    await waitFor(() => expect(apiMocks.getSchedules).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: "automations.newAutomation" }),
    );

    expect(
      await screen.findByText("automations.modal.botsLoadError"),
    ).toBeTruthy();
    expect(
      screen.getByText("automations.modal.channelsLoadError"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "automations.modal.create",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "automations.modal.retryBots" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "automations.modal.retryChannels" }),
    );

    await waitFor(() => {
      expect(apiMocks.getBots).toHaveBeenCalledTimes(2);
      expect(apiMocks.getChannels).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("automations.modal.botsLoadError")).toBeNull();
    expect(
      screen.queryByText("automations.modal.channelsLoadError"),
    ).toBeNull();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "bot-1" },
    });
    expect(
      await screen.findByDisplayValue(
        "automations.modal.deliveryChannelPlaceholder",
      ),
    ).toBeTruthy();
  });

  it("shows native schedule state and output notification audit", async () => {
    apiMocks.getSchedules.mockResolvedValue({
      data: {
        schedules: [
          {
            id: "schedule-1",
            botId: "bot-1",
            name: "Daily report",
            cron: "0 9 * * *",
            timezone: "Asia/Shanghai",
            prompt: "Summarize the project",
            enabled: true,
            source: "ui",
            channelType: "feishu",
            channelId: "feishu-account",
            onlyNotifyOnChange: true,
            failureAlertEnabled: true,
            failureAlertAfter: 2,
            nextRunAtMs: 1_754_262_000_000,
            lastDurationMs: 4_250,
            deliveryChannel: "feishu",
            deliveryTo: "chat:oc_report",
            lastOutputNotificationStatus: "suppressed",
            createdAt: "2026-08-03T00:00:00.000Z",
            updatedAt: "2026-08-03T00:00:00.000Z",
          },
        ],
      },
    });

    render(<AutomationsPage />);

    expect(await screen.findByText("Daily report")).toBeTruthy();
    expect(screen.getByText("automations.detail.nextRun")).toBeTruthy();
    expect(screen.getByText("automations.detail.destination")).toBeTruthy();
    expect(screen.getByText("feishu · chat:oc_report")).toBeTruthy();
    expect(screen.getByText("4.3 s")).toBeTruthy();
    expect(screen.getByText("automations.detail.onlyChanges")).toBeTruthy();
    expect(screen.getByText("automations.detail.failureAlert:2")).toBeTruthy();
    expect(
      screen.getByText("automations.detail.outputNotification.suppressed"),
    ).toBeTruthy();
  });

  it("reports update and delete SDK errors without refreshing into a false state", async () => {
    apiMocks.getSchedules.mockResolvedValue({
      data: {
        schedules: [
          {
            id: "schedule-1",
            botId: "bot-1",
            name: "Daily report",
            cron: "0 9 * * *",
            timezone: "Asia/Shanghai",
            prompt: "Summarize the project",
            enabled: true,
            source: "ui",
            createdAt: "2026-08-03T00:00:00.000Z",
            updatedAt: "2026-08-03T00:00:00.000Z",
          },
        ],
      },
    });
    apiMocks.updateSchedule.mockResolvedValue({
      error: { message: "gateway offline" },
    });
    apiMocks.deleteSchedule.mockResolvedValue({
      error: { message: "gateway offline" },
    });

    render(<AutomationsPage />);
    await screen.findByText("Daily report");

    fireEvent.click(screen.getByRole("button", { name: "automations.pause" }));
    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith("automations.updateFailed"),
    );
    expect(apiMocks.getSchedules).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "automations.detail.delete" }),
    );
    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith("automations.deleteFailed"),
    );
    expect(apiMocks.getSchedules).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable run-history error for SDK errors", async () => {
    apiMocks.getSchedules.mockResolvedValue({
      data: {
        schedules: [
          {
            id: "schedule-1",
            botId: "bot-1",
            name: "Daily report",
            cron: "0 9 * * *",
            timezone: "Asia/Shanghai",
            prompt: "Summarize the project",
            enabled: true,
            source: "ui",
            createdAt: "2026-08-03T00:00:00.000Z",
            updatedAt: "2026-08-03T00:00:00.000Z",
          },
        ],
      },
    });
    apiMocks.getRuns
      .mockResolvedValueOnce({ error: { message: "gateway offline" } })
      .mockResolvedValueOnce({
        data: {
          entries: [
            {
              ts: 1_754_209_200_000,
              jobId: "job-1",
              action: "finished",
              status: "ok",
              summary: "Recovered run output",
              runAtMs: 1_754_209_200_000,
            },
          ],
          total: 1,
          hasMore: false,
        },
      });

    render(<AutomationsPage />);
    await screen.findByText("Daily report");
    fireEvent.click(
      screen.getByRole("button", { name: "automations.detail.history" }),
    );

    expect(
      await screen.findByText("automations.detail.historyError"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "automations.detail.historyRetry",
      }),
    );

    expect(await screen.findByText("Recovered run output")).toBeTruthy();
    expect(apiMocks.getRuns).toHaveBeenCalledTimes(2);
  });

  it("submits change-only and native failure alert settings", async () => {
    apiMocks.getSchedules.mockResolvedValue({ data: { schedules: [] } });
    render(<AutomationsPage />);

    await waitFor(() => expect(apiMocks.getSchedules).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: "automations.newAutomation" }),
    );

    const botSelect = await screen.findByRole("combobox");
    fireEvent.change(botSelect, { target: { value: "bot-1" } });
    const channelSelect = await screen.findByDisplayValue(
      "automations.modal.deliveryChannelPlaceholder",
    );
    fireEvent.change(channelSelect, {
      target: { value: "feishu:feishu-account" },
    });

    fireEvent.click(
      screen.getByRole("switch", {
        name: "automations.modal.onlyNotifyOnChange",
      }),
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "automations.modal.failureAlert",
      }),
    );
    fireEvent.change(
      screen.getByLabelText("automations.modal.failureAlertAfter"),
      { target: { value: "4" } },
    );

    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0] as HTMLInputElement, {
      target: { value: "Daily report" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("automations.modal.promptPlaceholder"),
      { target: { value: "Summarize the project" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "automations.modal.create" }),
    );

    await waitFor(() =>
      expect(apiMocks.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            channelType: "feishu",
            channelId: "feishu-account",
            onlyNotifyOnChange: true,
            failureAlertEnabled: true,
            failureAlertAfter: 4,
          }),
        }),
      ),
    );
  });

  it("keeps the modal open and shows API save failures", async () => {
    apiMocks.getSchedules.mockResolvedValue({ data: { schedules: [] } });
    apiMocks.createSchedule.mockResolvedValueOnce({
      error: { message: "No active channel conversation" },
    });
    render(<AutomationsPage />);

    await waitFor(() => expect(apiMocks.getSchedules).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: "automations.newAutomation" }),
    );
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "bot-1" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "automations.modal.create" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No active channel conversation",
    );
    expect(
      screen.getByRole("dialog", { name: "automations.modal.createTitle" }),
    ).toBeTruthy();
  });
});
