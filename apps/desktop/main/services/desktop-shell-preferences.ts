import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

export type DesktopShellPreferences = {
  launchAtLogin: boolean;
  showInDock: boolean;
  deskpetEnabled: boolean;
  supportsLaunchAtLogin: boolean;
  supportsShowInDock: boolean;
  /** Crash/error reporting consent (default on). Gates Sentry in the main process. */
  crashReportsEnabled: boolean;
  /**
   * Session Replay consent (default OFF — records masked UI on errors, so it
   * needs its own explicit opt-in). Read by the renderer at Sentry init;
   * toggling takes effect on next launch.
   */
  sessionReplayEnabled: boolean;
};

let runtimeApplyHandler:
  | ((preferences: DesktopShellPreferences) => void)
  | null = null;

type StoredDesktopShellPreferences = {
  launchAtLogin: boolean;
  showInDock: boolean;
  deskpetEnabled: boolean;
  crashReportsEnabled: boolean;
  sessionReplayEnabled: boolean;
};

const DEFAULT_PREFERENCES: StoredDesktopShellPreferences = {
  launchAtLogin: true,
  showInDock: true,
  deskpetEnabled: true,
  crashReportsEnabled: true,
  sessionReplayEnabled: false,
};

type StoredPreferencesState = {
  exists: boolean;
  preferences: StoredDesktopShellPreferences;
};

function getPreferencesFilePath(): string {
  return join(app.getPath("userData"), "desktop-shell-preferences.json");
}

