import { contextBridge, ipcRenderer } from "electron";
import {
  type DesktopDeskpetMood,
  type HostBridge,
  type HostDesktopCommand,
  type HostInvokeChannel,
  type HostInvokePayloadMap,
  type HostInvokeResultMap,
  type RuntimeEvent,
  type StartupProbePayload,
  type UpdaterBridge,
  type UpdaterEvent,
  type UpdaterEventMap,
  hostInvokeChannels,
  updaterEvents,
} from "../shared/host";
import { getDesktopRuntimeConfig } from "../shared/runtime-config";
import { resolveWebviewPreloadUrl } from "./webview-preload-url";

const validChannels = new Set<string>(hostInvokeChannels);

const runtimeConfig = getDesktopRuntimeConfig(process.env, {
  resourcesPath: process.defaultApp ? undefined : process.resourcesPath,
  useBuildConfig: !process.defaultApp,
});

function reportStartupProbe(payload: StartupProbePayload): void {
  try {
    ipcRenderer.send("host:startup-probe", payload);
  } catch (error) {
    console.error("[desktop] failed to report startup probe", error);
  }
}

const hostBridge: HostBridge = {
  bootstrap: {
    buildInfo: runtimeConfig.buildInfo,
    sentryDsn: runtimeConfig.sentryDsn,
    posthogApiKey: runtimeConfig.posthogApiKey,
    posthogHost: runtimeConfig.posthogHost,
    isPackaged: !process.defaultApp,
    needsSetupAnimation: false,
    devImmersive: false,
    webviewPreloadUrl: resolveWebviewPreloadUrl(import.meta.dirname),
  },

  invoke<TChannel extends HostInvokeChannel>(
    channel: TChannel,
    payload: HostInvokePayloadMap[TChannel],
  ): Promise<HostInvokeResultMap[TChannel]> {
    if (!validChannels.has(channel)) {
      throw new Error(`Invalid host channel: ${channel}`);
    }

    return ipcRenderer.invoke("host:invoke", channel, payload) as Promise<
      HostInvokeResultMap[TChannel]
    >;
  },

  reportStartupProbe(payload) {
    reportStartupProbe(payload);
  },

  reportRendererDiagnosticsLog(payload) {
    ipcRenderer.send("host:renderer-diagnostics-log", payload);
  },

  onDesktopCommand(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      command: HostDesktopCommand,
    ) => {
      listener(command);
    };

    ipcRenderer.on("host:desktop-command", wrapped);

    return () => {
      ipcRenderer.removeListener("host:desktop-command", wrapped);
    };
  },

  onRuntimeEvent(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      event: RuntimeEvent,
    ) => {
      listener(event);
    };

    ipcRenderer.on("host:runtime-event", wrapped);

    return () => {
      ipcRenderer.removeListener("host:runtime-event", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("nexuHost", hostBridge);

type DeskpetActivityMood = Extract<
  DesktopDeskpetMood,
  "working" | "lobster-replying" | "tease-lobster" | "success" | "error"
>;

const DESKPET_INPUT_SELECTOR =
  'textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]';
const DESKPET_REPLY_TEXT_RE =
  /thinking|replying|streaming|generating|正在回复|思考中|回答中|生成中|typing/i;
const DESKPET_INPUT_PAUSE_TEASE_MS = 5000;
const DESKPET_REPLYING_HEARTBEAT_INTERVAL_MS = 1800;
const DESKPET_REPLYING_HEARTBEAT_DURATION_MS = 3600;
const DESKPET_TEASE_LOBSTER_DURATION_MS = 4200;

let lastDeskpetActivityAt = 0;
let lastReplyingReportAt = 0;
let pendingAiRequestCount = 0;
let pendingReplyDetected = false;
let inputPauseTeaseTimer: number | null = null;
let replyingHeartbeatTimer: number | null = null;
let replyFinishTimer: number | null = null;
let latestReplyText: string | undefined;

function normalizeReplyText(
  text: string | null | undefined,
): string | undefined {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 280) : undefined;
}

function getLatestReplyText(): string | undefined {
  const markedReplies = Array.from(
    document.querySelectorAll<HTMLElement>("[data-deskpet-reply-preview]"),
  );

  for (const element of markedReplies.reverse()) {
    const value = normalizeReplyText(
      element.dataset.deskpetReplyPreview || element.innerText,
    );
    if (value) {
      return value;
    }
  }

  return latestReplyText;
}

function reportDeskpetActivity(
  mood: DeskpetActivityMood,
  durationMs?: number,
  replyText?: string,
): void {
  const now = Date.now();
  if (now - lastDeskpetActivityAt < 250 && mood === "working") {
    return;
  }

  lastDeskpetActivityAt = now;
  ipcRenderer.send("deskpet:activity", {
    mood,
    source: "auto",
    durationMs,
    replyText,
  });
}

function clearReplyFinishTimer(): void {
  if (replyFinishTimer !== null) {
    window.clearTimeout(replyFinishTimer);
    replyFinishTimer = null;
  }
}

function clearInputPauseTeaseTimer(): void {
  if (inputPauseTeaseTimer !== null) {
    window.clearTimeout(inputPauseTeaseTimer);
    inputPauseTeaseTimer = null;
  }
}

function clearReplyingHeartbeatTimer(): void {
  if (replyingHeartbeatTimer !== null) {
    window.clearInterval(replyingHeartbeatTimer);
    replyingHeartbeatTimer = null;
  }
}

function scheduleInputPauseTease(): void {
  clearInputPauseTeaseTimer();
  inputPauseTeaseTimer = window.setTimeout(() => {
    reportDeskpetActivity("tease-lobster", DESKPET_TEASE_LOBSTER_DURATION_MS);
    inputPauseTeaseTimer = null;
  }, DESKPET_INPUT_PAUSE_TEASE_MS);
}

function reportAiReplying(): void {
  const now = Date.now();
  if (now - lastReplyingReportAt < 700) {
    return;
  }

  lastReplyingReportAt = now;
  reportDeskpetActivity(
    "lobster-replying",
    DESKPET_REPLYING_HEARTBEAT_DURATION_MS,
  );
}

function ensureReplyingHeartbeat(): void {
  if (replyingHeartbeatTimer !== null) {
    return;
  }

  replyingHeartbeatTimer = window.setInterval(() => {
    if (!pendingReplyDetected) {
      clearReplyingHeartbeatTimer();
      return;
    }

    reportAiReplying();
  }, DESKPET_REPLYING_HEARTBEAT_INTERVAL_MS);
}

function markAiReplying(replyText = getLatestReplyText()): void {
  pendingReplyDetected = true;
  latestReplyText = replyText ?? latestReplyText;
  clearReplyFinishTimer();
  ensureReplyingHeartbeat();
  reportAiReplying();
}

function markAiReplyFinished(): void {
  if (!pendingReplyDetected) {
    return;
  }

  pendingReplyDetected = false;
  clearReplyFinishTimer();
  clearReplyingHeartbeatTimer();
  reportDeskpetActivity("success", 3600, latestReplyText);
  latestReplyText = undefined;
}

function scheduleReplyFinished(): void {
  if (!pendingReplyDetected || pendingAiRequestCount > 0) {
    return;
  }

  clearReplyFinishTimer();
  replyFinishTimer = window.setTimeout(() => {
    markAiReplyFinished();
  }, 900);
}

function isChatInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && Boolean(target.closest(DESKPET_INPUT_SELECTOR))
  );
}

