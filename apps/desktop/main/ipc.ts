import * as Sentry from "@sentry/electron/main";
import {
  BrowserWindow,
  app,
  crashReporter,
  ipcMain,
  screen,
  shell,
  webContents,
} from "electron";
import {
  type DesktopDevDomSnapshotResult,
  type DesktopDevEvalResult,
  type DesktopDevEvalSerializableValue,
  type DesktopDevRendererLogEntry,
  type DesktopDevRendererLogSnapshot,
  type DesktopDevScreenshotResult,
  type HostDesktopCommand,
  type HostInvokePayloadMap,
  type HostInvokeResultMap,
  type StartupProbePayload,
  hostInvokeChannels,
} from "../shared/host";
import type { DesktopRuntimeConfig } from "../shared/runtime-config";
import type { DesktopDiagnosticsReporter } from "./desktop-diagnostics";
import { exportDiagnostics, uploadDiagnostics } from "./diagnostics-export";
import type { RuntimeOrchestrator } from "./runtime/daemon-supervisor";
import {
  getDesktopShellPreferences,
  updateDesktopShellPreferences,
} from "./services/desktop-shell-preferences";
import {
  type QuitHandlerOptions,
  runTeardownAndExit,
} from "./services/quit-handler";
import { applyCrashReportsConsent, reportError } from "./services/telemetry";
import type { ComponentUpdater } from "./updater/component-updater";
import type { UpdateManager } from "./updater/update-manager";

const validChannels = new Set<string>(hostInvokeChannels);
const desktopDevRendererLogBuffer: DesktopDevRendererLogEntry[] = [];
const desktopDevRendererLogLimit = 200;
const desktopDevTrackedContents = new Set<number>();
let desktopDevRendererLogTrackingInitialized = false;

let updateManager: UpdateManager | null = null;
let componentUpdater: ComponentUpdater | null = null;
let quitHandlerOpts: QuitHandlerOptions | null = null;
let quitFallback: (() => Promise<void>) | null = null;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertDesktopDevDiagnosticsEnabled(): void {
  if (app.isPackaged) {
    throw new Error(
      "Desktop dev diagnostics are only available in development mode.",
    );
  }
}

function nextDesktopDevLogId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function appendDesktopDevRendererLog(
  entry: Omit<DesktopDevRendererLogEntry, "id" | "ts">,
): void {
  desktopDevRendererLogBuffer.push({
    ...entry,
    id: nextDesktopDevLogId(),
    ts: new Date().toISOString(),
  });

  if (desktopDevRendererLogBuffer.length > desktopDevRendererLogLimit) {
    desktopDevRendererLogBuffer.splice(
      0,
      desktopDevRendererLogBuffer.length - desktopDevRendererLogLimit,
    );
  }
}

function trackDesktopDevRendererLogs(contents: Electron.WebContents): void {
  if (desktopDevTrackedContents.has(contents.id)) {
    return;
  }

  desktopDevTrackedContents.add(contents.id);

  contents.on("console-message", (details) => {
    appendDesktopDevRendererLog({
      source: "console",
      level: details.level,
      message: details.message,
      url: contents.getURL() || null,
      sourceId: details.sourceId || null,
      line: details.lineNumber,
    });
  });

  contents.once("destroyed", () => {
    desktopDevTrackedContents.delete(contents.id);
  });
}

function ensureDesktopDevRendererLogTracking(): void {
  if (app.isPackaged || desktopDevRendererLogTrackingInitialized) {
    return;
  }

  desktopDevRendererLogTrackingInitialized = true;

  for (const window of BrowserWindow.getAllWindows()) {
    trackDesktopDevRendererLogs(window.webContents);
  }

  app.on("browser-window-created", (_event, window) => {
    trackDesktopDevRendererLogs(window.webContents);
  });
}

export async function captureDesktopDevScreenshot(
  sender: Electron.WebContents,
): Promise<DesktopDevScreenshotResult> {
  const browserWindow = BrowserWindow.fromWebContents(sender);

  if (!browserWindow) {
    throw new Error("Could not resolve the active browser window.");
  }

  const image = await browserWindow.webContents.capturePage();
  const size = image.getSize();
  const scaleFactor = image.getScaleFactors()[0] ?? 1;

  return {
    mimeType: "image/png",
    base64: image.toPNG().toString("base64"),
    width: size.width,
    height: size.height,
    scaleFactor,
  };
}

