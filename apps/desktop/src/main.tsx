import * as Sentry from "@sentry/electron/renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import posthog, { type PostHogConfig } from "posthog-js";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Root, createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import setupTransparentVideoUrl from "../assets/init-vedio-transparent.webm";
import setupVideoUrl from "../assets/init-vedio.mp4";
import type {
  AppInfo,
  DesktopChromeMode,
  DesktopRuntimeConfig,
  DesktopSurface,
  DiagnosticsInfo,
  RuntimeEvent,
  RuntimeLogEntry,
  RuntimeState,
  RuntimeUnitId,
  RuntimeUnitPhase,
  RuntimeUnitSnapshot,
  RuntimeUnitState,
} from "../shared/host";
import { getDesktopSentryBuildMetadata } from "../shared/sentry-build-metadata";
import { resolveDesktopUpdateExperience } from "../shared/update-policy";
import { DevelopSetBalanceDialog } from "./components/develop-set-balance-dialog";
import { SurfaceFrame } from "./components/surface-frame";
import { UpdateBadge, UpdateBanner } from "./components/update-banner";
import { useAutoUpdate } from "./hooks/use-auto-update";
import {
  ensureDesktopControllerReady,
  getDesktopControllerReadyTiming,
} from "./lib/controller-ready";
import {
  checkComponentUpdates,
  getAppInfo,
  getDesktopCloudStatus,
  getDiagnosticsInfo,
  getRuntimeConfig,
  getRuntimeState,
  installComponent,
  notifySetupAnimationComplete,
  onDesktopCommand,
  onRuntimeEvent,
  reportDesktopDevPageError,
  reportStartupProbe,
  showRuntimeLogFile,
  startUnit,
  stopUnit,
  triggerMainProcessCrash,
  triggerRendererProcessCrash,
} from "./lib/host-api";
import { getDesktopOpenClawUrl } from "./lib/openclaw-surface";
import { syncDesktopPostHogIdentity } from "./lib/posthog-identity";
import { CloudProfilePage } from "./pages/cloud-profile-page";
import "./runtime-page.css";

const posthogApiKey =
  import.meta.env.VITE_POSTHOG_API_KEY ??
  (typeof window === "undefined"
    ? null
    : window.nexuHost.bootstrap.posthogApiKey);
const posthogHost =
  import.meta.env.VITE_POSTHOG_HOST ??
  (typeof window === "undefined"
    ? null
    : window.nexuHost.bootstrap.posthogHost);
const rendererSentryDsn =
  typeof window === "undefined" ? null : window.nexuHost.bootstrap.sentryDsn;
const holdSetupAnimation =
  import.meta.env.VITE_NEXU_SETUP_ANIMATION_HOLD === "1";
const posthogSuperProperties = {
  environment: import.meta.env.MODE,
  appName: "nexu-desktop",
  appVersion:
    typeof window === "undefined"
      ? "unknown"
      : window.nexuHost.bootstrap.buildInfo.version,
};

type ControllerSurfaceState = "polling" | "recovering" | "failed";

let rendererSentryInitialized = false;
let posthogTelemetryInitialized = false;

const SETUP_STAGE_LABELS: Record<string, string> = {
  extracting: "解压本地组件",
  launchd_bootstrap: "启动后台服务",
  starting_controller: "启动控制服务",
  waiting_controller: "等待控制服务就绪",
  attaching_external: "连接本地运行时",
  starting_web: "启动工作区界面",
  complete: "准备就绪",
};

const SETUP_STAGE_ORDER = Object.keys(SETUP_STAGE_LABELS);
let rendererCommitReported = false;
let currentPosthogUserId: string | null = null;
let currentPosthogIdentifyKey: string | null = null;

function sendRendererStartupProbe(
  stage: string,
  status: "ok" | "error",
  detail?: string | null,
): void {
  try {
    reportStartupProbe({
      source: "renderer",
      stage,
      status,
      detail: detail ?? null,
    });
  } catch (error) {
    console.error("[desktop] failed to report startup probe", error);
  }
}

sendRendererStartupProbe("renderer:module-start", "ok");

window.addEventListener("error", (event) => {
  const detail =
    event.error instanceof Error
      ? (event.error.stack ?? event.error.message)
      : event.message;
  sendRendererStartupProbe("renderer:window-error", "error", detail);

  if (!window.nexuHost.bootstrap.isPackaged) {
    reportDesktopDevPageError({
      level: "error",
      message: detail,
      url: window.location.href,
      sourceId: event.filename || null,
      line: event.lineno || null,
    });
  }
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const detail =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  sendRendererStartupProbe("renderer:unhandled-rejection", "error", detail);

  if (!window.nexuHost.bootstrap.isPackaged) {
    reportDesktopDevPageError({
      level: "error",
      message: `Unhandled promise rejection: ${detail}`,
      url: window.location.href,
      sourceId: null,
      line: null,
    });
  }
});

function initializeRendererSentry(
  dsn: string,
  sessionReplayEnabled: boolean,
): void {
  if (rendererSentryInitialized) {
    return;
  }

  const sentryBuildMetadata = getDesktopSentryBuildMetadata(
    window.nexuHost.bootstrap.buildInfo,
  );

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: sentryBuildMetadata.release,
    ...(sentryBuildMetadata.dist ? { dist: sentryBuildMetadata.dist } : {}),
    // Session Replay: separate explicit opt-in (default off), fully masked,
    // and only recorded when an error actually happens — never on normal
    // sessions. Credentials must not be recoverable from replays.
    ...(sessionReplayEnabled
      ? {
          integrations: [
            Sentry.replayIntegration({
              maskAllText: true,
              maskAllInputs: true,
              blockAllMedia: true,
            }),
          ],
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 1.0,
        }
      : {}),
  });

  Sentry.setContext("build", sentryBuildMetadata.buildContext);

  rendererSentryInitialized = true;
}

