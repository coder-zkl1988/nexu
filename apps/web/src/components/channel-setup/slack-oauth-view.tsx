import { BotPicker } from "@/components/channels/bot-picker";
import { Input } from "@/components/ui/input";
import { identify, track } from "@/lib/tracking";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiV1Channels,
  getApiV1ChannelsSlackOauthUrl,
  getApiV1ChannelsSlackRedirectUri,
  postApiV1ChannelsSlackConnect,
} from "../../../lib/api/sdk.gen";

const SLACK_MANUAL_STEP_KEYS = [
  "slackSetup.stepCreateApp",
  "slackSetup.stepSigningSecret",
  "slackSetup.stepBotToken",
  "slackSetup.stepEnableDMs",
];

const SLACK_LOGO_PATH =
  "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z";

const SLACK_MANIFEST_SCOPES = [
  "app_mentions:read",
  "assistant:write",
  "channels:history",
  "channels:read",
  "chat:write",
  "chat:write.customize",
  "chat:write.public",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "im:write.topic",
  "links:write",
  "metadata.message:read",
  "mpim:history",
  "mpim:read",
  "mpim:write",
  "mpim:write.topic",
  "reactions:write",
  "remote_files:read",
  "team:read",
  "usergroups:read",
  "users:read",
  "users.profile:read",
];

const SLACK_MANIFEST_BOT_EVENTS = [
  "app_mention",
  "app_uninstalled",
  "file_created",
  "message.channels",
  "message.groups",
  "message.im",
  "message.mpim",
  "subteam_created",
  "team_join",
  "team_rename",
  "tokens_revoked",
];