export async function evaluateDesktopDevScript(
  sender: Electron.WebContents,
  script: string,
): Promise<DesktopDevEvalResult> {
  return sender.executeJavaScript(
    `(async () => {
      const toSerializable = (value, depth = 0) => {
        if (depth > 4) {
          return "[max-depth]";
        }
        if (value === null) return null;
        const valueType = typeof value;
        if (valueType === "string" || valueType === "number" || valueType === "boolean") {
          return value;
        }
        if (valueType === "undefined") {
          return "[undefined]";
        }
        if (valueType === "bigint") {
          return value.toString();
        }
        if (valueType === "function") {
          return "[function " + (value.name || "anonymous") + "]";
        }
        if (Array.isArray(value)) {
          return value.map((entry) => toSerializable(entry, depth + 1));
        }
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack ?? null,
          };
        }
        if (valueType === "object") {
          const tag = Object.prototype.toString.call(value);
          if (tag !== "[object Object]") {
            return tag;
          }
          const result = {};
          for (const [key, entry] of Object.entries(value)) {
            result[key] = toSerializable(entry, depth + 1);
          }
          return result;
        }
        return String(value);
      };

      try {
        const value = await Promise.resolve((0, eval)(${JSON.stringify(script)}));
        return {
          ok: true,
          valueType:
            value === null
              ? "null"
              : Array.isArray(value)
                ? "array"
                : typeof value,
          value: toSerializable(value),
        };
      } catch (error) {
        return {
          ok: false,
          valueType: "error",
          value: null,
          error: {
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? (error.stack ?? undefined) : undefined,
          },
        };
      }
    })()`,
  ) as Promise<{
    ok: boolean;
    valueType: string;
    value: DesktopDevEvalSerializableValue;
    error?: {
      name: string;
      message: string;
      stack?: string;
    };
  }>;
}

export async function captureDesktopDevDomSnapshot(
  sender: Electron.WebContents,
  maxHtmlLength?: number,
): Promise<DesktopDevDomSnapshotResult> {
  const htmlLimit = Math.max(1000, Math.min(maxHtmlLength ?? 20000, 100000));

  return sender.executeJavaScript(
    `(async () => {
      const html = document.documentElement?.outerHTML ?? "";
      const htmlLimit = ${htmlLimit};
      const htmlSummary = html.length > htmlLimit
        ? html.slice(0, htmlLimit) + "\\n...[truncated " + (html.length - htmlLimit) + " chars]"
        : html;

      return {
        title: document.title,
        url: window.location.href,
        readyState: document.readyState,
        htmlLength: html.length,
        htmlSummary,
      };
    })()`,
  ) as Promise<DesktopDevDomSnapshotResult>;
}

export function getDesktopDevRendererLogSnapshot(
  limitInput?: number,
): DesktopDevRendererLogSnapshot {
  assertDesktopDevDiagnosticsEnabled();
  const requestedLimit = limitInput ?? desktopDevRendererLogLimit;
  const limit = Math.max(
    1,
    Math.min(requestedLimit, desktopDevRendererLogLimit),
  );
  const startIndex = Math.max(desktopDevRendererLogBuffer.length - limit, 0);

  return {
    entries: desktopDevRendererLogBuffer.slice(startIndex),
    truncated: startIndex > 0,
  };
}

async function fetchControllerJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < 9) {
        await sleep(500);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to reach controller.");
}

type DeskpetDefaultBotResponse = {
  id?: string;
  name?: string;
};

type DeskpetLocalChatStartResponse = {
  sessionKey?: string;
  session?: {
    id?: string;
  } | null;
  message?: {
    runId?: string | null;
  } | null;
};

type DeskpetCurrentChatTarget = {
  botId: string;
  sessionKey: string;
  sessionId?: string;
};

let deskpetCurrentChatTarget: DeskpetCurrentChatTarget | null = null;

function buildDeskpetPendingSessionPath(input: {
  botId: string;
  sessionKey: string;
  runId?: string | null;
}): string {
  const params = new URLSearchParams({
    botId: input.botId,
    sessionKey: input.sessionKey,
  });

  const runId = input.runId?.trim();
  if (runId) {
    params.set("runId", runId);
  }

  return `/workspace/sessions/pending?${params.toString()}`;
}