function initializePostHogTelemetry(): void {
  if (posthogTelemetryInitialized || !posthogApiKey) {
    return;
  }

  const config: Partial<PostHogConfig> = {
    autocapture: true,
    disable_session_recording: false,
    loaded: (client) => {
      client.register(posthogSuperProperties);
    },
  };

  if (posthogHost) {
    config.api_host = posthogHost;
  }

  posthog.init(posthogApiKey, config);
  posthogTelemetryInitialized = true;
}

function syncPostHogIdentity(input: {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}): void {
  if (!posthogTelemetryInitialized) {
    return;
  }

  const nextState = syncDesktopPostHogIdentity(
    posthog,
    posthogSuperProperties,
    {
      currentUserId: currentPosthogUserId,
      currentIdentifyKey: currentPosthogIdentifyKey,
    },
    input,
  );

  currentPosthogUserId = nextState.currentUserId;
  currentPosthogIdentifyKey = nextState.currentIdentifyKey;
}

function maskSentryDsn(dsn: string | null | undefined): string {
  if (!dsn) {
    return "missing";
  }

  const match = dsn.match(/^(https?:\/\/)([^@]+)@(.+)$/);

  if (!match) {
    return "configured";
  }

  const [, protocol, publicKey, hostAndPath] = match;
  const visibleKey = publicKey.slice(-6);
  const maskedKey = `${"*".repeat(Math.max(publicKey.length - 6, 3))}${visibleKey}`;

  return `${protocol}${maskedKey}@${hostAndPath}`;
}

function formatBuildTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "(unknown)";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const offsetSign = timezoneOffsetMinutes >= 0 ? "+" : "-";
  const offsetHours = String(
    Math.floor(Math.abs(timezoneOffsetMinutes) / 60),
  ).padStart(2, "0");
  const offsetMinutes = String(Math.abs(timezoneOffsetMinutes) % 60).padStart(
    2,
    "0",
  );

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

function formatBuildCommit(value: string | null | undefined): string {
  if (!value) {
    return "(unknown)";
  }

  return value.slice(0, 7);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function phaseTone(phase: RuntimeUnitPhase): string {
  switch (phase) {
    case "running":
      return "is-running";
    case "failed":
      return "is-failed";
    case "starting":
    case "stopping":
      return "is-busy";
    default:
      return "is-idle";
  }
}

function kindLabel(unit: RuntimeUnitState): string {
  return `${unit.kind} / ${unit.launchStrategy}`;
}

function formatLogLine(entry: RuntimeLogEntry): string {
  const actionLabel = entry.actionId ? ` [action=${entry.actionId}]` : "";
  return `#${entry.cursor} ${entry.ts} [${entry.stream}] [${entry.kind}] [reason=${entry.reasonCode}]${actionLabel} ${entry.message}`;
}

function logFilterLabel(filter: LogFilter): string {
  switch (filter) {
    case "errors":
      return "Errors";
    case "lifecycle":
      return "Lifecycle";
    default:
      return "All";
  }
}

type LogFilter = "all" | "errors" | "lifecycle";

function mergeUnitSnapshot(
  current: RuntimeUnitState,
  snapshot: RuntimeUnitSnapshot,
): RuntimeUnitState {
  return {
    ...current,
    ...snapshot,
  };
}

function applyRuntimeEvent(
  current: RuntimeState,
  event: RuntimeEvent,
): RuntimeState {
  switch (event.type) {
    case "runtime:unit-state": {
      const existingIndex = current.units.findIndex(
        (unit) => unit.id === event.unit.id,
      );

      if (existingIndex === -1) {
        return current;
      }

      const nextUnits = [...current.units];
      const existingUnit = nextUnits[existingIndex];
      if (!existingUnit) {
        return current;
      }
      nextUnits[existingIndex] = mergeUnitSnapshot(existingUnit, event.unit);
      return {
        ...current,
        units: nextUnits,
      };
    }
    case "runtime:unit-log": {
      const existingIndex = current.units.findIndex(
        (unit) => unit.id === event.unitId,
      );

      if (existingIndex === -1) {
        return current;
      }

      const target = current.units[existingIndex];
      if (!target) {
        return current;
      }
      if (target.logTail.some((entry) => entry.id === event.entry.id)) {
        return current;
      }

      const nextUnits = [...current.units];
      nextUnits[existingIndex] = {
        ...target,
        logTail: [...target.logTail, event.entry].slice(-200),
      };

      return {
        ...current,
        units: nextUnits,
      };
    }
  }
}

function SurfaceButton({
  active,
  disabled,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "desktop-nav-item is-active" : "desktop-nav-item"}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <small>{meta}</small>
    </button>
  );
}

function SummaryCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function getWebviewPreloadUrl(): string {
  return window.nexuHost.bootstrap.webviewPreloadUrl;
}

// SurfaceFrame is imported from the shared component — see components/surface-frame.tsx