function targetHasText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return target.value.trim().length > 0;
  }

  return (target.textContent ?? "").trim().length > 0;
}

function installDeskpetActivityBridge(): void {
  window.addEventListener(
    "input",
    (event) => {
      if (isChatInputTarget(event.target) && targetHasText(event.target)) {
        reportDeskpetActivity("working", 1800);
        scheduleInputPauseTease();
      }
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        isChatInputTarget(event.target) &&
        targetHasText(event.target)
      ) {
        clearInputPauseTeaseTimer();
        reportDeskpetActivity("working", 2200);
      }
    },
    true,
  );

  window.addEventListener(
    "submit",
    (event) => {
      if (event.target instanceof HTMLFormElement) {
        clearInputPauseTeaseTimer();
        reportDeskpetActivity("working", 2200);
      }
    },
    true,
  );

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const requestText = String(
      args[0] instanceof Request ? args[0].url : args[0],
    );
    const isLikelyAiRequest =
      /chat|message|session|completion|run|openclaw/i.test(requestText) &&
      !/health|ready|cloud-status|rewards/i.test(requestText);

    if (isLikelyAiRequest) {
      pendingAiRequestCount += 1;
      markAiReplying();
    }

    try {
      const response = await originalFetch(...args);
      if (isLikelyAiRequest && !response.ok) {
        reportDeskpetActivity("error", 4200);
      }
      return response;
    } finally {
      if (isLikelyAiRequest) {
        pendingAiRequestCount = Math.max(0, pendingAiRequestCount - 1);
        scheduleReplyFinished();
      }
    }
  };

  const observer = new MutationObserver(() => {
    const pageText = document.body?.innerText ?? "";
    const replyText = getLatestReplyText();
    if (replyText) {
      latestReplyText = replyText;
      if (pendingAiRequestCount === 0) {
        scheduleReplyFinished();
        return;
      }
    }

    if (pendingAiRequestCount > 0 || DESKPET_REPLY_TEXT_RE.test(pageText)) {
      markAiReplying(replyText);
      return;
    }

    scheduleReplyFinished();
  });

  window.addEventListener("DOMContentLoaded", () => {
    if (!document.body) {
      return;
    }

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

installDeskpetActivityBridge();

const validUpdaterEvents = new Set<string>(updaterEvents);

const updaterBridge: UpdaterBridge = {
  onEvent<TEvent extends UpdaterEvent>(
    event: TEvent,
    callback: (data: UpdaterEventMap[TEvent]) => void,
  ): () => void {
    if (!validUpdaterEvents.has(event)) {
      throw new Error(`Invalid updater event: ${event}`);
    }

    const handler = (
      _event: Electron.IpcRendererEvent,
      data: UpdaterEventMap[TEvent],
    ) => {
      callback(data);
    };

    ipcRenderer.on(event, handler);

    return () => {
      ipcRenderer.removeListener(event, handler);
    };
  },
};

contextBridge.exposeInMainWorld("nexuUpdater", updaterBridge);
