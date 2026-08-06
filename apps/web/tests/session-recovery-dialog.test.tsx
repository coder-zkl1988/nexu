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
import { SessionRecoveryDialog } from "../src/components/session-recovery-dialog";

const apiMocks = vi.hoisted(() => ({
  getCheckpoints: vi.fn(),
  branchCheckpoint: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1SessionsByIdCheckpoints: (...args: unknown[]) =>
    apiMocks.getCheckpoints(...args),
  postApiV1SessionsByIdCheckpointsByCheckpointIdBranch: (...args: unknown[]) =>
    apiMocks.branchCheckpoint(...args),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getCheckpoints.mockResolvedValue({
    data: {
      checkpoints: [
        {
          id: "checkpoint-1",
          createdAt: "2026-08-03T09:00:00.000Z",
          reason: "manual",
          summary: "Checkpoint summary",
        },
      ],
    },
  });
  apiMocks.branchCheckpoint.mockResolvedValue({
    data: { id: "recovered-session" },
  });
});

function renderDialog(overrides?: {
  onContinue?: (sessionId: string) => void;
  onRecovered?: (sessionId: string) => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const onContinue = overrides?.onContinue ?? vi.fn();
  const onRecovered = overrides?.onRecovered ?? vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <SessionRecoveryDialog
        session={{ id: "session-1", title: "Research session" }}
        onClose={vi.fn()}
        onContinue={onContinue}
        onRecovered={onRecovered}
      />
    </QueryClientProvider>,
  );

  return { invalidateQueries, onContinue, onRecovered };
}

describe("SessionRecoveryDialog", () => {
  it("continues the original session or branches from a checkpoint", async () => {
    const { invalidateQueries, onContinue, onRecovered } = renderDialog();

    fireEvent.click(
      screen.getByRole("button", { name: /layout.continueCurrentSession/ }),
    );
    expect(onContinue).toHaveBeenCalledWith("session-1");

    const summary = await screen.findByText("Checkpoint summary");
    fireEvent.click(summary.closest("button") as HTMLButtonElement);

    await waitFor(() =>
      expect(apiMocks.branchCheckpoint).toHaveBeenCalledWith({
        path: { id: "session-1", checkpointId: "checkpoint-1" },
      }),
    );
    await waitFor(() =>
      expect(onRecovered).toHaveBeenCalledWith("recovered-session"),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["sidebar-sessions"],
    });
  });

  it("shows a checkpoint branch failure without navigating", async () => {
    apiMocks.branchCheckpoint.mockResolvedValueOnce({
      error: { message: "Checkpoint is no longer available" },
    });
    const { onRecovered } = renderDialog();

    const summary = await screen.findByText("Checkpoint summary");
    fireEvent.click(summary.closest("button") as HTMLButtonElement);

    expect(
      await screen.findByText("Checkpoint is no longer available"),
    ).toBeTruthy();
    expect(onRecovered).not.toHaveBeenCalled();
  });
});
