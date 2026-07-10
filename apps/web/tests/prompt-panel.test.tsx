/**
 * prompt-panel.test.tsx
 *
 * W5.2–W5.5: per-mode generation settings + model picker on the prompt panel.
 *
 * Plain-Node env → renderToStaticMarkup (no jsdom/testing-library), matching the
 * neighboring canvas render tests. Static markup can't fire the generate button,
 * so the "forwards a chosen setting into generate*IntoNode" contract is pinned on
 * the pure build*GenOpts builders — the exact seam handleGenerate calls. The
 * render tests assert every mode's controls appear (incl. the SDK-fed model
 * picker options).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "../src/lib/canvas/canvas-store";
import { __resetCanvasForTests, addNode } from "../src/lib/canvas/canvas-store";
import { PromptPanel } from "../src/lib/canvas/prompt-panel";
import {
  buildAudioGenOpts,
  buildImageGenOpts,
  buildVideoGenOpts,
} from "../src/lib/canvas/prompt-panel-utils";

// Mock the SDK so importing the real client is unnecessary. getApiV1Models is
// never invoked under renderToStaticMarkup (no effects run) — model options come
// from the query cache seeded below.
vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Models: vi.fn(),
  postApiV1MediaGenerateImage: vi.fn(),
  postApiV1MediaGenerateVideo: vi.fn(),
  postApiV1MediaGenerateAudio: vi.fn(),
}));

// Minimal localStorage polyfill (plain Node env, same as sibling canvas tests).
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

function renderPanel(node: CanvasNode): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Seed the ["models"] cache so the picker renders options synchronously.
  queryClient.setQueryData(["models"], {
    models: [
      { id: "openai/gpt-image-1", name: "GPT Image 1", provider: "openai" },
      { id: "google/veo-3", name: "Veo 3", provider: "google" },
    ],
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <PromptPanel node={node} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  __resetCanvasForTests();
  vi.clearAllMocks();
});

describe("PromptPanel controls per mode", () => {
  it("image: renders 质量/比例/尺寸/数量 + model picker with seeded options", () => {
    const node = addNode({ type: "image", title: "图" });
    const markup = renderPanel(node);
    expect(markup).toContain("质量");
    expect(markup).toContain("比例");
    expect(markup).toContain("尺寸");
    expect(markup).toContain("数量");
    // quality union options
    expect(markup).toContain(">high<");
    expect(markup).toContain(">low<");
    // count bumped 1..12
    expect(markup).toContain('value="12"');
    // model picker: default + SDK-fed options
    expect(markup).toContain("模型");
    expect(markup).toContain("默认模型");
    expect(markup).toContain("GPT Image 1");
    expect(markup).toContain("Veo 3");
  });

  it("video: renders 生成声音/水印/比例 (+ 时长/分辨率) + model picker", () => {
    const node = addNode({ type: "video", title: "视" });
    const markup = renderPanel(node);
    expect(markup).toContain("生成声音");
    expect(markup).toContain("水印");
    expect(markup).toContain("比例");
    expect(markup).toContain("时长(秒)");
    expect(markup).toContain("分辨率");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("模型");
    expect(markup).toContain("默认模型");
  });

  it("audio: renders 格式/声音指令 (+ 音色/语速) + model picker", () => {
    const node = addNode({ type: "audio", title: "音" });
    const markup = renderPanel(node);
    expect(markup).toContain("格式");
    expect(markup).toContain("声音指令");
    expect(markup).toContain("音色");
    expect(markup).toContain("语速");
    // format union options
    expect(markup).toContain(">mp3<");
    expect(markup).toContain(">flac<");
    expect(markup).toContain("模型");
  });

  it("always renders the generate button", () => {
    const node = addNode({ type: "image", title: "图" });
    const markup = renderPanel(node);
    expect(markup).toContain("data-canvas-panel-generate");
    expect(markup).toContain("生成");
  });
});

// The forwarding seam handleGenerate uses. Chosen hints flow through; defaults
// (auto / 默认 / empty / count 1 / speed 1 / unchecked) are omitted so the
// backend keeps its own default.
describe("buildImageGenOpts", () => {
  it("forwards chosen quality/aspectRatio/model; omits count 1 + empty size", () => {
    expect(
      buildImageGenOpts({
        referenceImages: undefined,
        count: 1,
        model: "openai/gpt-image-1",
        quality: "high",
        aspectRatio: "16:9",
        size: "",
      }),
    ).toEqual({
      model: "openai/gpt-image-1",
      quality: "high",
      aspectRatio: "16:9",
    });
  });

  it("all defaults → empty opts", () => {
    expect(
      buildImageGenOpts({
        referenceImages: undefined,
        count: 1,
        model: "",
        quality: "auto",
        aspectRatio: "",
        size: "",
      }),
    ).toEqual({});
  });

  it("forwards referenceImages + count>1 + size", () => {
    expect(
      buildImageGenOpts({
        referenceImages: ["/img/a.png"],
        count: 4,
        model: "",
        quality: "auto",
        aspectRatio: "",
        size: "2K",
      }),
    ).toEqual({ referenceImages: ["/img/a.png"], count: 4, size: "2K" });
  });
});

describe("buildVideoGenOpts", () => {
  it("forwards aspectRatio/generateAudio/watermark/model; keeps duration+resolution", () => {
    expect(
      buildVideoGenOpts({
        durationSeconds: 8,
        resolution: "1080p",
        aspectRatio: "9:16",
        generateAudio: true,
        watermark: true,
        model: "google/veo-3",
      }),
    ).toEqual({
      durationSeconds: 8,
      resolution: "1080p",
      aspectRatio: "9:16",
      generateAudio: true,
      watermark: true,
      model: "google/veo-3",
    });
  });

  it("omits unchecked booleans + empty aspect/model", () => {
    expect(
      buildVideoGenOpts({
        durationSeconds: 5,
        resolution: "720p",
        aspectRatio: "",
        generateAudio: false,
        watermark: false,
        model: "",
      }),
    ).toEqual({ durationSeconds: 5, resolution: "720p" });
  });
});

describe("buildAudioGenOpts", () => {
  it("forwards format/instructions/model; trims voice+instructions", () => {
    expect(
      buildAudioGenOpts({
        voice: " nova ",
        speed: 1.5,
        model: "openai/tts-1",
        format: "wav",
        instructions: "  keep it calm  ",
      }),
    ).toEqual({
      voice: "nova",
      speed: 1.5,
      model: "openai/tts-1",
      format: "wav",
      instructions: "keep it calm",
    });
  });

  it("omits default voice/speed/model/format/instructions", () => {
    expect(
      buildAudioGenOpts({
        voice: "",
        speed: 1,
        model: "",
        format: "",
        instructions: "",
      }),
    ).toEqual({});
  });
});
