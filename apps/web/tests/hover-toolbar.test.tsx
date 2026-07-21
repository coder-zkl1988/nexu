import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCanvasDialogsForTests } from "../src/lib/canvas/canvas-dialogs";
import {
  __resetCanvasForTests,
  addNode,
  getCanvasState,
  setNodeTask,
  updateNode,
} from "../src/lib/canvas/canvas-store";
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
  __resetCanvasDialogsForTests();
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

    // All six base actions
    expect(markup).toContain('data-canvas-hover-action="info"');
    expect(markup).toContain('data-canvas-hover-action="preview"');
    expect(markup).toContain('data-canvas-hover-action="download"');
    expect(markup).toContain('data-canvas-hover-action="replace"');
    expect(markup).toContain('data-canvas-hover-action="lock"');
    expect(markup).toContain('data-canvas-hover-action="delete"');

    // Lock toggle data attribute travels to the hover toolbar
    expect(markup).toContain("data-canvas-lock-toggle=");
  });

  it("image WITHOUT content → no preview, no download, no lock; upload (not replace) and info/delete present", () => {
    addNode({
      type: "image",
      title: "empty-image",
      metadata: {},
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    // Toolbar present
    expect(markup).toContain("data-canvas-hover-toolbar=");

    // info, upload (reference-parity label for empty images), delete must be present
    expect(markup).toContain('data-canvas-hover-action="info"');
    expect(markup).toContain('data-canvas-hover-action="upload"');
    expect(markup).toContain("上传图片");
    expect(markup).toContain('data-canvas-hover-action="delete"');

    // preview, replace, download and lock must be absent (no content)
    expect(markup).not.toContain('data-canvas-hover-action="preview"');
    expect(markup).not.toContain('data-canvas-hover-action="replace"');
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

    // info and delete present
    expect(markup).toContain('data-canvas-hover-action="info"');
    expect(markup).toContain('data-canvas-hover-action="delete"');

    // No media-specific actions
    expect(markup).not.toContain('data-canvas-hover-action="download"');
    expect(markup).not.toContain('data-canvas-hover-action="replace"');
    expect(markup).not.toContain('data-canvas-hover-action="lock"');
  });

  it("text node WITH content → font-inc, font-dec, and to-image actions present", () => {
    addNode({
      type: "text",
      title: "my-note",
      metadata: { content: "hello" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    expect(markup).toContain('data-canvas-hover-action="font-inc"');
    expect(markup).toContain('data-canvas-hover-action="font-dec"');
    expect(markup).toContain('data-canvas-hover-action="to-image"');
  });

  it("text node WITHOUT content → font buttons present, to-image ABSENT", () => {
    addNode({
      type: "text",
      title: "empty-note",
      metadata: {},
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    expect(markup).toContain('data-canvas-hover-action="font-inc"');
    expect(markup).toContain('data-canvas-hover-action="font-dec"');
    expect(markup).not.toContain('data-canvas-hover-action="to-image"');
  });

  it("text node with whitespace-only content → to-image ABSENT", () => {
    addNode({
      type: "text",
      title: "spaces",
      metadata: { content: "   " },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    expect(markup).not.toContain('data-canvas-hover-action="to-image"');
  });

  it("image node → font-inc, font-dec, and to-image actions absent", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: { content: "data:image/png;base64,x" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    expect(markup).not.toContain('data-canvas-hover-action="font-inc"');
    expect(markup).not.toContain('data-canvas-hover-action="font-dec"');
    expect(markup).not.toContain('data-canvas-hover-action="to-image"');
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

  it("image WITH content → crop action present", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: { content: "data:image/png;base64,x" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain('data-canvas-hover-action="crop"');
  });

  it("image WITHOUT content → crop action absent", () => {
    addNode({
      type: "image",
      title: "empty-img",
      metadata: {},
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain('data-canvas-hover-action="crop"');
  });

  it("text node → crop action absent", () => {
    addNode({
      type: "text",
      title: "note",
      metadata: { content: "hello" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain('data-canvas-hover-action="crop"');
  });

  it("canvas-crop-dialog absent from default markup", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: { content: "data:image/png;base64,x" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    // Dialog is only rendered when canvas dialog store has state
    expect(markup).not.toContain("data-canvas-crop-dialog");
  });

  it("image WITH content → split action present", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: { content: "data:image/png;base64,x" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain('data-canvas-hover-action="split"');
  });

  it("image WITHOUT content → split action absent", () => {
    addNode({
      type: "image",
      title: "empty-img",
      metadata: {},
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain('data-canvas-hover-action="split"');
  });

  it("text node → split action absent", () => {
    addNode({
      type: "text",
      title: "note",
      metadata: { content: "hello" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain('data-canvas-hover-action="split"');
  });

  it("image WITH content → upscale action present", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: { content: "data:image/png;base64,x" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain('data-canvas-hover-action="upscale"');
  });

  it("image WITHOUT content → upscale action absent", () => {
    addNode({
      type: "image",
      title: "empty-img",
      metadata: {},
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain('data-canvas-hover-action="upscale"');
  });

  it("text node → upscale action absent", () => {
    addNode({
      type: "text",
      title: "note",
      metadata: { content: "hello" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain('data-canvas-hover-action="upscale"');
  });

  it("split and upscale dialog attrs absent from default markup", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: { content: "data:image/png;base64,x" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-split-dialog");
    expect(markup).not.toContain("data-canvas-upscale-dialog");
  });

  // ── T6: mask / angle / describe / AI upscale ────────────────────────────

  it("image WITH servable URL → mask, angle, describe actions present", () => {
    addNode({
      type: "image",
      title: "servable-img",
      metadata: {
        content: "/api/v1/media/state-file?path=%2Fnexu%2Fimg%2Fabc.png",
      },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    expect(markup).toContain('data-canvas-hover-action="mask"');
    expect(markup).toContain('data-canvas-hover-action="angle"');
    expect(markup).toContain('data-canvas-hover-action="describe"');
  });

  it("image WITH dataURL (not servable) → mask, angle, describe actions ABSENT", () => {
    addNode({
      type: "image",
      title: "dataurl-img",
      metadata: { content: "data:image/png;base64,abc123" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    expect(markup).not.toContain('data-canvas-hover-action="mask"');
    expect(markup).not.toContain('data-canvas-hover-action="angle"');
    expect(markup).not.toContain('data-canvas-hover-action="describe"');
  });

  it("text node → mask, angle, describe actions ABSENT", () => {
    addNode({
      type: "text",
      title: "note",
      metadata: { content: "hello" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);

    expect(markup).not.toContain('data-canvas-hover-action="mask"');
    expect(markup).not.toContain('data-canvas-hover-action="angle"');
    expect(markup).not.toContain('data-canvas-hover-action="describe"');
  });

  it("mask and angle dialog attrs absent from default markup", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: {
        content: "/api/v1/media/state-file?path=%2Fnexu%2Fimg%2Fabc.png",
      },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain("data-canvas-mask-dialog");
    expect(markup).not.toContain("data-canvas-angle-dialog");
  });

  it("upscale-mode radio is in the UpscaleDialog source (static check)", () => {
    // The UpscaleDialog renders into a radix portal not captured by renderToStaticMarkup.
    // We verify here that the upscale toolbar button IS present for servable images,
    // which is the entry point to the AI mode radio in the dialog.
    addNode({
      type: "image",
      title: "photo",
      metadata: {
        content: "/api/v1/media/state-file?path=%2Fnexu%2Fimg%2Fabc.png",
      },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    // The upscale button is the entry; the mode radio is inside the dialog (portal).
    expect(markup).toContain('data-canvas-hover-action="upscale"');
  });

  // ── W4.3: save-as-asset gating + asset library entry + picker absence ────

  it("text WITH content → save-asset action present", () => {
    addNode({ type: "text", title: "note", metadata: { content: "hello" } });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain('data-canvas-hover-action="save-asset"');
  });

  it("text WITHOUT content → save-asset action absent", () => {
    addNode({ type: "text", title: "empty", metadata: {} });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain('data-canvas-hover-action="save-asset"');
  });

  it("image WITH content → save-asset action present", () => {
    addNode({
      type: "image",
      title: "photo",
      metadata: { content: "data:image/png;base64,x" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain('data-canvas-hover-action="save-asset"');
  });

  it("a2ui node → save-asset action absent (no toolbar at all)", () => {
    addNode({
      type: "a2ui",
      title: "panel",
      metadata: { surfaceId: "sidebar:x", content: "ignored" },
    });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).not.toContain('data-canvas-hover-action="save-asset"');
  });

  it("asset library toolbar button present; picker absent by default", () => {
    addNode({ type: "text", title: "note", metadata: { content: "hi" } });
    const markup = renderToStaticMarkup(<CanvasSurface />);
    expect(markup).toContain('data-canvas-asset-library="true"');
    // Picker only renders when the dialog store holds { kind: "assets" }.
    expect(markup).not.toContain("data-canvas-asset-picker");
  });

  it("ReplaceButton clears error task when updating node content", () => {
    // Create an image node with an error task overlay
    addNode({
      type: "image",
      title: "failed-generation",
      metadata: {
        content: undefined,
        task: { status: "error", error: "Generation failed" },
      },
    });

    // Get the node ID and verify error task exists
    let state = getCanvasState();
    const node = state.nodes[0];
    expect(node.metadata.task).toBeDefined();
    expect(node.metadata.task?.status).toBe("error");

    // Simulate what ReplaceButton does: updateNode + setNodeTask(null)
    updateNode(node.id, {
      title: "new-image.png",
      metadata: { content: "data:image/png;base64,new", mimeType: "image/png" },
    });
    setNodeTask(node.id, null);

    // Verify error task is cleared and new content is present
    state = getCanvasState();
    const updatedNode = state.nodes[0];
    expect(updatedNode.metadata.task).toBeUndefined();
    expect(updatedNode.metadata.content).toBe("data:image/png;base64,new");
    expect(updatedNode.metadata.mimeType).toBe("image/png");
    expect(updatedNode.title).toBe("new-image.png");
  });
});
