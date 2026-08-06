// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomePage } from "../src/pages/welcome";

const postCloudConnect = vi.fn();
const postCloudDisconnect = vi.fn();

vi.mock("../lib/api/sdk.gen", () => ({
  getApiInternalDesktopCloudStatus: vi.fn(async () => ({
    data: { connected: false, polling: false },
  })),
  postApiInternalDesktopCloudConnect: (...args: unknown[]) =>
    postCloudConnect(...args),
  postApiInternalDesktopCloudDisconnect: (...args: unknown[]) =>
    postCloudDisconnect(...args),
}));

vi.mock("../src/hooks/use-desktop-cloud-status", () => ({
  syncDesktopCloudQueries: vi.fn(async () => undefined),
  useDesktopCloudStatus: () => ({
    data: { connected: false, polling: false },
    refetch: vi.fn(async () => ({
      data: { connected: false, polling: false },
    })),
  }),
}));

vi.mock("../src/hooks/use-locale", () => ({
  useLocale: () => ({
    t: (key: string) =>
      key === "welcome.option.login.title" ? "Use your Tabby account" : key,
  }),
}));

vi.mock("../src/hooks/use-page-title", () => ({
  usePageTitle: vi.fn(),
}));

vi.mock("../src/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false }),
  },
}));

vi.mock("../src/lib/desktop-links", () => ({
  openExternalUrl: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/tracking", () => ({
  track: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function renderWelcome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WelcomePage cloud login", () => {
  beforeEach(() => {
    localStorage.clear();
    postCloudConnect.mockReset();
    postCloudDisconnect.mockReset();
    postCloudDisconnect.mockResolvedValue({ data: undefined });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps a device registration failure visible after the login attempt ends", async () => {
    postCloudConnect.mockResolvedValue({
      data: { error: "Failed to register device: HTTP 404" },
    });
    renderWelcome();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Use your Tabby account/ }),
      );
    });

    expect(postCloudConnect).toHaveBeenCalledTimes(2);
    expect(postCloudDisconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain(
      "welcome.loginUnavailable",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Failed to register device: HTTP 404",
    );
    expect(
      (
        screen.getByRole("button", {
          name: /Use your Tabby account/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
