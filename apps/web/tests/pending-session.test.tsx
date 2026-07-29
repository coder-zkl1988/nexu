import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PendingSessionPage } from "../src/pages/pending-session";

vi.mock("@/lib/api/event-source", () => ({
  createLocalStreamSSEClient: () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock("../src/lib/local-chat-session", () => ({
  waitForLocalChatSession: vi.fn(async () => null),
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Bots: vi.fn(async () => ({
    data: {
      bots: [
        {
          id: "bot-1",
          name: "Tabby",
          slug: "tabby",
          status: "active",
          modelId: "model-1",
        },
      ],
    },
  })),
  getApiV1ChatSession: vi.fn(async () => ({
    data: {
      session: null,
    },
  })),
  getApiV1Models: vi.fn(async () => ({
    data: {
      models: [],
    },
  })),
}));

vi.mock("@/hooks/use-community-catalog", () => ({
  useCommunitySkillStatus: () => ({
    data: {
      installedSkills: [],
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "sessions.pending.waiting" && values?.name) {
        return `Waiting for ${String(values.name)} to reply...`;
      }
      if (key === "sessions.chat.messages" && values?.count != null) {
        return `${String(values.count)} messages`;
      }
      return key;
    },
  }),
}));

describe("PendingSessionPage", () => {
  it("uses the same centered chat layout and input shell as session detail", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    queryClient.setQueryData(["bots"], {
      bots: [
        {
          id: "bot-1",
          name: "Researcher",
          slug: "tabby",
          status: "active",
          modelId: "model-1",
        },
      ],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/workspace/sessions/pending",
              search:
                "?botId=bot-1&sessionKey=agent%3Abot-1%3Amain&runId=run-1",
              state: {
                pendingText: "hello",
                pendingBotName: "Fallback Expert",
              },
            },
          ]}
        >
          <Routes>
            <Route
              path="/workspace/sessions/pending"
              element={<PendingSessionPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain('data-chat-layout="centered"');
    expect(markup).toContain('data-pending-session="agent:bot-1:main"');
    expect(markup).toContain('data-chat-role="user"');
    expect(markup).toContain('data-chat-role="assistant"');
    expect(markup).toContain("bg-surface-3");
    expect(markup).not.toContain("bg-text-primary");
    expect(markup).toContain("Waiting for Researcher to reply...");
    expect(markup).toContain("hello");
    expect(markup).toContain("localChat.inputPlaceholder");
  });
});
