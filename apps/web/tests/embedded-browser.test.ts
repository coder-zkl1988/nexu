import { describe, expect, it } from "vitest";
import {
  buildArrowPath,
  clampAnnotationFontSize,
  getAnnotationInputFontSize,
  getAnnotationTextInputPosition,
} from "../src/lib/browser/browser-annotation-editor";
import {
  closeBrowserPanel,
  closeBrowserPanelForRouting,
  closeBrowserPanelForSessionNavigation,
  getBrowserPanelState,
  openBrowserPanel,
  openUrlInBrowserPanel,
  releaseAgentBrowserPanelPin,
  resetBrowserPanelForTests,
} from "../src/lib/browser/browser-panel-store";
import {
  createPreviewAutoOpenTracker,
  observePreviewArtifact,
} from "../src/lib/browser/browser-preview-auto-open";
import {
  buildDesktopBrowserHistoryItems,
  isPreviewArtifactActive,
  normalizeBrowserUrl,
  pushBrowserHistory,
  resolveBrowserViewportLayout,
  selectBrowserNavigationTarget,
  selectLatestPreviewArtifact,
  sortPreviewArtifacts,
} from "../src/lib/browser/embedded-browser";

describe("embedded browser helpers", () => {
  it("fills the available browser area in responsive mode", () => {
    expect(
      resolveBrowserViewportLayout(
        { x: 100, y: 80, width: 900, height: 700 },
        "responsive",
      ),
    ).toEqual({
      bounds: { x: 100, y: 80, width: 900, height: 700 },
      zoomFactor: 1,
    });
  });

  it("centers a mobile viewport at its native CSS size when space allows", () => {
    expect(
      resolveBrowserViewportLayout(
        { x: 0, y: 0, width: 1000, height: 1000 },
        "mobile",
      ),
    ).toEqual({
      bounds: { x: 312.5, y: 94, width: 375, height: 812 },
      zoomFactor: 1,
    });
  });

  it("scales a tablet viewport uniformly while preserving its CSS dimensions", () => {
    const layout = resolveBrowserViewportLayout(
      { x: 20, y: 30, width: 500, height: 700 },
      "tablet",
    );

    expect(layout.zoomFactor).toBeCloseTo(468 / 768);
    expect(layout.bounds.x).toBeCloseTo(36);
    expect(layout.bounds.y).toBeCloseTo(68);
    expect(layout.bounds.width).toBeCloseTo(468);
    expect(layout.bounds.height).toBeCloseTo(624);
  });

  it("normalizes public and local addresses while rejecting unsafe protocols", () => {
    expect(normalizeBrowserUrl("example.com/demo")).toBe(
      "https://example.com/demo",
    );
    expect(normalizeBrowserUrl("localhost:4173")).toBe(
      "http://localhost:4173/",
    );
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBrowserUrl("not a url")).toBeNull();
  });

  it("drops forward history after navigating from an older entry", () => {
    const history = {
      entries: ["https://one.test/", "https://two.test/"],
      index: 0,
    };

    expect(pushBrowserHistory(history, "https://three.test/")).toEqual({
      entries: ["https://one.test/", "https://three.test/"],
      index: 1,
    });
  });

  it("selects the newest live artifact with a safe preview URL", () => {
    expect(
      selectLatestPreviewArtifact([
        {
          id: "building",
          title: "Building",
          status: "building",
          previewUrl: "https://building.test",
          createdAt: "2026-07-27T10:00:00.000Z",
        },
        {
          id: "older",
          title: "Older",
          status: "live",
          previewUrl: "https://older.test",
          createdAt: "2026-07-27T09:00:00.000Z",
        },
        {
          id: "latest",
          title: "Latest",
          status: "live",
          previewUrl: "https://latest.test",
          createdAt: "2026-07-27T11:00:00.000Z",
        },
      ])?.id,
    ).toBe("latest");
  });

  it("sorts generated page versions newest first without mutating input", () => {
    const artifacts = [
      {
        id: "older",
        title: "Older",
        status: "live",
        previewUrl: "https://preview.test/v1",
        createdAt: "2026-07-27T09:00:00.000Z",
      },
      {
        id: "newer",
        title: "Newer",
        status: "live",
        previewUrl: "https://preview.test/v2",
        createdAt: "2026-07-27T10:00:00.000Z",
      },
    ];

    expect(
      sortPreviewArtifacts(artifacts).map((artifact) => artifact.id),
    ).toEqual(["newer", "older"]);
    expect(artifacts.map((artifact) => artifact.id)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("marks a generated page version active across cache-busting queries", () => {
    expect(
      isPreviewArtifactActive(
        {
          id: "current",
          title: "Current",
          status: "live",
          previewUrl: "http://127.0.0.1:4173/index.html",
          createdAt: "2026-07-27T10:00:00.000Z",
        },
        "http://127.0.0.1:4173/index.html?version=2#preview",
      ),
    ).toBe(true);
  });

  it("builds native history menu items with active version state", () => {
    expect(
      buildDesktopBrowserHistoryItems(
        [
          {
            id: "current",
            title: "当前版本",
            status: "live",
            previewUrl: "https://preview.test/current",
            createdAt: "invalid",
          },
          {
            id: "older",
            title: "较早版本",
            status: "live",
            previewUrl: "https://preview.test/older",
            createdAt: "invalid",
          },
        ],
        "https://preview.test/current?version=2",
      ),
    ).toEqual([
      {
        id: "current",
        label: "当前版本",
        sublabel: "生成时间未知",
        selected: true,
      },
      {
        id: "older",
        label: "较早版本",
        sublabel: "生成时间未知",
        selected: false,
      },
    ]);
  });

  it("auto-opens an artifact generated after the session watcher starts", () => {
    const observation = observePreviewArtifact({
      tracker: createPreviewAutoOpenTracker(),
      sessionKey: "agent:bot:session",
      artifact: {
        id: "fresh-preview",
        createdAt: "2026-07-27T10:00:02.000Z",
      },
      now: Date.parse("2026-07-27T10:00:05.000Z"),
    });

    expect(observation.shouldOpen).toBe(true);
    expect(observation.tracker.lastArtifactId).toBe("fresh-preview");
  });

  it("does not auto-open a stale initial preview or reopen the same preview", () => {
    const stale = observePreviewArtifact({
      tracker: createPreviewAutoOpenTracker(),
      sessionKey: "agent:bot:session",
      artifact: {
        id: "existing-preview",
        createdAt: "2026-07-27T09:00:00.000Z",
      },
      now: Date.parse("2026-07-27T10:00:00.000Z"),
    });
    const repeated = observePreviewArtifact({
      tracker: stale.tracker,
      sessionKey: "agent:bot:session",
      artifact: {
        id: "existing-preview",
        createdAt: "2026-07-27T09:00:00.000Z",
      },
      now: Date.parse("2026-07-27T10:00:02.000Z"),
    });

    expect(stale.shouldOpen).toBe(false);
    expect(repeated.shouldOpen).toBe(false);
  });

  it("auto-opens a newer preview after baselining an existing one", () => {
    const baseline = observePreviewArtifact({
      tracker: createPreviewAutoOpenTracker(),
      sessionKey: "agent:bot:session",
      artifact: {
        id: "existing-preview",
        createdAt: "2026-07-27T09:00:00.000Z",
      },
      now: Date.parse("2026-07-27T10:00:00.000Z"),
    });
    const generated = observePreviewArtifact({
      tracker: baseline.tracker,
      sessionKey: "agent:bot:session",
      artifact: {
        id: "generated-preview",
        createdAt: "2026-07-27T10:01:00.000Z",
      },
      now: Date.parse("2026-07-27T10:01:02.000Z"),
    });

    expect(generated.shouldOpen).toBe(true);
  });

  it("closes an open browser when navigation switches sessions", () => {
    resetBrowserPanelForTests();
    openBrowserPanel("agent:bot:session-a");

    expect(
      closeBrowserPanelForSessionNavigation(
        "/workspace/sessions/session-a",
        "/workspace/sessions/session-a",
      ),
    ).toBe(false);
    expect(getBrowserPanelState().isOpen).toBe(true);

    expect(
      closeBrowserPanelForSessionNavigation(
        "/workspace/sessions/session-a",
        "/workspace/sessions/session-b",
      ),
    ).toBe(true);
    expect(getBrowserPanelState()).toEqual({
      isOpen: false,
      sessionKey: null,
      navigationRequest: null,
      openedByAgent: false,
    });
  });

  it("opens a session link with a fresh navigation request", () => {
    resetBrowserPanelForTests();

    expect(
      openUrlInBrowserPanel(
        "agent:bot:session-a",
        "http://127.0.0.1:4173/index.html",
      ),
    ).toBe(true);
    const first = getBrowserPanelState();
    expect(first.openedByAgent).toBe(false);
    expect(first.navigationRequest?.url).toBe(
      "http://127.0.0.1:4173/index.html",
    );

    expect(
      openUrlInBrowserPanel("agent:bot:session-a", "https://example.com/demo"),
    ).toBe(true);
    const second = getBrowserPanelState();
    expect(second.navigationRequest?.id).toBeGreaterThan(
      first.navigationRequest?.id ?? 0,
    );
    expect(second.openedByAgent).toBe(false);
  });

  it("does not retarget an agent-pinned panel", () => {
    resetBrowserPanelForTests();
    openBrowserPanel("agent:bot:session-a", true);

    expect(
      openUrlInBrowserPanel("agent:bot:session-a", "https://example.com/demo"),
    ).toBe(false);
    expect(getBrowserPanelState()).toEqual({
      isOpen: true,
      sessionKey: "agent:bot:session-a",
      navigationRequest: null,
      openedByAgent: true,
    });
  });

  it("never chooses the current agent tab as a navigation replacement", () => {
    const tabs = Array.from({ length: 8 }, (_, index) => ({
      id: index === 0 ? "agent-tab" : `user-tab-${index}`,
      url: `https://tab-${index}.test/`,
    }));

    expect(
      selectBrowserNavigationTarget(
        tabs,
        "agent-tab",
        "https://requested.test/",
        "agent-tab",
      ),
    ).toEqual({ kind: "replace", tabId: "user-tab-1" });
  });

  it("keeps an agent's browser open across navigation", () => {
    // The panel is what places the browser view, so closing it mid-task does
    // not just hide the work — it stops the agent's clicks from landing.
    resetBrowserPanelForTests();
    openBrowserPanel("agent:bot:session-a", true);

    expect(
      closeBrowserPanelForSessionNavigation(
        "/workspace/sessions/session-a",
        "/workspace/sessions/session-b",
      ),
    ).toBe(false);
    expect(closeBrowserPanelForRouting()).toBe(false);
    expect(getBrowserPanelState().isOpen).toBe(true);

    // An explicit close still ends it.
    closeBrowserPanel();
    expect(getBrowserPanelState().isOpen).toBe(false);
  });

  it("releases the agent pin when the run ends, keeping the panel open", () => {
    // The pin protects an agent mid-task; once the run is over it has no
    // purpose. The panel stays up — the user may be reading the result — but
    // goes back to closing on navigation like any other workbench.
    resetBrowserPanelForTests();
    openBrowserPanel("agent:bot:session-a", true);

    releaseAgentBrowserPanelPin();

    expect(getBrowserPanelState().isOpen).toBe(true);
    expect(getBrowserPanelState().openedByAgent).toBe(false);
    expect(
      closeBrowserPanelForSessionNavigation(
        "/workspace/sessions/session-a",
        "/workspace/sessions/session-b",
      ),
    ).toBe(true);
    expect(getBrowserPanelState().isOpen).toBe(false);
  });

  it("builds a visible arrow head at the annotation endpoint", () => {
    const path = buildArrowPath({ x: 10, y: 20 }, { x: 110, y: 20 });

    expect(path).toContain("M 10 20 L 110 20");
    expect(path.match(/L 110 20/gu)).toHaveLength(2);
  });

  it("clamps annotation text size to the supported range", () => {
    expect(clampAnnotationFontSize(8)).toBe(14);
    expect(clampAnnotationFontSize(36)).toBe(36);
    expect(clampAnnotationFontSize(120)).toBe(72);
  });

  it("matches the text input size to the rendered screenshot scale", () => {
    expect(getAnnotationInputFontSize(24, 0.5)).toBe(12);
    expect(getAnnotationInputFontSize(24, 1.25)).toBe(30);
    expect(getAnnotationInputFontSize(24, 0)).toBe(24);
  });

  it("anchors the annotation input to the SVG text baseline", () => {
    expect(
      getAnnotationTextInputPosition(
        { x: 500, y: 400 },
        { width: 1000, height: 800 },
      ),
    ).toEqual({
      left: "50%",
      top: "50%",
      transform: "translate(0, -100%)",
    });
    expect(
      getAnnotationTextInputPosition(
        { x: 990, y: 790 },
        { width: 1000, height: 800 },
      ),
    ).toEqual({
      left: "99%",
      top: "98.75%",
      transform: "translate(0, -100%)",
    });
  });
});