function RuntimeUnitCard({
  unit,
  onStart,
  onStop,
  busy,
}: {
  unit: RuntimeUnitState;
  onStart: (id: RuntimeUnitId) => Promise<void>;
  onStop: (id: RuntimeUnitId) => Promise<void>;
  busy: boolean;
}) {
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const isManaged =
    unit.launchStrategy === "managed" || unit.launchStrategy === "launchd";
  const canStart =
    isManaged &&
    (unit.phase === "idle" ||
      unit.phase === "stopped" ||
      unit.phase === "failed");
  const canStop =
    isManaged && (unit.phase === "running" || unit.phase === "starting");

  async function handleCopyLogs(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        filteredLogTail.map((entry) => formatLogLine(entry)).join("\n"),
      );
      toast.success(`Copied recent logs for ${unit.label}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to copy runtime logs.",
      );
    }
  }

  async function handleExportLogs(): Promise<void> {
    try {
      const ok = await showRuntimeLogFile(unit.id);

      if (!ok) {
        toast.error(`No log file available for ${unit.label}.`);
        return;
      }

      toast.success(`Revealed log file for ${unit.label}.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to open runtime log file.",
      );
    }
  }

  const filteredLogTail = useMemo(() => {
    switch (logFilter) {
      case "errors":
        return unit.logTail.filter((entry) => entry.stream === "stderr");
      case "lifecycle":
        return unit.logTail.filter((entry) => entry.kind === "lifecycle");
      default:
        return unit.logTail;
    }
  }, [logFilter, unit.logTail]);

  return (
    <article className="runtime-card">
      <div className="runtime-card-head">
        <div>
          <div className="runtime-label-row">
            <strong>{unit.label}</strong>
            <span className={`runtime-badge ${phaseTone(unit.phase)}`}>
              {unit.phase}
            </span>
          </div>
          <p className="runtime-kind">{kindLabel(unit)}</p>
          <p className="runtime-command">
            {unit.commandSummary ?? "embedded runtime unit"}
          </p>
        </div>
        <div className="runtime-actions">
          <button
            disabled={!canStart || busy}
            onClick={() => void onStart(unit.id)}
            type="button"
          >
            Start
          </button>
          <button
            disabled={!canStop || busy}
            onClick={() => void onStop(unit.id)}
            type="button"
          >
            Stop
          </button>
        </div>
      </div>

      <dl className="runtime-grid">
        <div>
          <dt>PID</dt>
          <dd>{unit.pid ?? "-"}</dd>
        </div>
        <div>
          <dt>Port</dt>
          <dd>{unit.port ?? "-"}</dd>
        </div>
        <div>
          <dt>Auto start</dt>
          <dd>{unit.autoStart ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>Exit code</dt>
          <dd>{unit.exitCode ?? "-"}</dd>
        </div>
        <div>
          <dt>Last reason</dt>
          <dd>{unit.lastReasonCode ?? "-"}</dd>
        </div>
        <div>
          <dt>Restarts</dt>
          <dd>{unit.restartCount}</dd>
        </div>
        <div>
          <dt>Last probe</dt>
          <dd>{unit.lastProbeAt ?? "-"}</dd>
        </div>
      </dl>

      {unit.lastError ? (
        <p className="runtime-error">{unit.lastError}</p>
      ) : null}

      {unit.binaryPath ? (
        <div className="runtime-binary-path">
          <div className="runtime-logs-head">
            <strong>OPENCLAW_BIN</strong>
          </div>
          <code>{unit.binaryPath}</code>
        </div>
      ) : null}

      <div className="runtime-logs">
        <div className="runtime-logs-head">
          <strong>Tail 200 logs</strong>
          <div className="runtime-logs-actions">
            <span>{filteredLogTail.length} lines</span>
            {(["all", "errors", "lifecycle"] as const).map((filter) => (
              <button
                aria-pressed={logFilter === filter}
                key={filter}
                onClick={() => setLogFilter(filter)}
                type="button"
              >
                {logFilterLabel(filter)}
              </button>
            ))}
            <button onClick={() => void handleCopyLogs()} type="button">
              Copy
            </button>
            <button onClick={() => void handleExportLogs()} type="button">
              Reveal
            </button>
          </div>
        </div>
        <pre className="runtime-log-tail">
          {filteredLogTail.length > 0
            ? filteredLogTail.map((entry) => formatLogLine(entry)).join("\n")
            : "No logs yet."}
        </pre>
      </div>
    </article>
  );
}

type ComponentUpdateInfo = {
  id: string;
  currentVersion: string | null;
  newVersion: string;
  size: number;
};

