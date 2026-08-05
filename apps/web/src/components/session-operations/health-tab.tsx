import { requestDesktopHost } from "@/lib/desktop-host";
import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronRight, FileOutput, Gauge, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { postApiV1RuntimeConfigLocalAutomationComputerUsePermissions } from "../../../lib/api/sdk.gen";
import type {
  GetApiInternalDesktopReadyResponse,
  GetApiV1ChannelsLiveStatusResponse,
  GetApiV1RuntimeConfigResponse,
  GetApiV1RuntimeOperationsResponse,
} from "../../../lib/api/types.gen";
import { HealthRow, SectionTitle } from "./panel-atoms";

interface HealthTabProps {
  runtimeQuery: UseQueryResult<GetApiInternalDesktopReadyResponse, Error>;
  operationsQuery: UseQueryResult<GetApiV1RuntimeOperationsResponse, Error>;
  channelsQuery: UseQueryResult<GetApiV1ChannelsLiveStatusResponse, Error>;
  runtimeConfigQuery: UseQueryResult<GetApiV1RuntimeConfigResponse, Error>;
  hostAction: string | null;
  onRunHostAction: (
    action: string,
    execute: () => Promise<unknown>,
  ) => Promise<void>;
  onOpenBrowser: () => void;
}

export function HealthTab({
  runtimeQuery,
  operationsQuery,
  channelsQuery,
  runtimeConfigQuery,
  hostAction,
  onRunHostAction,
  onOpenBrowser,
}: HealthTabProps) {
  const { t } = useTranslation();

  const runtime = runtimeQuery.data;
  const runtimeHealthy = runtime?.ready === true;
  const runtimeWarning =
    runtime?.degraded === true || runtime?.status === "unhealthy";
  const channelSummary = channelsQuery.data
    ? `${channelsQuery.data.channels.filter((channel) => channel.ready).length}/${channelsQuery.data.channels.length}`
    : null;
  const computerUseStatus =
    runtimeConfigQuery.data?.localAutomationStatus.computerUsePermissionState;

  return (
    <section className="px-4 py-4">
      <SectionTitle icon={Gauge}>
        {t("sessions.operations.health")}
      </SectionTitle>
      <div className="mt-3 space-y-3">
        <HealthRow
          label={t("sessions.operations.controller")}
          status={
            runtimeQuery.isError
              ? t("sessions.operations.unavailable")
              : runtimeQuery.isLoading
                ? t("sessions.operations.checking")
                : (runtime?.status ?? t("sessions.operations.unavailable"))
          }
          active={runtimeHealthy}
          warning={runtimeWarning}
          actionLabel={t("sessions.operations.viewLogs")}
          actionBusy={hostAction === "controller-log"}
          onAction={() => {
            void onRunHostAction("controller-log", () =>
              requestDesktopHost("runtime:show-log-file", {
                id: "controller",
              }),
            );
          }}
        />
        <HealthRow
          label={t("sessions.operations.runtime")}
          status={
            operationsQuery.isError
              ? t("sessions.operations.unavailable")
              : operationsQuery.isLoading
                ? t("sessions.operations.checking")
                : operationsQuery.data?.connected
                  ? t("sessions.operations.connected")
                  : t("sessions.operations.disconnected")
          }
          active={operationsQuery.data?.connected === true}
          warning={operationsQuery.isError}
          actionLabel={t("sessions.operations.restart")}
          actionBusy={hostAction === "openclaw-restart"}
          onAction={() => {
            void onRunHostAction("openclaw-restart", async () => {
              const stopped = await requestDesktopHost("runtime:stop-unit", {
                id: "openclaw",
              });
              if (stopped === undefined) return undefined;
              return requestDesktopHost("runtime:start-unit", {
                id: "openclaw",
              });
            });
          }}
        />
        <HealthRow
          label={t("sessions.operations.channels")}
          status={
            channelsQuery.isError
              ? t("sessions.operations.unavailable")
              : channelsQuery.isLoading
                ? t("sessions.operations.checking")
                : (channelSummary ?? "0/0")
          }
          active={channelsQuery.data?.gatewayConnected === true}
          warning={channelsQuery.data?.gatewaySafeMode === true}
          href="/workspace/channels"
        />
        <HealthRow
          label={t("sessions.operations.browser")}
          status={
            runtimeConfigQuery.isError
              ? t("sessions.operations.unavailable")
              : runtimeConfigQuery.isLoading
                ? t("sessions.operations.checking")
                : runtimeConfigQuery.data?.localAutomation.browser?.enabled
                  ? t("sessions.operations.enabled")
                  : t("sessions.operations.disabled")
          }
          active={
            runtimeConfigQuery.data?.localAutomation.browser?.enabled === true
          }
          actionLabel={t("sessions.operations.open")}
          onAction={onOpenBrowser}
        />
        <HealthRow
          label={t("sessions.operations.computerUse")}
          status={computerUseStatus ?? t("sessions.operations.unavailable")}
          active={computerUseStatus === "ready"}
          warning={computerUseStatus === "permission-required"}
          actionLabel={
            computerUseStatus === "permission-required"
              ? t("sessions.operations.requestPermission")
              : undefined
          }
          actionBusy={hostAction === "permissions"}
          onAction={
            computerUseStatus === "permission-required"
              ? () => {
                  void onRunHostAction("permissions", async () => {
                    const { data, error } =
                      await postApiV1RuntimeConfigLocalAutomationComputerUsePermissions();
                    if (error || !data) return undefined;
                    return data;
                  });
                }
              : undefined
          }
        />
        <HealthRow
          label={t("sessions.operations.modelAuth")}
          status={
            operationsQuery.isError
              ? t("sessions.operations.unavailable")
              : operationsQuery.isLoading
                ? t("sessions.operations.checking")
                : operationsQuery.data?.modelAuth.status === "ready"
                  ? t("sessions.operations.available")
                  : operationsQuery.data?.modelAuth.status === "unavailable"
                    ? t("sessions.operations.unavailable")
                    : t("sessions.operations.needsAttention")
          }
          active={operationsQuery.data?.modelAuth.status === "ready"}
          warning={operationsQuery.data?.modelAuth.status === "needs-attention"}
          href="/workspace/settings/models"
        />
      </div>
      <button
        type="button"
        disabled={hostAction === "diagnostics"}
        onClick={() => {
          void onRunHostAction("diagnostics", () =>
            requestDesktopHost("diagnostics:export", {
              source: "diagnostics-page",
            }),
          );
        }}
        className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {hostAction === "diagnostics" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FileOutput className="size-3.5" />
        )}
        {t("sessions.operations.exportDiagnostics")}
      </button>
      <Link
        to="/workspace/settings"
        className="mt-3 flex items-center justify-between text-[11px] font-medium text-[var(--color-brand-primary)] hover:underline"
      >
        <span>{t("sessions.operations.openSettings")}</span>
        <ChevronRight className="size-3.5" />
      </Link>
    </section>
  );
}