function buildSlackManifestUrl(baseUrl: string): string {
  const manifest = {
    display_information: {
      name: "Tabby",
      description: "Tabby — AI-powered workspace for your team",
      background_color: "#29292b",
    },
    features: {
      bot_user: { display_name: "Tabby", always_online: true },
    },
    oauth_config: {
      redirect_urls: [`${baseUrl}/api/oauth/slack/callback`],
      scopes: { bot: SLACK_MANIFEST_SCOPES },
    },
    settings: {
      event_subscriptions: {
        request_url: `${baseUrl}/api/slack/events`,
        bot_events: SLACK_MANIFEST_BOT_EVENTS,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}

function resolveSlackBaseUrl(redirectUri: string): string {
  const redirectUrl = new URL(redirectUri);
  if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
    throw new Error("unsupported Slack redirect URI protocol");
  }

  const callbackPath = "/api/oauth/slack/callback";
  const basePath = redirectUrl.pathname.endsWith(callbackPath)
    ? redirectUrl.pathname.slice(0, -callbackPath.length)
    : "";
  return `${redirectUrl.origin}${basePath}`.replace(/\/$/, "");
}

export interface SlackOAuthViewProps {
  /** Called when Slack is successfully connected */
  onConnected: () => void;
  /** Layout variant — "page" uses full width, "modal" constrains width */
  variant?: "page" | "modal";
  /** Start directly in manual mode */
  initialManual?: boolean;
  /** Hide the deprecated OAuth placeholder and expose only manual setup. */
  manualOnly?: boolean;
  /** OAuth returnTo path (e.g. "/onboarding?openModal=slack") */
  oauthReturnTo?: string;
  /** Error message from a failed OAuth attempt (passed via query param) */
  oauthError?: string;
  /** Disable all connect actions (e.g. quota exceeded) */
  disabled?: boolean;
}

export function SlackOAuthView({
  onConnected,
  variant = "page",
  initialManual,
  manualOnly = false,
  oauthReturnTo,
  oauthError,
  disabled,
}: SlackOAuthViewProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"install" | "authorizing" | "manual">(
    initialManual || manualOnly ? "manual" : "install",
  );
  const [activeStep, setActiveStep] = useState(0);
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [botId, setBotId] = useState<string>("");
  const [oauthFailed, setOauthFailed] = useState(!!oauthError);
  const [oauthErrorMsg, setOauthErrorMsg] = useState(oauthError || "");
  const channelsQuery = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data, error } = await getApiV1Channels();
      if (error || !data) {
        throw new Error("Slack channel bindings are unavailable");
      }
      return data;
    },
  });
  const redirectUriQuery = useQuery({
    queryKey: ["slack-redirect-uri"],
    queryFn: async () => {
      const { data, error } = await getApiV1ChannelsSlackRedirectUri();
      if (error || !data?.redirectUri) {
        throw new Error("Slack redirect URI is unavailable");
      }
      return resolveSlackBaseUrl(data.redirectUri);
    },
  });
  const disabledBotIds = useMemo(() => {
    const channels = channelsQuery.data?.channels ?? [];
    return new Set(
      channels.filter((ch) => ch.channelType === "slack").map((ch) => ch.botId),
    );
  }, [channelsQuery.data]);
  const channelOperationsDisabled =
    disabled || connecting || !channelsQuery.isSuccess;

  // Detect return from failed OAuth via browser back button
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run once on mount to check OAuth state
  useEffect(() => {
    const markFailed = () => {
      setOauthFailed(true);
      setOauthErrorMsg(t("slackSetup.authNotCompleted"));
      setPhase("manual");
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted && sessionStorage.getItem("slack_oauth_pending")) {
        sessionStorage.removeItem("slack_oauth_pending");
        markFailed();
      }
    };

    if (sessionStorage.getItem("slack_oauth_pending")) {
      sessionStorage.removeItem("slack_oauth_pending");
      markFailed();
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const handleAddToSlack = async () => {
    setPhase("authorizing");
    try {
      const { data, error } = await getApiV1ChannelsSlackOauthUrl({
        query: oauthReturnTo ? { returnTo: oauthReturnTo } : undefined,
      });
      if (error) {
        const errorMessage =
          typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : t("slackSetup.oauthUrlFailed");
        toast.error(errorMessage);
        setPhase("install");
        return;
      }
      if (data?.url) {
        sessionStorage.setItem("slack_oauth_pending", "true");
        window.location.href = data.url;
      }
    } catch {
      toast.error(t("slackSetup.startFailed"));
      setPhase("install");
    }
  };

  const handleManualConnect = async () => {
    if (!channelsQuery.isSuccess) {
      toast.error(t("slackSetup.channelsUnavailable"));
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await postApiV1ChannelsSlackConnect({
        body: {
          botToken: botToken.trim(),
          signingSecret: signingSecret.trim(),
          botId,
        },
      });
      if (error) {
        track("workspace_channel_config_submit", {
          channel: "slack",
          success: false,
        });
        toast.error(error.message ?? t("slackSetup.connectFailed"));
        return;
      }
      track("workspace_channel_config_submit", {
        channel: "slack",
        success: true,
      });
      toast.success(
        t("slackSetup.connectSuccess", { teamName: data?.teamName ?? "" }),
      );
      track("channel_ready", { channel: "slack", channel_type: "slack_token" });
      identify({ channels_connected: 1 });
      onConnected();
    } catch {
      track("workspace_channel_config_submit", {
        channel: "slack",
        success: false,
      });
      toast.error(t("slackSetup.connectFailed"));
    } finally {
      setConnecting(false);
    }
  };

  const wrapperClass = variant === "modal" ? "" : "";
  const manualWrapperClass = variant === "modal" ? "" : "";

  // Phase 1: Install (OAuth-first)
  if (phase === "install") {
    return (
      <div className={wrapperClass}>
        <div className="p-6 sm:p-8 rounded-xl border bg-surface-1 border-border text-center">
          <div className="flex justify-center items-center w-12 h-12 rounded-xl bg-[#4A154B]/10 mx-auto mb-5">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="#4A154B"
              role="img"
              aria-label="Slack logo"
            >
              <title>Slack logo</title>
              <path d={SLACK_LOGO_PATH} />
            </svg>
          </div>
          <h3 className="text-[15px] font-semibold text-text-primary mb-1">
            {t("slackSetup.addNexuTitle")}
          </h3>
          <p className="text-[12px] text-text-muted mb-6 leading-relaxed max-w-[300px] mx-auto">
            {t("slackSetup.addNexuDesc")}
          </p>
          <button
            type="button"
            onClick={handleAddToSlack}
            disabled={disabled}
            className={`flex gap-2 items-center justify-center mx-auto px-6 py-3 text-[13px] font-medium text-white rounded-lg bg-[#4A154B] transition-all ${disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-[#3a1039] cursor-pointer"}`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="white"
              aria-hidden="true"
            >
              <path d={SLACK_LOGO_PATH} />
            </svg>
            {t("slackSetup.addToSlack")}
          </button>
          <button
            type="button"
            onClick={() => setPhase("manual")}
            className="mt-4 text-[12px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          >
            {t("slackSetup.orConnectManually")}
          </button>
        </div>
      </div>
    );
  }

  // Phase 2: Authorizing (brief flash before redirect)
  if (phase === "authorizing") {
    return (
      <div className={wrapperClass}>
        <div className="p-6 sm:p-8 rounded-xl border bg-surface-1 border-border text-center">
          <div className="flex justify-center items-center w-12 h-12 rounded-xl bg-[#4A154B]/10 mx-auto mb-5">
            <div className="w-5 h-5 border-2 border-[#4A154B]/30 border-t-[#4A154B] rounded-full animate-spin" />
          </div>
          <h3 className="text-[15px] font-semibold text-text-primary mb-1">
            {t("slackSetup.authorizing")}
          </h3>
          <p className="text-[12px] text-text-muted leading-relaxed">
            {t("slackSetup.connectingWorkspace")}
          </p>
        </div>
      </div>
    );
  }

  // Phase 3: Manual fallback flow
  return (
    <div className={manualWrapperClass}>
      {/* Error / info banner */}
      <div
        className={`flex gap-3 items-start p-4 rounded-xl border mb-5 ${
          oauthFailed
            ? "bg-red-500/5 border-red-500/15"
            : "bg-amber-500/5 border-amber-500/15"
        }`}
      >
        <AlertCircle
          size={16}
          className={`mt-0.5 shrink-0 ${oauthFailed ? "text-red-500" : "text-amber-500"}`}
        />
        <div>
          <div className="text-[13px] font-medium text-text-primary">
            {oauthFailed
              ? t("slackSetup.oauthFailed")
              : t("slackSetup.manualConnection")}
          </div>
          <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">
            {oauthFailed
              ? oauthErrorMsg || t("slackSetup.oauthNotCompleted")
              : t("slackSetup.manualDesc")}
            {manualOnly ? null : <> {t("slackSetup.tryOauthSuffix")}</>}
          </p>
          {manualOnly ? null : (
            <button
              type="button"
              onClick={() => {
                setOauthFailed(false);
                setOauthErrorMsg("");
                setPhase("install");
              }}
              className="mt-2 text-[12px] font-medium text-[#4A154B] hover:underline underline-offset-2 cursor-pointer"
            >
              {t("slackSetup.tryOauthAgain")}
            </button>
          )}
        </div>
      </div>

      {/* Step indicator */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
        {SLACK_MANUAL_STEP_KEYS.map((key, i) => (
          <button
            type="button"
            key={key}
            onClick={() => setActiveStep(i)}
            className="text-left cursor-pointer"
          >
            <div
              className={`h-1 rounded-full transition-all ${
                i <= activeStep ? "bg-[#4A154B]" : "bg-border"
              }`}
            />
            <div
              className={`text-[11px] font-semibold mt-2 transition-all ${
                i === activeStep
                  ? "text-[#4A154B]"
                  : i < activeStep
                    ? "text-text-secondary"
                    : "text-text-muted/50"
              }`}
            >
              {t("slackSetup.step", { number: i + 1 })}
            </div>
            <div
              className={`text-[10px] mt-0.5 leading-tight transition-all ${
                i === activeStep ? "text-text-secondary" : "text-text-muted/40"
              }`}
            >
              {t(key)}
            </div>
          </button>
        ))}
      </div>

      {channelsQuery.isError && (
        <div
          data-slack-channels-unavailable="true"
          className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2.5"
        >
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-text-secondary">
            <AlertCircle className="size-3.5 shrink-0 text-red-500" />
            <span>{t("slackSetup.channelsUnavailable")}</span>
          </div>
          <button
            type="button"
            onClick={() => channelsQuery.refetch()}
            disabled={channelsQuery.isFetching}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#4A154B] hover:bg-[#4A154B]/5 disabled:opacity-50"
          >
            <RefreshCw
              className={`size-3 ${channelsQuery.isFetching ? "animate-spin" : ""}`}
            />
            {t("slackSetup.retryChannels")}
          </button>
        </div>
      )}

      {/* Step 1: Create Slack App */}
      {activeStep === 0 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#4A154B]/10 text-[12px] font-bold text-[#4A154B] shrink-0">
              1
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("slackSetup.createAppTitle")}
              </h3>
              <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">
                {t("slackSetup.createAppDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11">
            {redirectUriQuery.isPending && (
              <div
                data-slack-redirect-loading="true"
                className="flex items-center gap-2 text-[12px] text-text-muted"
              >
                <Loader2 className="size-3.5 animate-spin" />
                {t("slackSetup.redirectUriLoading")}
              </div>
            )}
            {redirectUriQuery.isError && (
              <div
                data-slack-redirect-unavailable="true"
                className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary"
              >
                <AlertCircle className="size-3.5 shrink-0 text-red-500" />
                <span>{t("slackSetup.redirectUriUnavailable")}</span>
                <button
                  type="button"
                  onClick={() => redirectUriQuery.refetch()}
                  disabled={redirectUriQuery.isFetching}
                  className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[#4A154B] hover:bg-[#4A154B]/5 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`size-3 ${redirectUriQuery.isFetching ? "animate-spin" : ""}`}
                  />
                  {t("slackSetup.retryRedirectUri")}
                </button>
              </div>
            )}
            {redirectUriQuery.isSuccess && (
              <a
                href={buildSlackManifestUrl(redirectUriQuery.data)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-[#4A154B] hover:bg-[#3a1039] transition-all"
              >
                <ExternalLink size={12} />
                {t("slackSetup.createSlackApp")}
              </a>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Signing Secret */}
      {activeStep === 1 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#4A154B]/10 text-[12px] font-bold text-[#4A154B] shrink-0">
              2
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("slackSetup.signingSecretTitle")}
              </h3>
              <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">
                {t("slackSetup.signingSecretDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-4">
            <div className="space-y-2.5 mb-2">
              {[
                <span key="1">
                  Go to{" "}
                  <strong className="text-text-primary">
                    Basic Information
                  </strong>
                </span>,
                <span key="2">
                  Scroll to{" "}
                  <strong className="text-text-primary">App Credentials</strong>
                </span>,
                <span key="3">
                  Copy the{" "}
                  <strong className="text-text-primary">Signing Secret</strong>{" "}
                  and paste it below
                </span>,
              ].map((item, idx) => (
                <div key={item.key} className="flex gap-2.5 items-start">
                  <div className="flex justify-center items-center w-5 h-5 rounded-full bg-surface-3 text-[9px] font-bold text-text-muted shrink-0 mt-0.5">
                    {idx + 1}
                  </div>
                  <span className="text-[12px] text-text-secondary leading-relaxed">
                    {item}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-baseline gap-1.5 mb-1.5">
                <label
                  htmlFor="slack-signing-secret"
                  className="text-[12px] text-text-primary font-medium"
                >
                  {t("slackSetup.signingSecretLabel")}
                </label>
              </div>
              <div className="relative">
                <Input
                  id="slack-signing-secret"
                  type="password"
                  placeholder="a1bc2d3e4f5..."
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  className="text-[13px] font-mono pr-9"
                />
                <Lock
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted/40"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Install & Get Bot Token */}
      {activeStep === 2 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#4A154B]/10 text-[12px] font-bold text-[#4A154B] shrink-0">
              3
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("slackSetup.botTokenTitle")}
              </h3>
              <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">
                {t("slackSetup.botTokenDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-4">
            <div className="space-y-2.5 mb-2">
              {[
                <span key="1">
                  In the sidebar, go to{" "}
                  <strong className="text-text-primary">Install App</strong>
                </span>,
                <span key="2">
                  Click{" "}
                  <strong className="text-text-primary">
                    Install to Workspace
                  </strong>{" "}
                  and authorize
                </span>,
                <span key="3">
                  Copy the{" "}
                  <strong className="text-text-primary">
                    Bot User OAuth Token
                  </strong>{" "}
                  that appears and paste it below
                </span>,
              ].map((item, idx) => (
                <div key={item.key} className="flex gap-2.5 items-start">
                  <div className="flex justify-center items-center w-5 h-5 rounded-full bg-surface-3 text-[9px] font-bold text-text-muted shrink-0 mt-0.5">
                    {idx + 1}
                  </div>
                  <span className="text-[12px] text-text-secondary leading-relaxed">
                    {item}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-baseline gap-1.5 mb-1.5">
                <label
                  htmlFor="slack-bot-token"
                  className="text-[12px] text-text-primary font-medium"
                >
                  {t("slackSetup.botTokenLabel")}
                </label>
              </div>
              <div className="relative">
                <Input
                  id="slack-bot-token"
                  type="password"
                  placeholder="xoxb-..."
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  className="text-[13px] font-mono pr-9"
                />
                <Lock
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted/40"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Enable DMs */}
      {activeStep === 3 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#4A154B]/10 text-[12px] font-bold text-[#4A154B] shrink-0">
              4
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("slackSetup.enableDMsTitle")}
              </h3>
              <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">
                {t("slackSetup.enableDMsDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-4">
            <div className="space-y-2.5 mb-2">
              {[
                <span key="1">
                  In the sidebar, go to{" "}
                  <strong className="text-text-primary">App Home</strong>
                </span>,
                <span key="2">
                  Scroll down to{" "}
                  <strong className="text-text-primary">Show Tabs</strong>
                </span>,
                <span key="3">
                  Check{" "}
                  <strong className="text-text-primary">
                    Allow users to send Slash commands and messages from the
                    messages tab
                  </strong>
                </span>,
              ].map((item, idx) => (
                <div key={item.key} className="flex gap-2.5 items-start">
                  <div className="flex justify-center items-center w-5 h-5 rounded-full bg-surface-3 text-[9px] font-bold text-text-muted shrink-0 mt-0.5">
                    {idx + 1}
                  </div>
                  <span className="text-[12px] text-text-secondary leading-relaxed">
                    {item}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2.5 items-start p-3 rounded-lg bg-[#4A154B]/5 border border-[#4A154B]/10">
              <MessageSquare
                size={14}
                className="text-[#4A154B] shrink-0 mt-0.5"
              />
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {t("slackSetup.dmWarning")}
              </p>
            </div>
            <div className="mb-4">
              <BotPicker
                value={botId || null}
                onChange={setBotId}
                required
                disabled={channelOperationsDisabled}
                disabledBotIds={disabledBotIds}
              />
            </div>
            <button
              type="button"
              onClick={handleManualConnect}
              disabled={
                disabled ||
                connecting ||
                !channelsQuery.isSuccess ||
                !botToken.trim() ||
                !signingSecret.trim() ||
                !botId
              }
              data-slack-channel-operations-disabled={
                !channelsQuery.isSuccess ? "true" : "false"
              }
              className="flex gap-1.5 items-center px-5 py-2.5 text-[13px] font-medium text-white rounded-lg bg-[#4A154B] hover:bg-[#3a1039] transition-all disabled:opacity-60 cursor-pointer"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {t("slackSetup.connect")}
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center mt-5">
        {manualOnly && activeStep === 0 ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={() =>
              activeStep === 0
                ? setPhase("install")
                : setActiveStep(activeStep - 1)
            }
            className="flex gap-1.5 items-center text-[12px] text-text-muted hover:text-text-secondary transition-all cursor-pointer"
          >
            <ArrowLeft size={13} />
            {activeStep === 0 ? t("slackSetup.back") : t("slackSetup.previous")}
          </button>
        )}
        {activeStep < SLACK_MANUAL_STEP_KEYS.length - 1 && (
          <button
            type="button"
            onClick={() => setActiveStep(activeStep + 1)}
            className="flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-[#4A154B] hover:bg-[#3a1039] transition-all cursor-pointer"
          >
            {t("slackSetup.next")}
            <ChevronRight size={13} />
          </button>
        )}
      </div>

      {/* Help link */}
      <div className="flex gap-3 items-center p-4 mt-5 rounded-xl border bg-surface-1 border-border">
        <BookOpen size={14} className="text-[#4A154B] shrink-0" />
        <p className="text-[11px] text-text-muted leading-relaxed">
          {t("slackSetup.helpText")}{" "}
          <a
            href="https://api.slack.com/authentication/basics"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#4A154B] hover:underline underline-offset-2 font-medium"
          >
            {t("slackSetup.helpLinkText")}
          </a>{" "}
          {t("slackSetup.helpSuffix")}
        </p>
      </div>
    </div>
  );
}
