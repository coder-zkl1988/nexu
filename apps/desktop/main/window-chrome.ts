import type { BrowserWindowConstructorOptions } from "electron";

type MainWindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  | "autoHideMenuBar"
  | "backgroundColor"
  | "titleBarOverlay"
  | "titleBarStyle"
  | "trafficLightPosition"
  | "transparent"
  | "vibrancy"
  | "visualEffectState"
>;

type DeskpetWindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "backgroundColor" | "frame" | "hasShadow" | "transparent"
>;

export const TRANSPARENT_WINDOW_BACKGROUND_COLOR = "#00000000";

export function resolveMainWindowChromeOptions(
  platform: NodeJS.Platform,
): MainWindowChromeOptions {
  if (platform === "darwin") {
    return {
      backgroundColor: TRANSPARENT_WINDOW_BACKGROUND_COLOR,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
      transparent: true,
      vibrancy: "sidebar",
      visualEffectState: "followWindow",
    };
  }

  if (platform === "win32") {
    return {
      autoHideMenuBar: true,
      backgroundColor: "#FAFAFA",
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#FAFAFA",
        symbolColor: "#27272A",
        height: 38,
      },
    };
  }

  return {
    backgroundColor: "#0B1020",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
  };
}

export function resolveDeskpetWindowChromeOptions(): DeskpetWindowChromeOptions {
  return {
    backgroundColor: TRANSPARENT_WINDOW_BACKGROUND_COLOR,
    frame: false,
    hasShadow: false,
    transparent: true,
  };
}