function supportsLaunchAtLogin(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

function supportsShowInDock(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

function readStoredPreferencesState(): StoredPreferencesState {
  const filePath = getPreferencesFilePath();

  if (!existsSync(filePath)) {
    return {
      exists: false,
      preferences: DEFAULT_PREFERENCES,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const candidate =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;

    return {
      exists: true,
      preferences: {
        launchAtLogin:
          typeof candidate?.launchAtLogin === "boolean"
            ? candidate.launchAtLogin
            : DEFAULT_PREFERENCES.launchAtLogin,
        showInDock:
          typeof candidate?.showInDock === "boolean"
            ? candidate.showInDock
            : DEFAULT_PREFERENCES.showInDock,
        deskpetEnabled:
          typeof candidate?.deskpetEnabled === "boolean"
            ? candidate.deskpetEnabled
            : DEFAULT_PREFERENCES.deskpetEnabled,
        crashReportsEnabled:
          typeof candidate?.crashReportsEnabled === "boolean"
            ? candidate.crashReportsEnabled
            : DEFAULT_PREFERENCES.crashReportsEnabled,
        sessionReplayEnabled:
          typeof candidate?.sessionReplayEnabled === "boolean"
            ? candidate.sessionReplayEnabled
            : DEFAULT_PREFERENCES.sessionReplayEnabled,
      },
    };
  } catch {
    return {
      exists: false,
      preferences: DEFAULT_PREFERENCES,
    };
  }
}

function writeStoredPreferences(
  preferences: StoredDesktopShellPreferences,
): void {
  const filePath = getPreferencesFilePath();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(preferences, null, 2), "utf8");
}

function getLaunchAtLoginState(
  storedPreferences: StoredDesktopShellPreferences,
): boolean {
  if (!supportsLaunchAtLogin()) {
    return storedPreferences.launchAtLogin;
  }

  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return storedPreferences.launchAtLogin;
  }
}

function resolvePreferencesForRead(): StoredDesktopShellPreferences {
  const storedState = readStoredPreferencesState();
  if (storedState.exists) {
    return storedState.preferences;
  }

  const osLaunchAtLogin = getLaunchAtLoginState(DEFAULT_PREFERENCES);

  return {
    launchAtLogin: osLaunchAtLogin || DEFAULT_PREFERENCES.launchAtLogin,
    showInDock: DEFAULT_PREFERENCES.showInDock,
    deskpetEnabled: DEFAULT_PREFERENCES.deskpetEnabled,
    crashReportsEnabled: DEFAULT_PREFERENCES.crashReportsEnabled,
    sessionReplayEnabled: DEFAULT_PREFERENCES.sessionReplayEnabled,
  };
}

export function getDesktopShellPreferences(): DesktopShellPreferences {
  const storedPreferences = resolvePreferencesForRead();

  return {
    launchAtLogin: getLaunchAtLoginState(storedPreferences),
    showInDock: supportsShowInDock() ? storedPreferences.showInDock : true,
    deskpetEnabled: storedPreferences.deskpetEnabled,
    supportsLaunchAtLogin: supportsLaunchAtLogin(),
    supportsShowInDock: supportsShowInDock(),
    crashReportsEnabled: storedPreferences.crashReportsEnabled,
    sessionReplayEnabled: storedPreferences.sessionReplayEnabled,
  };
}

/**
 * Read the persisted crash-reports consent (default on) synchronously, for the
 * main process to gate Sentry at startup before the renderer/controller exist.
 */
export function readCrashReportsConsent(): boolean {
  return resolvePreferencesForRead().crashReportsEnabled;
}

function applyStoredPreferences(
  preferences: StoredDesktopShellPreferences,
): void {
  applyLaunchAtLoginPreference(preferences.launchAtLogin);
  applyDockVisibilityPreference(preferences.showInDock);
}

function applyLaunchAtLoginPreference(launchAtLogin: boolean): void {
  if (supportsLaunchAtLogin()) {
    try {
      app.setLoginItemSettings({
        openAtLogin: launchAtLogin,
      });
    } catch {
      // Ignore platform-specific failures and keep the stored preference.
    }
  }
}

function applyDockVisibilityPreference(showInDock: boolean): void {
  if (supportsShowInDock()) {
    if (showInDock) {
      void app.dock?.show();
    } else {
      app.dock?.hide();
    }
  }
}

export function applyDesktopShellPreferencesOnStartup(): void {
  const storedState = readStoredPreferencesState();
  const preferences = storedState.exists
    ? storedState.preferences
    : resolvePreferencesForRead();
  applyStoredPreferences(preferences);
  runtimeApplyHandler?.(getDesktopShellPreferences());
}

export function updateDesktopShellPreferences(input: {
  launchAtLogin?: boolean;
  showInDock?: boolean;
  deskpetEnabled?: boolean;
  crashReportsEnabled?: boolean;
  sessionReplayEnabled?: boolean;
}): DesktopShellPreferences {
  const storedPreferences = resolvePreferencesForRead();
  const nextPreferences: StoredDesktopShellPreferences = {
    launchAtLogin:
      typeof input.launchAtLogin === "boolean"
        ? input.launchAtLogin
        : storedPreferences.launchAtLogin,
    showInDock:
      typeof input.showInDock === "boolean"
        ? input.showInDock
        : storedPreferences.showInDock,
    deskpetEnabled:
      typeof input.deskpetEnabled === "boolean"
        ? input.deskpetEnabled
        : storedPreferences.deskpetEnabled,
    crashReportsEnabled:
      typeof input.crashReportsEnabled === "boolean"
        ? input.crashReportsEnabled
        : storedPreferences.crashReportsEnabled,
    sessionReplayEnabled:
      typeof input.sessionReplayEnabled === "boolean"
        ? input.sessionReplayEnabled
        : storedPreferences.sessionReplayEnabled,
  };

  writeStoredPreferences(nextPreferences);
  applyLaunchAtLoginPreference(nextPreferences.launchAtLogin);
  const resolved = getDesktopShellPreferences();
  runtimeApplyHandler?.(resolved);
  return resolved;
}

export function setDesktopShellPreferencesRuntimeHandler(
  handler: ((preferences: DesktopShellPreferences) => void) | null,
): void {
  runtimeApplyHandler = handler;
}
