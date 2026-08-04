import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelsPage, mergeProviderConfigForSave } from "../src/pages/models";

const apiMocks = vi.hoisted(() => ({
  getModels: vi.fn(),
  getRegistry: vi.fn(),
  getProviderConfig: vi.fn(),
  putProviderConfig: vi.fn(),
  getDefaultModel: vi.fn(),
  getUtilityModel: vi.fn(),
  getDesktopReady: vi.fn(),
  getOauthProviderStatus: vi.fn(),
  getOauthFlowStatus: vi.fn(),
  startOauth: vi.fn(),
  disconnectOauth: vi.fn(),
}));

const routeMocks = vi.hoisted(() => ({
  search: "tab=providers&provider=anthropic",
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(routeMocks.search), vi.fn()],
}));

vi.mock("@/hooks/use-github-stars", () => ({
  useGitHubStars: () => ({ stars: null }),
}));

vi.mock("@/components/github-star-cta", () => ({
  GitHubStarCta: () => null,
}));

vi.mock("@/components/model-picker-dropdown", () => ({
  ModelPickerDropdown: () => <div data-testid="model-picker" />,
}));

vi.mock("@/components/provider-logo", () => ({
  ModelLogo: () => null,
  ProviderLogo: () => null,
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Models: (...args: unknown[]) => apiMocks.getModels(...args),
  getApiV1ModelProvidersRegistry: (...args: unknown[]) =>
    apiMocks.getRegistry(...args),
  getApiV1ModelProvidersConfig: (...args: unknown[]) =>
    apiMocks.getProviderConfig(...args),
  putApiV1ModelProvidersConfig: (...args: unknown[]) =>
    apiMocks.putProviderConfig(...args),
  getApiInternalDesktopDefaultModel: (...args: unknown[]) =>
    apiMocks.getDefaultModel(...args),
  getApiInternalDesktopUtilityModel: (...args: unknown[]) =>
    apiMocks.getUtilityModel(...args),
  getApiInternalDesktopReady: (...args: unknown[]) =>
    apiMocks.getDesktopReady(...args),
  getApiV1ModelProvidersByProviderIdOauthProviderStatus: (...args: unknown[]) =>
    apiMocks.getOauthProviderStatus(...args),
  getApiV1ModelProvidersByProviderIdOauthStatus: (...args: unknown[]) =>
    apiMocks.getOauthFlowStatus(...args),
  postApiV1ModelProvidersByProviderIdOauthStart: (...args: unknown[]) =>
    apiMocks.startOauth(...args),
  postApiV1ModelProvidersByProviderIdOauthDisconnect: (...args: unknown[]) =>
    apiMocks.disconnectOauth(...args),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ModelsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "nexuHost");
});

beforeEach(() => {
  vi.clearAllMocks();
  routeMocks.search = "tab=providers&provider=anthropic";
  apiMocks.getModels.mockResolvedValue({ data: { models: [] } });
  apiMocks.getRegistry.mockResolvedValue({ data: { registry: [] } });
  apiMocks.getProviderConfig.mockResolvedValue({
    data: { config: { mode: "merge", providers: {} } },
  });
  apiMocks.getDefaultModel.mockResolvedValue({ data: { modelId: null } });
  apiMocks.getUtilityModel.mockResolvedValue({ data: { modelId: null } });
  apiMocks.getDesktopReady.mockResolvedValue({ data: {} });
  apiMocks.putProviderConfig.mockResolvedValue({ data: {} });
  apiMocks.getOauthProviderStatus.mockResolvedValue({
    data: { connected: false },
  });
  apiMocks.getOauthFlowStatus.mockResolvedValue({
    data: { status: "idle" },
  });
  apiMocks.startOauth.mockResolvedValue({
    data: { browserUrl: "https://example.test/oauth" },
  });
  apiMocks.disconnectOauth.mockResolvedValue({ data: { ok: true } });
});

function prepareOpenAiProvider() {
  routeMocks.search = "tab=providers&provider=openai";
  apiMocks.getRegistry.mockResolvedValue({
    data: {
      registry: [
        {
          id: "openai",
          canonicalOpenClawId: "openai",
          aliases: [],
          authModes: ["api-key", "oauth"],
          apiKind: "openai-responses",
          defaultBaseUrls: ["https://api.openai.com/v1"],
          controllerConfigurable: true,
          modelsPageVisible: true,
          displayName: "OpenAI",
          descriptionKey: "models.provider.openai.description",
          supportsCustomBaseUrl: true,
          supportsModelDiscovery: true,
        },
      ],
    },
  });
}

