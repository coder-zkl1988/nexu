import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createSurfaceManager } from "../src/lib/a2ui/a2ui-surface";
import type {
  A2UIMessage,
  SliderComponent as SliderComp,
  VideoComponent as VideoComp,
} from "../src/lib/a2ui/a2ui-types";
import { SliderComponent } from "../src/lib/a2ui/components/Slider";
import { VideoComponent } from "../src/lib/a2ui/components/Video";

const resolveLiteral = <T>(val: T): unknown => val;

describe("a2ui v1.0 features (adopted ahead of the spec release)", () => {
  it("createSurface with inline components and dataModel builds the surface in one message", () => {
    const manager = createSurfaceManager();
    manager.processMessage({
      version: "v0.9",
      createSurface: {
        surfaceId: "s1",
        components: [
          { id: "root", type: "Column", children: ["greeting"] },
          { id: "greeting", type: "Text", text: "hi" },
        ],
        dataModel: { form: { name: "Ada" } },
      },
    } as A2UIMessage);

    const surface = manager.getSurface("s1");
    expect(surface).toBeDefined();
    if (!surface) return;
    expect(surface.components.size).toBe(2);
    expect(surface.rootComponentIds).toEqual(["root"]);
    expect(surface.dataModel).toEqual({ form: { name: "Ada" } });
  });

  it("inline createSurface produces the same state as the legacy three-message flow", () => {
    const components = [
      { id: "card", type: "Card", children: ["label"] },
      { id: "label", type: "Text", text: "x" },
    ];

    const inline = createSurfaceManager();
    inline.processMessage({
      version: "v0.9",
      createSurface: {
        surfaceId: "s",
        components,
        dataModel: { count: 3 },
      },
    } as A2UIMessage);

    const legacy = createSurfaceManager();
    legacy.processMessages([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      { version: "v0.9", updateComponents: { surfaceId: "s", components } },
      {
        version: "v0.9",
        updateDataModel: { surfaceId: "s", path: "/count", value: 3 },
      },
    ] as A2UIMessage[]);

    const a = inline.getSurface("s");
    const b = legacy.getSurface("s");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (!a || !b) return;
    expect([...a.components.keys()]).toEqual([...b.components.keys()]);
    expect(a.rootComponentIds).toEqual(b.rootComponentIds);
    expect(a.dataModel).toEqual(b.dataModel);
  });

  it("updateComponents still merges into a surface created with inline components", () => {
    const manager = createSurfaceManager();
    manager.processMessages([
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "s",
          components: [{ id: "a", type: "Text", text: "a" }],
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "b", type: "Text", text: "b" }],
        },
      },
    ] as A2UIMessage[]);

    const surface = manager.getSurface("s");
    expect(surface?.components.size).toBe(2);
    expect(surface?.rootComponentIds).toEqual(["a", "b"]);
  });

  it("Slider `steps` divides the range into discrete intervals and wins over `step`", () => {
    const comp: SliderComp = {
      id: "sl",
      type: "Slider",
      value: 0,
      min: 0,
      max: 50,
      step: 1,
      steps: 5,
    };
    const html = renderToStaticMarkup(
      createElement(SliderComponent, { comp, resolve: resolveLiteral }),
    );
    expect(html).toContain('step="10"');
  });

  it("Slider falls back to `step` when `steps` is absent", () => {
    const comp: SliderComp = {
      id: "sl",
      type: "Slider",
      value: 0,
      min: 0,
      max: 50,
      step: 5,
    };
    const html = renderToStaticMarkup(
      createElement(SliderComponent, { comp, resolve: resolveLiteral }),
    );
    expect(html).toContain('step="5"');
  });

  it("Video renders `posterUrl` as the poster attribute", () => {
    const comp: VideoComp = {
      id: "v",
      type: "Video",
      source: "https://example.com/v.mp4",
      posterUrl: "https://example.com/poster.jpg",
    };
    const html = renderToStaticMarkup(
      createElement(VideoComponent, { comp, resolve: resolveLiteral }),
    );
    expect(html).toContain('poster="https://example.com/poster.jpg"');
  });

  it("Video omits poster when posterUrl is absent", () => {
    const comp: VideoComp = {
      id: "v",
      type: "Video",
      source: "https://example.com/v.mp4",
    };
    const html = renderToStaticMarkup(
      createElement(VideoComponent, { comp, resolve: resolveLiteral }),
    );
    expect(html).not.toContain("poster=");
  });
});