function buildDeskpetSessionPath(input: {
  sessionId: string;
  botId: string;
  sessionKey: string;
  runId?: string | null;
  startedAt: number;
}): string {
  const params = new URLSearchParams({
    deskpetStartedAt: String(input.startedAt),
    deskpetSessionKey: input.sessionKey,
    deskpetBotId: input.botId,
  });

  const runId = input.runId?.trim();
  if (runId) {
    params.set("deskpetRunId", runId);
  }

  return `/workspace/sessions/${input.sessionId}?${params.toString()}`;
}

function broadcastDesktopCommand(command: HostDesktopCommand): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) {
      contents.send("host:desktop-command", command);
    }
  }
}

function showPrimaryWindow(sender: Electron.WebContents): void {
  const senderWindow = BrowserWindow.fromWebContents(sender);
  const primaryWindow = BrowserWindow.getAllWindows().find((window) => {
    if (window.isDestroyed() || window === senderWindow) {
      return false;
    }

    return window.getTitle() !== "Tabby Deskpet";
  });

  if (!primaryWindow) {
    return;
  }

  if (primaryWindow.isMinimized()) {
    primaryWindow.restore();
  }
  if (!primaryWindow.isVisible()) {
    primaryWindow.show();
  }
  primaryWindow.focus();
}

async function startDeskpetChat(
  runtimeConfig: DesktopRuntimeConfig,
  text: string,
): Promise<HostInvokeResultMap["desktop:deskpet-start-chat"]> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("请输入想和 Tabby 说的话。");
  }

  const bot = await fetchControllerJson<DeskpetDefaultBotResponse>(
    `${runtimeConfig.urls.controllerBase}/api/v1/bots/default`,
  );
  const botId = bot.id?.trim();
  if (!botId) {
    throw new Error("没有找到可用的默认助手。");
  }

  const mainSessionKey = `agent:${botId}:main`;
  const response = await fetchControllerJson<DeskpetLocalChatStartResponse>(
    `${runtimeConfig.urls.controllerBase}/api/v1/chat/local/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botId,
        sessionKey: mainSessionKey,
        message: {
          type: "text",
          content: trimmed,
        },
      }),
    },
  );

  const sessionKey = response.sessionKey ?? mainSessionKey;
  const sessionId = response.session?.id?.trim();
  const runId = response.message?.runId ?? null;
  const startedAt = Date.now();
  const path = sessionId
    ? buildDeskpetSessionPath({
        sessionId,
        botId,
        sessionKey,
        runId,
        startedAt,
      })
    : buildDeskpetPendingSessionPath({
        botId,
        sessionKey,
        runId,
      });
  const startedCommand: HostDesktopCommand = {
    type: "deskpet:chat-started",
    botId,
    sessionKey,
    ...(sessionId ? { sessionId } : {}),
    runId,
    text: trimmed,
    startedAt,
  };

  broadcastDesktopCommand({ type: "desktop:open-web-path", path });
  broadcastDesktopCommand(startedCommand);
  setTimeout(() => broadcastDesktopCommand(startedCommand), 500);
  setTimeout(() => broadcastDesktopCommand(startedCommand), 1500);

  return {
    ok: true,
    path,
  };
}

function registerDeskpetCurrentChat(
  input: HostInvokePayloadMap["desktop:deskpet-register-current-chat"],
): HostInvokeResultMap["desktop:deskpet-register-current-chat"] {
  const botId = input.botId.trim();
  const sessionKey = input.sessionKey.trim();
  const sessionId = input.sessionId?.trim();

  if (!botId || !sessionKey) {
    throw new Error("当前会话信息不完整，暂时无法回复。");
  }

  deskpetCurrentChatTarget = {
    botId,
    sessionKey,
    ...(sessionId ? { sessionId } : {}),
  };

  return { ok: true };
}

function getDeskpetCurrentChatPath(): string | null {
  if (!deskpetCurrentChatTarget) {
    return null;
  }

  if (deskpetCurrentChatTarget.sessionId) {
    return `/workspace/sessions/${deskpetCurrentChatTarget.sessionId}`;
  }

  return buildDeskpetPendingSessionPath({
    botId: deskpetCurrentChatTarget.botId,
    sessionKey: deskpetCurrentChatTarget.sessionKey,
  });
}

function appendDeskpetReplyFocus(path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}deskpetReplyFocusAt=${Date.now()}`;
}