function RuntimePage() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeUnitId, setActiveUnitId] = useState<RuntimeUnitId | null>(null);
  const [componentUpdates, setComponentUpdates] = useState<
    ComponentUpdateInfo[] | null
  >(null);
  const [componentBusy, setComponentBusy] = useState(false);
  const [componentMessage, setComponentMessage] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const nextState = await getRuntimeState();
      setRuntimeState(nextState);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load runtime state.",
      );
    }
  }, []);

  useEffect(() => {
    void loadState();
    const unsubscribe = onRuntimeEvent((event) => {
      setRuntimeState((current) => {
        if (!current) {
          return current;
        }

        return applyRuntimeEvent(current, event);
      });
      setErrorMessage(null);
    });

    const timer = window.setInterval(() => {
      void loadState();
    }, 15000);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [loadState]);

  const summary = useMemo(() => {
    const units = runtimeState?.units ?? [];
    return {
      running: units.filter((unit) => unit.phase === "running").length,
      failed: units.filter((unit) => unit.phase === "failed").length,
      managed: units.filter(
        (unit) =>
          unit.launchStrategy === "managed" ||
          unit.launchStrategy === "launchd",
      ).length,
    };
  }, [runtimeState]);

  const units = runtimeState?.units ?? [];

  useEffect(() => {
    if (units.length === 0) {
      setActiveUnitId(null);
      return;
    }

    if (!activeUnitId || !units.some((unit) => unit.id === activeUnitId)) {
      setActiveUnitId(units[0]?.id ?? null);
    }
  }, [activeUnitId, units]);

  const activeUnit =
    units.find((unit) => unit.id === activeUnitId) ?? units[0] ?? null;

  async function runAction(id: string, action: () => Promise<RuntimeState>) {
    setBusyId(id);
    try {
      const nextState = await action();
      setRuntimeState(nextState);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Runtime action failed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="runtime-page">
      <header className="runtime-header">
        <div>
          <span className="runtime-eyebrow">Desktop Runtime</span>
          <h1>nexu local cold-start control room</h1>
          <p>
            Renderer keeps the browser mental model. Electron main orchestrates
            local runtime units.
          </p>
        </div>
      </header>

      <section className="runtime-summary">
        <SummaryCard
          label="Started at"
          value={runtimeState?.startedAt ?? "-"}
        />
        <SummaryCard label="Running" value={summary.running} />
        <SummaryCard label="Managed" value={summary.managed} />
        <SummaryCard label="Failed" value={summary.failed} />
      </section>

      <section className="component-update-section">
        <div className="component-update-head">
          <strong>Component Updates</strong>
          <button
            disabled={componentBusy}
            onClick={() => {
              setComponentBusy(true);
              setComponentMessage(null);
              void checkComponentUpdates()
                .then((result) => {
                  setComponentUpdates(result.updates);
                  setComponentMessage(
                    result.updates.length === 0
                      ? "All components are up to date."
                      : `${result.updates.length} update(s) available.`,
                  );
                })
                .catch((error) => {
                  setComponentMessage(
                    error instanceof Error
                      ? error.message
                      : "Failed to check component updates.",
                  );
                })
                .finally(() => setComponentBusy(false));
            }}
            type="button"
          >
            {componentBusy ? "Checking..." : "Check"}
          </button>
        </div>
        {componentMessage ? (
          <p className="component-update-message">{componentMessage}</p>
        ) : null}
        {componentUpdates && componentUpdates.length > 0 ? (
          <ul className="component-update-list">
            {componentUpdates.map((u) => (
              <li key={u.id}>
                <span>
                  {u.id}: {u.currentVersion ?? "none"} → {u.newVersion} (
                  {u.size} bytes)
                </span>
                <button
                  disabled={componentBusy}
                  onClick={() => {
                    setComponentBusy(true);
                    void installComponent(u.id)
                      .then((result) => {
                        setComponentMessage(
                          result.ok
                            ? `Installed ${u.id} successfully.`
                            : `Failed to install ${u.id}.`,
                        );
                        if (result.ok) {
                          setComponentUpdates(
                            (prev) =>
                              prev?.filter((item) => item.id !== u.id) ?? null,
                          );
                        }
                      })
                      .catch((error) => {
                        setComponentMessage(
                          error instanceof Error
                            ? error.message
                            : `Install failed for ${u.id}.`,
                        );
                      })
                      .finally(() => setComponentBusy(false));
                  }}
                  type="button"
                >
                  Install
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <p className="runtime-note">
        Control plane currently renders unit metadata plus in-memory tail 200
        logs from the local orchestrator.
      </p>

      {errorMessage ? (
        <p className="runtime-error-banner">{errorMessage}</p>
      ) : null}

      <section className="runtime-pane-layout">
        <aside className="runtime-sidebar" aria-label="Runtime units">
          {units.map((unit) => (
            <button
              aria-selected={activeUnit?.id === unit.id}
              className={
                activeUnit?.id === unit.id
                  ? "runtime-side-tab is-active"
                  : "runtime-side-tab"
              }
              key={unit.id}
              onClick={() => setActiveUnitId(unit.id)}
              role="tab"
              type="button"
            >
              <span className="runtime-side-tab-label">{unit.label}</span>
              <span className={`runtime-badge ${phaseTone(unit.phase)}`}>
                {unit.phase}
              </span>
            </button>
          ))}
        </aside>

        <div className="runtime-detail-pane">
          {activeUnit ? (
            <RuntimeUnitCard
              busy={busyId !== null}
              onStart={(id) => runAction(`start:${id}`, () => startUnit(id))}
              onStop={(id) => runAction(`stop:${id}`, () => stopUnit(id))}
              unit={activeUnit}
            />
          ) : (
            <section className="runtime-empty-state">
              No runtime units available.
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function EmbeddedControlPlane() {
  return (
    <>
      <RuntimePage />
      <Toaster position="top-right" />
    </>
  );
}

type DiagnosticsActionId =
  | "renderer-exception"
  | "renderer-crash"
  | "main-crash";

function DiagnosticsActionCard({
  description,
  disabled,
  label,
  onClick,
}: {
  description: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <article className="diagnostics-action-card">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button disabled={disabled} onClick={onClick} type="button">
        Trigger
      </button>
    </article>
  );
}

function DiagnosticsPage({
  runtimeConfig,
}: {
  runtimeConfig: DesktopRuntimeConfig | null;
}) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [diagnosticsInfo, setDiagnosticsInfo] =
    useState<DiagnosticsInfo | null>(null);
  const [busyAction, setBusyAction] = useState<DiagnosticsActionId | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string>(
    "Ready for diagnostics.",
  );

  useEffect(() => {
    void Promise.all([getAppInfo(), getDiagnosticsInfo()])
      .then(([nextAppInfo, nextDiagnosticsInfo]) => {
        setAppInfo(nextAppInfo);
        setDiagnosticsInfo(nextDiagnosticsInfo);
        setErrorMessage(null);
      })
      .catch((error) => {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load diagnostics metadata.",
        );
      });
  }, []);

  const runAction = useCallback(
    async (actionId: DiagnosticsActionId, action: () => Promise<void>) => {
      setBusyAction(actionId);
      setErrorMessage(null);

      try {
        await action();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Diagnostics action failed.",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [],
  );

  const triggerRendererException = useCallback(() => {
    const title = "desktop.renderer.exception";
    setLastAction(
      `Renderer exception scheduled at ${new Date().toLocaleTimeString()}.`,
    );

    window.setTimeout(() => {
      throw new Error(title);
    }, 0);
  }, []);

  const triggerRendererCrash = useCallback(() => {
    setLastAction(
      `Renderer crash requested at ${new Date().toLocaleTimeString()}.`,
    );

    void runAction("renderer-crash", async () => {
      await triggerRendererProcessCrash();
    });
  }, [runAction]);

  const triggerMainCrash = useCallback(() => {
    setLastAction(
      `Main crash requested at ${new Date().toLocaleTimeString()}.`,
    );

    void runAction("main-crash", async () => {
      await triggerMainProcessCrash();
    });
  }, [runAction]);

  return (
    <div className="runtime-page diagnostics-page">
      <header className="runtime-header diagnostics-header">
        <div>
          <span className="runtime-eyebrow">Crash Diagnostics</span>
          <h1>Exercise the Electron failure paths on demand</h1>
          <p>
            Use one page to validate renderer exceptions, renderer process
            exits, and main process crashes through the local desktop
            observability stack.
          </p>
        </div>
      </header>

      <section className="runtime-summary diagnostics-summary">
        <SummaryCard
          label="App"
          value={appInfo ? `${appInfo.appName} ${appInfo.appVersion}` : "-"}
        />
        <SummaryCard label="Platform" value={appInfo?.platform ?? "-"} />
        <SummaryCard
          label="Mode"
          value={appInfo ? (appInfo.isDev ? "development" : "packaged") : "-"}
        />
        <SummaryCard
          label="Native crashes"
          value={
            diagnosticsInfo
              ? diagnosticsInfo.nativeCrashPipeline === "sentry"
                ? "sentry"
                : "local-only"
              : "-"
          }
        />
        <SummaryCard
          label="nexu Home"
          className="diagnostics-summary-wide"
          value={runtimeConfig?.paths.nexuHome ?? "-"}
        />
        <SummaryCard
          label="Crash dumps"
          className="diagnostics-summary-wide"
          value={diagnosticsInfo?.crashDumpsPath ?? "-"}
        />
        <SummaryCard
          label="Sentry DSN"
          className="diagnostics-summary-wide"
          value={
            diagnosticsInfo ? maskSentryDsn(diagnosticsInfo.sentryDsn) : "-"
          }
        />
      </section>

      <p className="runtime-note diagnostics-note">
        The renderer exception path keeps the process alive and is meant for
        JavaScript error capture. The renderer crash and main crash paths
        terminate a process and are meant for native crash capture.
      </p>

      {errorMessage ? (
        <p className="runtime-error-banner">{errorMessage}</p>
      ) : null}

      <section className="diagnostics-grid">
        <DiagnosticsActionCard
          description="Throws an unhandled renderer Error named desktop.renderer.exception. Use this to validate JavaScript exception capture without killing the app."
          disabled={busyAction !== null}
          label="Test Renderer Exception"
          onClick={triggerRendererException}
        />
        <DiagnosticsActionCard
          description="Asks the main process to forcefully crash the current renderer process with the title desktop.renderer.crash. Use this to validate renderer crash handling and crash dump creation."
          disabled={busyAction !== null}
          label="Test Renderer Crash"
          onClick={triggerRendererCrash}
        />
        <DiagnosticsActionCard
          description="Invokes a deliberate main process crash with the title desktop.main.crash. Use this to validate the native crash pipeline for the Electron host itself."
          disabled={busyAction !== null}
          label="Test Main Crash"
          onClick={triggerMainCrash}
        />
      </section>

      <section className="diagnostics-status-card">
        <div>
          <span className="runtime-eyebrow">Last action</span>
          <h2>{lastAction}</h2>
          <p>
            Renderer process type: {diagnosticsInfo?.processType ?? "unknown"}.
            JavaScript exceptions should stay visible in the renderer and in
            Sentry when configured. Process crashes should leave Crashpad dumps
            and, with Sentry enabled, upload native crash events.
          </p>
        </div>
      </section>
    </div>
  );
}

function DesktopShell() {
  const devImmersive = window.nexuHost.bootstrap.devImmersive;
  const isLocalDesktopBuild =
    window.nexuHost.bootstrap.buildInfo.source === "local-dev" ||
    window.nexuHost.bootstrap.buildInfo.source === "local-dist";
  const [activeSurface, setActiveSurface] = useState<DesktopSurface>("web");
  const [showSetBalanceDialog, setShowSetBalanceDialog] = useState(false);
  const [chromeMode, setChromeMode] = useState<DesktopChromeMode>(
    devImmersive
      ? "immersive"
      : window.nexuHost.bootstrap.buildInfo.source === "local-dev"
        ? "full"
        : "immersive",
  );
  const webSurfaceVersion = 0;
  const [runtimeConfig, setRuntimeConfig] =
    useState<DesktopRuntimeConfig | null>(null);
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const updateExperience = useMemo(
    () =>
      runtimeConfig
        ? resolveDesktopUpdateExperience({
            buildSource: runtimeConfig.buildInfo.source,
            updateFeed: runtimeConfig.urls.updateFeed,
          })
        : "normal",
    [runtimeConfig],
  );
  const update = useAutoUpdate({ experience: updateExperience });

  // Setup animation phases:
  // "active" → video looping + progress overlay visible
  // "fading" → overlay fades out (0.6s CSS transition)
  // "done" → overlay removed from DOM
  const [setupPhase, setSetupPhase] = useState<"active" | "fading" | "done">(
    window.nexuHost.bootstrap.needsSetupAnimation ? "active" : "done",
  );

  const [setupCurrentStage, setSetupCurrentStage] = useState<string | null>(
    null,
  );

  // When animation finishes, notify main process to restore vibrancy
  useEffect(() => {
    if (
      setupPhase === "done" &&
      window.nexuHost.bootstrap.needsSetupAnimation
    ) {
      void notifySetupAnimationComplete();
    }
  }, [setupPhase]);

  useEffect(() => {
    void getRuntimeConfig()
      .then((config) => {
        setRuntimeConfig(config);
        // Cold-start is done — if we're still in active phase, start fading.
        if (!holdSetupAnimation) {
          setSetupPhase((prev) => (prev === "active" ? "fading" : prev));
        }
      })
      .catch(() => null);

    void getRuntimeState()
      .then(setRuntimeState)
      .catch(() => null);
  }, []);

  useEffect(() => {
    const unsubscribe = onRuntimeEvent((event) => {
      setRuntimeState((current) => {
        if (!current) {
          return current;
        }

        return applyRuntimeEvent(current, event);
      });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return onDesktopCommand((command) => {
      if (command.type === "desktop:check-for-updates") {
        void update.check();
        return;
      }
      if (command.type === "develop:open-set-balance") {
        setShowSetBalanceDialog(true);
        return;
      }
      if (command.type === "setup:progress") {
        setSetupCurrentStage(command.stage);
        return;
      }
      if (command.type === "setup:complete") {
        return;
      }
      if (
        command.type !== "develop:focus-surface" &&
        command.type !== "develop:show-shell"
      ) {
        return;
      }

      setActiveSurface(command.surface);
      setChromeMode(command.chromeMode);
    });
  }, [update]);

  // Poll the controller ready endpoint through the web sidecar proxy before mounting the webview.
  // Note: getRuntimeConfig() IPC handler waits for cold-start to complete, so
  // runtimeConfig always has the final ports (including any fallback).
  const [controllerReady, setControllerReady] = useState(false);
  const [controllerSurfaceState, setControllerSurfaceState] =
    useState<ControllerSurfaceState>("polling");
  const [controllerRetryNonce, setControllerRetryNonce] = useState(0);
  const controllerRetryNonceRef = useRef(controllerRetryNonce);

  useEffect(() => {
    controllerRetryNonceRef.current = controllerRetryNonce;
  }, [controllerRetryNonce]);

  const handleRetryController = useCallback(() => {
    setControllerReady(false);
    setControllerSurfaceState("polling");
    setControllerRetryNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!runtimeConfig) return;
    if (controllerReady) return;

    const retryNonce = controllerRetryNonce;
    let cancelled = false;
    setControllerSurfaceState("polling");
    const readyUrl = new URL(
      "/api/internal/desktop/ready",
      runtimeConfig.urls.web,
    ).toString();

    void ensureDesktopControllerReady({
      readyUrl,
      ...getDesktopControllerReadyTiming(runtimeConfig.buildInfo.source),
      startController: async () => {
        await startUnit("controller");
      },
      onStatusChange: (status) => {
        if (!cancelled && controllerRetryNonceRef.current === retryNonce) {
          setControllerSurfaceState(status);
        }
      },
    }).then((ready) => {
      if (cancelled || controllerRetryNonceRef.current !== retryNonce) {
        return;
      }

      if (ready) {
        setControllerReady(true);
        setControllerSurfaceState("polling");
        return;
      }

      setControllerSurfaceState("failed");
      if (isLocalDesktopBuild) {
        setActiveSurface((surface) =>
          surface === "web" ? "control" : surface,
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    isLocalDesktopBuild,
    runtimeConfig,
    controllerReady,
    controllerRetryNonce,
  ]);

  const desktopWebUrl =
    runtimeConfig && controllerReady
      ? new URL("/workspace", runtimeConfig.urls.web).toString()
      : null;
  const desktopOpenClawUrl = getDesktopOpenClawUrl({
    runtimeConfig,
    runtimeState,
  });
  return (
    <div
      className={
        chromeMode === "immersive"
          ? "desktop-shell is-immersive"
          : "desktop-shell"
      }
    >
      <DevelopSetBalanceDialog
        open={showSetBalanceDialog}
        onClose={() => setShowSetBalanceDialog(false)}
      />
      <div className="window-drag-bar" />
      <aside className="desktop-sidebar">
        <div className="desktop-sidebar-brand">
          <div className="desktop-sidebar-brand-top">
            <span className="desktop-shell-eyebrow">nexu desktop</span>
            <UpdateBadge
              dismissed={update.dismissed}
              onUndismiss={update.undismiss}
              phase={update.phase}
            />
          </div>
          <h1>Runtime Console Ready</h1>
          <p>
            One local shell for bootstrap health, web verification, and gateway
            inspection.
          </p>
        </div>

        <nav className="desktop-nav" aria-label="Desktop surfaces">
          <SurfaceButton
            active={activeSurface === "control"}
            label="Control Plane"
            meta="Bootstrap status and per-unit intervention"
            onClick={() => setActiveSurface("control")}
          />
          <SurfaceButton
            active={activeSurface === "cloud-profile"}
            label="Cloud Profile"
            meta="Switch cloud endpoints and reset auth state"
            onClick={() => setActiveSurface("cloud-profile")}
          />
          <SurfaceButton
            active={activeSurface === "web"}
            disabled={!desktopWebUrl}
            label="Web"
            meta="Workspace surface via local HTTP sidecar"
            onClick={() => setActiveSurface("web")}
          />
          <SurfaceButton
            active={activeSurface === "openclaw"}
            label="OpenClaw"
            meta="Gateway control UI with local token routing"
            onClick={() => setActiveSurface("openclaw")}
          />
          <SurfaceButton
            active={activeSurface === "diagnostics"}
            label="Diagnostics"
            meta="Crash and exception test bench"
            onClick={() => setActiveSurface("diagnostics")}
          />
        </nav>

        {runtimeConfig ? (
          <div className="desktop-sidebar-config">
            <span className="desktop-shell-eyebrow">Build Info</span>
            <dl className="desktop-config-list">
              <div>
                <dt>Source</dt>
                <dd>{runtimeConfig.buildInfo.source}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{runtimeConfig.buildInfo.version}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{runtimeConfig.buildInfo.branch ?? "(unknown)"}</dd>
              </div>
              <div>
                <dt>Commit</dt>
                <dd title={runtimeConfig.buildInfo.commit ?? undefined}>
                  {formatBuildCommit(runtimeConfig.buildInfo.commit)}
                </dd>
              </div>
              <div>
                <dt>Built At</dt>
                <dd>{formatBuildTimestamp(runtimeConfig.buildInfo.builtAt)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </aside>

      <main className="desktop-shell-stage">
        <div
          style={{ display: activeSurface === "control" ? "contents" : "none" }}
        >
          <EmbeddedControlPlane />
        </div>
        <div
          style={{
            display: activeSurface === "cloud-profile" ? "contents" : "none",
          }}
        >
          <CloudProfilePage />
        </div>
        <div style={{ display: activeSurface === "web" ? "contents" : "none" }}>
          {desktopWebUrl ? (
            <SurfaceFrame
              description="Authenticated workspace surface served by the repo-local web sidecar."
              src={desktopWebUrl}
              title="Tabby Web"
              version={webSurfaceVersion}
              preload={getWebviewPreloadUrl()}
            />
          ) : controllerSurfaceState === "failed" ||
            controllerSurfaceState === "recovering" ? (
            <section className="runtime-empty-state">
              <span className="runtime-eyebrow">Tabby Workspace</span>
              <h2>
                {controllerSurfaceState === "recovering"
                  ? "正在重启后台服务..."
                  : "工作区暂时不可用"}
              </h2>
              <p>
                {controllerSurfaceState === "recovering"
                  ? "Tabby 正在重新连接本地运行时，完成后会自动打开工作区。"
                  : "本地运行时启动超时。可以重试连接，或在开发构建中打开控制台查看详情。"}
              </p>
              <div className="runtime-actions">
                <button
                  disabled={controllerSurfaceState === "recovering"}
                  onClick={handleRetryController}
                  type="button"
                >
                  {controllerSurfaceState === "recovering"
                    ? "正在重启..."
                    : "重试连接"}
                </button>
                {isLocalDesktopBuild ? (
                  <button
                    onClick={() => setActiveSurface("control")}
                    type="button"
                  >
                    打开控制台
                  </button>
                ) : null}
              </div>
            </section>
          ) : (
            // Normal polling state: show the brand loader instead of a
            // text card with a "Retry controller" button. SurfaceFrame with
            // src={null} renders its built-in Tabby loader overlay, which is
            // the same loader used once the webview mounts — producing a
            // seamless visual transition once the controller is ready.
            // See issue #876.
            <SurfaceFrame
              description="Authenticated workspace surface served by the repo-local web sidecar."
              src={null}
              title="Tabby Web"
              version={webSurfaceVersion}
              preload={getWebviewPreloadUrl()}
            />
          )}
        </div>
        <div
          style={{
            display: activeSurface === "openclaw" ? "contents" : "none",
          }}
        >
          <SurfaceFrame
            description="Local OpenClaw gateway UI for inspecting runtime auth, models, and sessions."
            src={desktopOpenClawUrl}
            title="OpenClaw Gateway"
            version={0}
          />
        </div>
        <div
          style={{
            display: activeSurface === "diagnostics" ? "contents" : "none",
          }}
        >
          <DiagnosticsPage runtimeConfig={runtimeConfig} />
        </div>
      </main>

      <UpdateBanner
        canCheckForUpdates={
          updateExperience === "local-test-feed" &&
          Boolean(update.capability?.check)
        }
        capability={update.capability}
        currentVersion={runtimeConfig?.buildInfo.version ?? null}
        dismissed={update.dismissed}
        errorMessage={update.errorMessage}
        experience={updateExperience}
        onCheck={() => void update.check()}
        onDismiss={update.dismiss}
        onDownload={() => void update.download()}
        onInstall={() => void update.install()}
        percent={update.percent}
        phase={update.phase}
        releaseNotes={update.releaseNotes}
        version={update.version}
      />

      {/* Setup animation overlay — shown during first install / post-update extraction.
          Single video loops until cold-start is ready, then fades out.
          Progress panel shows current cold-start stage. */}
      {setupPhase !== "done" && (
        <div
          className={
            setupPhase === "fading"
              ? "setup-overlay is-fading"
              : "setup-overlay"
          }
          onTransitionEnd={() => {
            if (setupPhase === "fading") setSetupPhase("done");
          }}
        >
          {/* Draggable title bar area so window remains movable during setup */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 52,
              // @ts-expect-error Electron CSS property for window dragging
              WebkitAppRegion: "drag",
              zIndex: 1,
            }}
          />

          <output className="setup-shell" aria-live="polite">
            <section className="setup-visual" aria-label="Tabby setup preview">
              <div className="setup-video-frame">
                <video
                  autoPlay
                  muted
                  playsInline
                  loop
                  onError={() => setSetupPhase("fading")}
                >
                  <source src={setupTransparentVideoUrl} type="video/webm" />
                  <source src={setupVideoUrl} type="video/mp4" />
                </video>
              </div>
            </section>

            <section className="setup-progress-panel">
              <div className="setup-progress-head">
                <span className="setup-eyebrow">Tabby Desktop</span>
                <h2>正在准备你的工作区</h2>
                <p>
                  首次安装会初始化本地运行时和工作区组件，完成后会自动进入
                  Tabby。
                </p>
              </div>

              <div className="setup-progress-bar" aria-hidden="true">
                <span
                  style={{
                    width: `${
                      Math.max(
                        1,
                        SETUP_STAGE_ORDER.indexOf(setupCurrentStage ?? "") + 1,
                      ) *
                      (100 / SETUP_STAGE_ORDER.length)
                    }%`,
                  }}
                />
              </div>

              <ol className="setup-stage-list">
                {SETUP_STAGE_ORDER.map((stage, index) => {
                  const currentIdx = SETUP_STAGE_ORDER.indexOf(
                    setupCurrentStage ?? "",
                  );
                  const isComplete = currentIdx >= 0 && index < currentIdx;
                  const isCurrent =
                    stage === setupCurrentStage ||
                    (setupCurrentStage === null && index === 0);
                  const itemClassName = isCurrent
                    ? "setup-stage-item is-current"
                    : isComplete
                      ? "setup-stage-item is-complete"
                      : "setup-stage-item";

                  return (
                    <li className={itemClassName} key={stage}>
                      <span className="setup-stage-marker">
                        {isComplete ? (
                          <svg
                            aria-hidden="true"
                            width={12}
                            height={12}
                            viewBox="0 0 12 12"
                            fill="none"
                          >
                            <path
                              d="M2.5 6.1L4.8 8.3L9.5 3.7"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </span>
                      <span>{SETUP_STAGE_LABELS[stage]}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          </output>
        </div>
      )}
    </div>
  );
}

function RootApp() {
  return <DesktopShell />;
}

function RendererTelemetryBootstrap() {
  useEffect(() => {
    if (rendererSentryDsn && !rendererSentryInitialized) {
      sendRendererStartupProbe("renderer:sentry-init:start", "ok");
      void (async () => {
        // Session Replay is a separate opt-in preference; read it before init
        // (toggling takes effect on the next launch).
        let sessionReplayEnabled = false;
        try {
          const prefs = await window.nexuHost.invoke(
            "desktop:get-shell-preferences",
            undefined,
          );
          sessionReplayEnabled = prefs.sessionReplayEnabled;
        } catch {
          sessionReplayEnabled = false;
        }
        try {
          initializeRendererSentry(rendererSentryDsn, sessionReplayEnabled);
          sendRendererStartupProbe("renderer:sentry-init:success", "ok");
        } catch (error) {
          sendRendererStartupProbe(
            "renderer:sentry-init:error",
            "error",
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
          );
          console.error("[desktop] renderer Sentry init failed", error);
        }
      })();
    }

    if (!posthogApiKey || posthogTelemetryInitialized) {
      return;
    }

    sendRendererStartupProbe("renderer:posthog-init:start", "ok");
    try {
      initializePostHogTelemetry();
      sendRendererStartupProbe("renderer:posthog-init:success", "ok");
    } catch (error) {
      sendRendererStartupProbe(
        "renderer:posthog-init:error",
        "error",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      console.error("[desktop] renderer PostHog init failed", error);
    }
  }, []);

  return null;
}

function RendererAnalyticsIdentitySync() {
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        const data = await getDesktopCloudStatus();
        if (cancelled) {
          return;
        }

        syncPostHogIdentity({
          userId: data.userId ?? null,
          userEmail: data.userEmail ?? null,
          userName: data.userName ?? null,
        });
      } catch {
        // Ignore transient fetch errors. Keep existing identity until a
        // successful status refresh says otherwise.
      }
    };

    void sync();
    const interval = window.setInterval(() => {
      void sync();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return null;
}

function RendererStartupSentinel() {
  useEffect(() => {
    if (rendererCommitReported) {
      return;
    }

    rendererCommitReported = true;
    sendRendererStartupProbe("renderer:react-render:committed", "ok");
  }, []);

  return null;
}
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const rootWindow = window as Window & {
  __nexuDesktopRoot?: Root;
};
const appRoot = rootWindow.__nexuDesktopRoot ?? createRoot(rootElement);

rootWindow.__nexuDesktopRoot = appRoot;

appRoot.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RendererStartupSentinel />
      <RendererTelemetryBootstrap />
      <RendererAnalyticsIdentitySync />
      <RootApp />
    </QueryClientProvider>
  </React.StrictMode>,
);
