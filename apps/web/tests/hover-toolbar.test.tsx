import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCanvasForTests, addNode } from "../src/lib/canvas/canvas-store";
import { CanvasSurface } from "../src/lib/canvas/infinite-canvas";

// Mock hooks used by TeamStepNodeContent to avoid QueryClient requirement
// when rendering via renderToStaticMarkup.
vi.mock("../src/hooks/use-teams", () => ({
  useTeamBoard: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("../src/hooks/use-team-workflows", () => ({
  useWorkflowApprovals: () => ({ data: undefined }),
  useApproveWorkflowStep: () => ({ mutate: vi.fn() }),
}));

// Minimal localStorage stub (same as infinite-canvas.test.tsx)
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function renderWithClient(ui: React.ReactElement): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  __resetCanvasForTests();
});

describe("HoverToolbar", () => {
  it("image WITH content → toolbar present with info/download/replace/lock/delete", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: { content: "data:image/png;base64,x" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    // Toolbar container present
    expect(markup).toContain("data-canvas-hover-toolbar=");

    // All five base actions
    expect(markup).toContain('data-canvas-hover-action="info"');
    expect(markup).toContain('data-canvas-hover-action="download"');
    expect(markup).toContain('data-canvas-hover-action="replace"');
    expect(markup).toContain('data-canvas-hover-action="lock"');
    expect(markup).toContain('data-canvas-hover-action="delete"');

    // Lock toggle data attribute travels to the hover toolbar
    expect(markup).toContain("data-canvas-lock-toggle=");
  });

  it("image WITHOUT content → no download, no lock; replace and info/delete present", () => {
    addNode({
      type: "image",
      title: "empty-image",
      metadata: {},
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    // Toolbar present
    expect(markup).toContain("data-canvas-hover-toolbar=");

    // info, replace, delete must be present
    expect(markup).toContain('data-canvas-hover-action="info"');
    expect(markup).toContain('data-canvas-hover-action="replace"');
    expect(markup).toContain('data-canvas-hover-action="delete"');

    // download and lock must be absent (no content)
    expect(markup).not.toContain('data-canvas-hover-action="download"');
    expect(markup).not.toContain('data-canvas-hover-action="lock"');
    expect(markup).not.toContain("data-canvas-lock-toggle=");
  });

  it("text node → toolbar with info/delete only (no download/replace/lock)", () => {
    addNode({
      type: "text",
      title: "my-note",
      metadata: { content: "hello" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    // Toolbar present
    expect(markup).toContain("data-canvas-hover-toolbar=");

    // Only info and delete
    expect(markup).toContain('data-canvas-hover-action="info"');
    expect(markup).toContain('data-canvas-hover-action="delete"');

    // No media-specific actions
    expect(markup).not.toContain('data-canvas-hover-action="download"');
    expect(markup).not.toContain('data-canvas-hover-action="replace"');
    expect(markup).not.toContain('data-canvas-hover-action="lock"');
  });

  it("a2ui node → NO data-canvas-hover-toolbar in markup", () => {
    addNode({
      type: "a2ui",
      title: "panel",
      metadata: { surfaceId: "sidebar:run-1" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-hover-toolbar=");
  });

  it("team-step node → NO data-canvas-hover-toolbar in markup", () => {
    addNode({
      type: "team-step",
      title: "step-1",
      metadata: {
        step: {
          teamId: "t1",
          cardId: "c1",
          assigneeName: "Agent",
        },
      },
    });
    const markup = renderWithClient(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-hover-toolbar=");
  });
});