function openDeskpetCurrentChat(
  sender: Electron.WebContents,
  input?: HostInvokePayloadMap["desktop:deskpet-open-current-chat"],
): HostInvokeResultMap["desktop:deskpet-open-current-chat"] {
  const basePath = getDeskpetCurrentChatPath() ?? "/workspace";
  const path =
    input?.intent === "reply" ? appendDeskpetReplyFocus(basePath) : basePath;

  broadcastDesktopCommand({
    type: "desktop:open-web-path",
    path,
  });
  showPrimaryWindow(sender);
  return { ok: true, path };
}

function pauseDeskpetCurrentReply(
  sender: Electron.WebContents,
): HostInvokeResultMap["desktop:deskpet-pause-current-reply"] {
  if (!deskpetCurrentChatTarget) {
    showPrimaryWindow(sender);
    return { ok: false };
  }

  broadcastDesktopCommand({
    type: "deskpet:pause-current-reply",
    sessionKey: deskpetCurrentChatTarget.sessionKey,
    ...(deskpetCurrentChatTarget.sessionId
      ? { sessionId: deskpetCurrentChatTarget.sessionId }
      : {}),
  });
  showPrimaryWindow(sender);
  return { ok: true };
}

async function replyDeskpetCurrentChat(
  runtimeConfig: DesktopRuntimeConfig,
  text: string,
): Promise<HostInvokeResultMap["desktop:deskpet-reply-current-chat"]> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("请输入回复内容。");
  }

  if (!deskpetCurrentChatTarget) {
    throw new Error("还没有可回复的会话。");
  }

  await fetchControllerJson<unknown>(
    `${runtimeConfig.urls.controllerBase}/api/v1/chat/local`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botId: deskpetCurrentChatTarget.botId,
        sessionKey: deskpetCurrentChatTarget.sessionKey,
        message: {
          type: "text",
          content: trimmed,
        },
      }),
    },
  );

  const replyCommand: HostDesktopCommand = {
    type: "deskpet:current-chat-replied",
    sessionKey: deskpetCurrentChatTarget.sessionKey,
    text: trimmed,
    ...(deskpetCurrentChatTarget.sessionId
      ? { sessionId: deskpetCurrentChatTarget.sessionId }
      : {}),
  };

  if (deskpetCurrentChatTarget.sessionId) {
    broadcastDesktopCommand({
      type: "desktop:open-web-path",
      path: `/workspace/sessions/${deskpetCurrentChatTarget.sessionId}`,
    });
  }

  broadcastDesktopCommand(replyCommand);
  setTimeout(() => broadcastDesktopCommand(replyCommand), 400);
  setTimeout(() => broadcastDesktopCommand(replyCommand), 1000);

  return { ok: true };
}

const nativeCrashTestTitles = {
  main: "desktop.main.crash",
  renderer: "desktop.renderer.crash",
} as const;

const nativeCrashAnnotationKeys = {
  title: "nexu.crash_title",
  kind: "nexu.crash_kind",
} as const;

function setNativeCrashAnnotations(
  title: (typeof nativeCrashTestTitles)[keyof typeof nativeCrashTestTitles],
): void {
  crashReporter.addExtraParameter(nativeCrashAnnotationKeys.title, title);
  crashReporter.addExtraParameter(
    nativeCrashAnnotationKeys.kind,
    "native_crash",
  );
}

function clearNativeCrashAnnotations(): void {
  crashReporter.removeExtraParameter(nativeCrashAnnotationKeys.title);
  crashReporter.removeExtraParameter(nativeCrashAnnotationKeys.kind);
}

async function prepareNativeCrashScope(
  title: (typeof nativeCrashTestTitles)[keyof typeof nativeCrashTestTitles],
): Promise<void> {
  setNativeCrashAnnotations(title);

  if (!Sentry.isInitialized()) {
    return;
  }

  const scope = Sentry.getCurrentScope();
  scope.setTag("nexu.crash_title", title);
  scope.setTag("nexu.crash_kind", "native_crash");
  scope.setExtra("nexu.crash_title", title);
  scope.setFingerprint([title]);

  await new Promise((resolve) => setTimeout(resolve, 50));
}