describe("model provider config baseline", () => {
  it("shows a retryable error and never saves when the baseline GET fails", async () => {
    apiMocks.getProviderConfig.mockResolvedValue({
      error: { message: "controller offline" },
    });

    renderPage();

    expect(
      await screen.findByText("models.providerConfigUnavailable"),
    ).toBeTruthy();
    expect(apiMocks.putProviderConfig).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "models.retry" }));

    await waitFor(() =>
      expect(apiMocks.getProviderConfig).toHaveBeenCalledTimes(2),
    );
    expect(apiMocks.putProviderConfig).not.toHaveBeenCalled();
  });

  it("surfaces provider registry SDK errors and retries the provider surface", async () => {
    apiMocks.getProviderConfig.mockResolvedValue({
      data: { config: { mode: "merge", providers: {} } },
    });
    apiMocks.getRegistry.mockResolvedValue({
      error: { message: "registry offline" },
    });

    renderPage();

    expect(
      await screen.findByText("models.providerConfigUnavailable"),
    ).toBeTruthy();
    expect(apiMocks.putProviderConfig).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "models.retry" }));

    await waitFor(() => expect(apiMocks.getRegistry).toHaveBeenCalledTimes(2));
    expect(apiMocks.putProviderConfig).not.toHaveBeenCalled();
  });

  it("surfaces model catalog SDK errors instead of treating them as no models", async () => {
    apiMocks.getProviderConfig.mockResolvedValue({
      data: { config: { mode: "merge", providers: {} } },
    });
    apiMocks.getModels.mockResolvedValue({
      error: { message: "models offline" },
    });

    renderPage();

    expect(
      await screen.findByText("models.providerConfigUnavailable"),
    ).toBeTruthy();
    expect(screen.queryByText("models.noModelConfigured")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "models.retry" }));

    await waitFor(() => expect(apiMocks.getModels).toHaveBeenCalledTimes(2));
    expect(apiMocks.putProviderConfig).not.toHaveBeenCalled();
  });

  it("retains every existing provider when adding a provider to a loaded baseline", () => {
    const baseline = {
      mode: "replace" as const,
      providers: {
        existing: {
          baseUrl: "https://existing.example/v1",
          apiKey: "existing-key",
          models: [],
        },
      },
    };
    const nextProvider = {
      baseUrl: "https://new.example/v1",
      apiKey: "new-key",
      models: [],
    };

    const merged = mergeProviderConfigForSave(
      baseline,
      "new-provider",
      nextProvider,
    );

    expect(merged).toEqual({
      mode: "replace",
      providers: {
        existing: baseline.providers.existing,
        "new-provider": nextProvider,
      },
    });
    expect(baseline.providers).toEqual({
      existing: {
        baseUrl: "https://existing.example/v1",
        apiKey: "existing-key",
        models: [],
      },
    });
    expect(() =>
      mergeProviderConfigForSave(undefined, "new-provider", nextProvider),
    ).toThrow("baseline is unavailable");
  });
});

describe("OpenAI OAuth errors", () => {
  it("shows an unavailable state when provider status fails and retries it", async () => {
    prepareOpenAiProvider();
    apiMocks.getOauthProviderStatus
      .mockResolvedValueOnce({ error: { message: "status offline" } })
      .mockResolvedValueOnce({ data: { connected: false } });

    renderPage();

    expect(
      await screen.findByText("models.byok.oauthUnavailable"),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "models.byok.oauthRetry" }),
    );

    await waitFor(() =>
      expect(apiMocks.getOauthProviderStatus).toHaveBeenCalledTimes(2),
    );
    expect(
      await screen.findByRole("button", {
        name: "models.byok.oauthLoginChatGPT",
      }),
    ).toBeTruthy();
  });

  it("reports an SDK error when starting login", async () => {
    prepareOpenAiProvider();
    apiMocks.startOauth.mockResolvedValue({
      error: { message: "start offline" },
    });

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "models.byok.oauthLoginChatGPT",
      }),
    );

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "models.byok.oauthStartFailed",
      ),
    );
    expect(screen.queryByText("models.byok.oauthPending")).toBeNull();
  });

  it("reports a desktop browser launch failure without entering pending", async () => {
    prepareOpenAiProvider();
    const invoke = vi.fn().mockRejectedValue(new Error("shell unavailable"));
    Object.defineProperty(window, "nexuHost", {
      configurable: true,
      value: { invoke },
    });

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "models.byok.oauthLoginChatGPT",
      }),
    );

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "models.byok.oauthBrowserOpenFailed",
      ),
    );
    expect(invoke).toHaveBeenCalledWith("shell:open-external", {
      url: "https://example.test/oauth",
    });
    expect(screen.queryByText("models.byok.oauthPending")).toBeNull();
  });

  it("keeps the connected state when disconnecting fails", async () => {
    prepareOpenAiProvider();
    apiMocks.getOauthProviderStatus.mockResolvedValue({
      data: { connected: true },
    });
    apiMocks.disconnectOauth.mockResolvedValue({
      error: { message: "disconnect offline" },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "models.byok.oauthDisconnect",
      }),
    );

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "models.byok.oauthDisconnectFailed",
      ),
    );
    expect(apiMocks.getOauthProviderStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByText("models.byok.oauthConnected")).toBeTruthy();
  });

  it("leaves pending after polling fails and resumes it on retry", async () => {
    prepareOpenAiProvider();
    apiMocks.getOauthFlowStatus
      .mockResolvedValueOnce({ error: { message: "poll offline" } })
      .mockResolvedValueOnce({ data: { status: "pending" } });
    vi.spyOn(window, "open").mockImplementation(() => null);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "models.byok.oauthLoginChatGPT",
      }),
    );

    expect(
      await screen.findByText("models.byok.oauthUnavailable"),
    ).toBeTruthy();
    expect(toastMocks.error).toHaveBeenCalledWith(
      "models.byok.oauthPollingFailed",
    );
    expect(screen.queryByText("models.byok.oauthPending")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "models.byok.oauthRetry" }),
    );

    expect(await screen.findByText("models.byok.oauthPending")).toBeTruthy();
    expect(
      apiMocks.getOauthFlowStatus.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });
});
