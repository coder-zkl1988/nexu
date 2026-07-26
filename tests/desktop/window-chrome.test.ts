import { describe, expect, it } from "vitest";
import {
  TRANSPARENT_WINDOW_BACKGROUND_COLOR,
  resolveDeskpetWindowChromeOptions,
  resolveMainWindowChromeOptions,
} from "../../apps/desktop/main/window-chrome";

describe("resolveMainWindowChromeOptions", () => {
  it("keeps the transparent inset title bar on macOS", () => {
    expect(resolveMainWindowChromeOptions("darwin")).toEqual({
      backgroundColor: "#00000000",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
      transparent: true,
      vibrancy: "sidebar",
      visualEffectState: "followWindow",
    });
  });

  it("uses an overlay title bar and hidden menu on Windows", () => {
    expect(resolveMainWindowChromeOptions("win32")).toEqual({
      autoHideMenuBar: true,
      backgroundColor: "#FAFAFA",
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#FAFAFA",
        symbolColor: "#27272A",
        height: 38,
      },
    });
  });

  it("preserves the existing Linux window chrome", () => {
    expect(resolveMainWindowChromeOptions("linux")).toEqual({
      backgroundColor: "#0B1020",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
    });
  });

  it("keeps the deskpet window fully transparent and frameless", () => {
    expect(resolveDeskpetWindowChromeOptions()).toEqual({
      backgroundColor: TRANSPARENT_WINDOW_BACKGROUND_COLOR,
      frame: false,
      hasShadow: false,
      transparent: true,
    });
  });
});