export function setUpdateManager(manager: UpdateManager | null): void {
  updateManager = manager;
}

export function getUpdateManager(): UpdateManager | null {
  return updateManager;
}

export function setComponentUpdater(updater: ComponentUpdater): void {
  componentUpdater = updater;
}

export function setQuitHandlerOpts(opts: QuitHandlerOptions): void {
  quitHandlerOpts = opts;
}

export function setQuitFallback(fallback: () => Promise<void>): void {
  quitFallback = fallback;
}

function assertValidChannel(
  channel: string,
): asserts channel is keyof HostInvokePayloadMap {
  if (!validChannels.has(channel)) {
    throw new Error(`Unsupported host channel: ${channel}`);
  }
}

export function registerIpcHandlers(
  orchestrator: RuntimeOrchestrator,
  runtimeConfig: DesktopRuntimeConfig,
  diagnosticsReporter: DesktopDiagnosticsReporter | null,
  coldStartReady?: Promise<void>,
): () => void {
  ensureDesktopDevRendererLogTracking();

  const unsubscribeOrchestrator = orchestrator.subscribe((runtimeEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("host:runtime-event", runtimeEvent);
    }
  });

  ipcMain.handle(
    "host:invoke",
    async (_event, channel: string, payload: unknown) => {
      assertValidChannel(channel);

      switch (channel) {
        case "app:get-info": {
          const result: HostInvokeResultMap["app:get-info"] = {
            appName: app.getName(),
            appVersion: app.getVersion(),
            platform: process.platform,
            isDev: !app.isPackaged,
          };

          return result;
        }

        case "diagnostics:get-info": {
          const sentryDsn = runtimeConfig.sentryDsn;
          const sentryMainEnabled = Boolean(sentryDsn);
          const result: HostInvokeResultMap["diagnostics:get-info"] = {
            crashDumpsPath: app.getPath("crashDumps"),
            processType: process.type,
            sentryMainEnabled,
            sentryDsn,
            nativeCrashPipeline: sentryMainEnabled ? "sentry" : "local-only",
            proxy: {
              source: runtimeConfig.proxy.source,
              httpProxyRedacted:
                runtimeConfig.proxy.diagnostics.httpProxyRedacted,
              httpsProxyRedacted:
                runtimeConfig.proxy.diagnostics.httpsProxyRedacted,
              allProxyRedacted:
                runtimeConfig.proxy.diagnostics.allProxyRedacted,
              noProxy: [...runtimeConfig.proxy.bypass],
            },
          };

          return result;
        }

        case "diagnostics:crash-main": {
          await prepareNativeCrashScope(nativeCrashTestTitles.main);
          process.crash();
          return undefined;
        }

        case "diagnostics:crash-renderer": {
          const browserWindow = BrowserWindow.fromWebContents(_event.sender);

          if (!browserWindow) {
            throw new Error("Could not resolve the active browser window.");
          }

          await prepareNativeCrashScope(nativeCrashTestTitles.renderer);
          browserWindow.webContents.forcefullyCrashRenderer();
          setTimeout(() => {
            clearNativeCrashAnnotations();
          }, 5000);
          return undefined;
        }

        case "diagnostics:export": {
          const typedPayload =
            payload as HostInvokePayloadMap["diagnostics:export"];
          return exportDiagnostics({
            orchestrator,
            runtimeConfig,
            source: typedPayload.source,
          });
        }

        case "diagnostics:upload": {
          return uploadDiagnostics({ orchestrator, runtimeConfig });
        }

        case "env:get-controller-base-url": {
          const result: HostInvokeResultMap["env:get-controller-base-url"] = {
            controllerBaseUrl: runtimeConfig.urls.controllerBase,
          };

          return result;
        }

        case "env:get-runtime-config": {
          // Wait for cold-start to finish so the renderer gets final ports
          // (web port may change due to fallback during bootstrap).
          if (coldStartReady) await coldStartReady;
          return runtimeConfig;
        }

        case "runtime:get-state": {
          return orchestrator.getRuntimeState();
        }

        case "runtime:start-unit": {
          const typedPayload =
            payload as HostInvokePayloadMap["runtime:start-unit"];
          return orchestrator.startOne(typedPayload.id);
        }

        case "runtime:stop-unit": {
          const typedPayload =
            payload as HostInvokePayloadMap["runtime:stop-unit"];
          return orchestrator.stopOne(typedPayload.id);
        }

        case "runtime:start-all": {
          return orchestrator.startAll();
        }

        case "runtime:stop-all": {
          return orchestrator.stopAll();
        }

        case "runtime:show-log-file": {
          const typedPayload =
            payload as HostInvokePayloadMap["runtime:show-log-file"];
          const logFilePath = orchestrator.getLogFilePath(typedPayload.id);

          if (logFilePath) {
            shell.showItemInFolder(logFilePath);
          }

          const result: HostInvokeResultMap["runtime:show-log-file"] = {
            ok: logFilePath !== null,
          };

          return result;
        }

        case "runtime:query-events": {
          const typedPayload =
            payload as HostInvokePayloadMap["runtime:query-events"];
          return orchestrator.queryEvents(typedPayload);
        }

        case "desktop:get-cloud-status": {
          return fetchControllerJson<
            HostInvokeResultMap["desktop:get-cloud-status"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-status`,
          );
        }

        case "desktop:create-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:create-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:create-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/create`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(typedPayload),
            },
          );
        }

        case "desktop:connect-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:connect-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:connect-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/connect`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: typedPayload.name }),
            },
          );
        }

        case "desktop:disconnect-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:disconnect-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:disconnect-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/disconnect`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: typedPayload.name }),
            },
          );
        }

        case "desktop:switch-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:switch-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:switch-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/select`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: typedPayload.name }),
            },
          );
        }

        case "desktop:import-cloud-profiles": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:import-cloud-profiles"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:import-cloud-profiles"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profiles/import`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ profiles: typedPayload.profiles }),
            },
          );
        }

        case "desktop:update-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:update-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:update-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/update`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(typedPayload),
            },
          );
        }

        case "desktop:delete-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:delete-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:delete-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/delete`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(typedPayload),
            },
          );
        }

        case "desktop:get-minimax-oauth-status": {
          return fetchControllerJson<
            HostInvokeResultMap["desktop:get-minimax-oauth-status"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/v1/model-providers/minimax/oauth/status`,
          );
        }

        case "desktop:start-minimax-oauth": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:start-minimax-oauth"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:start-minimax-oauth"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/v1/model-providers/minimax/oauth/login`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(typedPayload),
            },
          );
        }

        case "desktop:cancel-minimax-oauth": {
          return fetchControllerJson<
            HostInvokeResultMap["desktop:cancel-minimax-oauth"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/v1/model-providers/minimax/oauth/login`,
            {
              method: "DELETE",
            },
          );
        }

        case "desktop:get-shell-preferences": {
          return getDesktopShellPreferences();
        }

        case "desktop:update-shell-preferences": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:update-shell-preferences"];
          const updated = updateDesktopShellPreferences(typedPayload);
          // Start/stop crash reporting immediately when the toggle changes.
          if (typeof typedPayload.crashReportsEnabled === "boolean") {
            applyCrashReportsConsent(typedPayload.crashReportsEnabled);
            // Mirror the consent to the controller so it reaches phones (via
            // tabby-control) and survives controller restarts. Best-effort:
            // the desktop shell-preferences file stays the source of truth.
            void fetchControllerJson(
              `${runtimeConfig.urls.controllerBase}/api/internal/desktop/preferences`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  crashReportsEnabled: typedPayload.crashReportsEnabled,
                }),
              },
            ).catch(() => {
              // Controller unreachable — phones keep their cached consent
              // until the next successful push.
            });
          }
          return updated;
        }

        case "desktop:deskpet-start-chat": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:deskpet-start-chat"];
          const result = await startDeskpetChat(
            runtimeConfig,
            typedPayload.text,
          );
          broadcastDesktopCommand({
            type: "deskpet:set-mood",
            mood: "lobster-replying",
            source: "auto",
            durationMs: 8000,
          });
          showPrimaryWindow(_event.sender);
          return result;
        }

        case "desktop:deskpet-register-current-chat": {
          return registerDeskpetCurrentChat(
            payload as HostInvokePayloadMap["desktop:deskpet-register-current-chat"],
          );
        }

        case "desktop:deskpet-reply-current-chat": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:deskpet-reply-current-chat"];
          const result = await replyDeskpetCurrentChat(
            runtimeConfig,
            typedPayload.text,
          );
          broadcastDesktopCommand({
            type: "deskpet:set-mood",
            mood: "lobster-replying",
            source: "auto",
            durationMs: 8000,
          });
          showPrimaryWindow(_event.sender);
          return result;
        }

        case "desktop:deskpet-open-current-chat": {
          return openDeskpetCurrentChat(
            _event.sender,
            payload as HostInvokePayloadMap["desktop:deskpet-open-current-chat"],
          );
        }

        case "desktop:deskpet-pause-current-reply": {
          return pauseDeskpetCurrentReply(_event.sender);
        }

        case "desktop:deskpet-activity": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:deskpet-activity"];
          if (!app.isPackaged) {
            console.info("[deskpet-debug:main] desktop:deskpet-activity", {
              mood: typedPayload.mood,
              durationMs: typedPayload.durationMs,
              hasReplyText: Boolean(typedPayload.replyText?.trim()),
            });
          }
          broadcastDesktopCommand({
            type: "deskpet:set-mood",
            mood: typedPayload.mood,
            source: "auto",
            durationMs: typedPayload.durationMs,
            replyText: typedPayload.replyText,
          });
          return { ok: true };
        }

        case "desktop:deskpet-move-window": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:deskpet-move-window"];
          const window = BrowserWindow.fromWebContents(_event.sender);
          if (!window || window.isDestroyed()) {
            return { ok: false };
          }

          const bounds = window.getBounds();
          const maxStep = 120;
          const deltaX = Math.round(
            Math.max(-maxStep, Math.min(maxStep, typedPayload.deltaX)),
          );
          const deltaY = Math.round(
            Math.max(-maxStep, Math.min(maxStep, typedPayload.deltaY)),
          );
          const display = screen.getDisplayNearestPoint({
            x: bounds.x + bounds.width / 2 + deltaX,
            y: bounds.y + bounds.height / 2 + deltaY,
          });
          const { workArea } = display;
          const nextX = Math.max(
            workArea.x,
            Math.min(
              workArea.x + workArea.width - bounds.width,
              bounds.x + deltaX,
            ),
          );
          const nextY = Math.max(
            workArea.y,
            Math.min(
              workArea.y + workArea.height - bounds.height,
              bounds.y + deltaY,
            ),
          );

          window.setPosition(nextX, nextY, false);
          return { ok: true };
        }

        case "desktop:deskpet-set-mouse-events": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:deskpet-set-mouse-events"];
          const window = BrowserWindow.fromWebContents(_event.sender);
          if (!window || window.isDestroyed()) {
            return { ok: false };
          }

          window.setIgnoreMouseEvents(Boolean(typedPayload.ignore), {
            forward: typedPayload.forward ?? true,
          });
          return { ok: true };
        }

        case "desktop:report-error": {
          const errorPayload =
            payload as HostInvokePayloadMap["desktop:report-error"];
          // Bridge for renderer-surfaced / relayed failures (e.g. device faults
          // forwarded from the controller SSE stream) into the main-process
          // Sentry gate. reportError itself is consent-gated and redacts.
          reportError(new Error(errorPayload.message), {
            area: errorPayload.area,
            reasonCode: errorPayload.reasonCode,
            extra: errorPayload.extra,
          });
          return { reported: true };
        }

        case "desktop:get-rewards-status": {
          return fetchControllerJson<
            HostInvokeResultMap["desktop:get-rewards-status"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/rewards`,
          );
        }

        case "desktop:set-reward-balance": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:set-reward-balance"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:set-reward-balance"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/rewards/set-balance`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ balance: typedPayload.balance }),
            },
          );
        }

        case "desktop:rewards-updated": {
          for (const contents of webContents.getAllWebContents()) {
            if (!contents.isDestroyed()) {
              contents.send("host:desktop-command", {
                type: "desktop:rewards-updated",
              });
            }
          }

          const result: HostInvokeResultMap["desktop:rewards-updated"] = {
            ok: true,
          };

          return result;
        }

        case "shell:open-external": {
          const typedPayload =
            payload as HostInvokePayloadMap["shell:open-external"];
          console.info("[host:invoke:shell-open-external]", typedPayload.url);
          await shell.openExternal(typedPayload.url);
          console.info(
            "[host:invoke:shell-open-external:done]",
            typedPayload.url,
          );

          const result: HostInvokeResultMap["shell:open-external"] = {
            ok: true,
          };

          return result;
        }

        case "update:check": {
          if (!updateManager) {
            return { updateAvailable: false };
          }
          return updateManager.checkNow({ userInitiated: true });
        }

        case "update:get-capability": {
          if (!updateManager) {
            return {
              platform: process.platform,
              check: false,
              downloadMode: "none",
              applyMode: "none",
              applyLabel: null,
              notes:
                "Desktop updates are unavailable in the current runtime mode.",
            };
          }
          return updateManager.getCapability();
        }

        case "update:download": {
          if (!updateManager) {
            return { ok: false };
          }
          return updateManager.downloadUpdate();
        }

        case "update:install": {
          if (!updateManager) {
            return undefined;
          }
          await updateManager.quitAndInstall();
          return undefined;
        }

        case "update:get-current-version": {
          return { version: app.getVersion() };
        }

        case "update:get-status": {
          if (!updateManager) {
            return { phase: "idle", version: null };
          }
          return updateManager.getStatus();
        }

        case "update:set-channel": {
          const typedPayload =
            payload as HostInvokePayloadMap["update:set-channel"];
          updateManager?.setChannel(typedPayload.channel);
          return { ok: true };
        }

        case "update:set-source": {
          const typedPayload =
            payload as HostInvokePayloadMap["update:set-source"];
          updateManager?.setSource(typedPayload.source);
          return { ok: true };
        }

        case "component:check": {
          if (!componentUpdater) {
            return { updates: [] };
          }
          const updates = await componentUpdater.checkForUpdates(
            app.getVersion(),
          );
          return {
            updates: updates.map((u) => ({
              id: u.id,
              currentVersion: u.currentVersion,
              newVersion: u.newVersion,
              size: u.size,
            })),
          };
        }

        case "component:install": {
          if (!componentUpdater) {
            return { ok: false };
          }
          const typedPayload =
            payload as HostInvokePayloadMap["component:install"];
          const updates = await componentUpdater.checkForUpdates(
            app.getVersion(),
          );
          const update = updates.find((u) => u.id === typedPayload.id);
          if (!update) {
            return { ok: false };
          }
          await componentUpdater.installUpdate(update);
          return { ok: true };
        }

        case "setup:animation-complete": {
          // Restore vibrancy now that the white-background animation
          // overlay has been removed.
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            win.setMinimumSize(1120, 720);
            if (process.platform === "darwin") {
              win.setBackgroundColor("#00000000");
              win.setVibrancy("sidebar");
            }
          }
          return undefined;
        }

        case "app:quit": {
          const typedPayload = payload as HostInvokePayloadMap["app:quit"];
          if (typedPayload.decision === "run-in-background") {
            const bgWin = BrowserWindow.getAllWindows()[0];
            if (bgWin) bgWin.hide();
            return undefined;
          }
          // quit-completely: use the fail-safe teardown path (finally → app.exit(0))
          // so the process always exits even if teardown throws.
          if (quitHandlerOpts) {
            void runTeardownAndExit(quitHandlerOpts, "ipc-quit");
          } else if (quitFallback) {
            void quitFallback();
          } else {
            console.warn(
              "[app:quit] quit fallback unavailable, forcing app.exit(0)",
            );
            app.exit(0);
          }
          return undefined;
        }

        default:
          throw new Error(`Unhandled host channel: ${channel satisfies never}`);
      }
    },
  );

  ipcMain.on("host:startup-probe", (_event, payload: StartupProbePayload) => {
    diagnosticsReporter?.recordStartupProbe(payload);
  });

  ipcMain.on("host:renderer-diagnostics-log", (_event, payload: unknown) => {
    if (app.isPackaged) {
      return;
    }

    const typedPayload = payload as Omit<
      DesktopDevRendererLogEntry,
      "id" | "ts" | "source"
    > & {
      source: "page-error";
    };

    appendDesktopDevRendererLog({
      source: "page-error",
      level: typedPayload.level,
      message: typedPayload.message,
      url: typedPayload.url,
      sourceId: typedPayload.sourceId,
      line: typedPayload.line,
    });
  });

  return unsubscribeOrchestrator;
}
