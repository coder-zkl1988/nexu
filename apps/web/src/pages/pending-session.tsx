import { type BotItem, ChatInputArea } from "@/components/chat-input-area";
import { createLocalStreamSSEClient } from "@/lib/api/event-source";
import {
  getPendingSessionBotName,
  getPendingSessionText,
  parsePendingSessionParams,
} from "@/lib/local-chat-pending";
import { waitForLocalChatSession } from "@/lib/local-chat-session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getApiV1Bots, getApiV1ChatSession } from "../../lib/api/sdk.gen";

const BOT_AVATAR = "/images/claw-avatar.png";
const USER_AVATAR = "/images/tabby-avatar.png";
const DESKPET_REPLYING_DURATION_MS = 8000;
const DESKPET_SUCCESS_DURATION_MS = 5000;

function invokeDesktopHost(channel: string, payload: unknown): void {
  if (typeof window === "undefined") {
    return;
  }

  const candidate = (window as Window & { nexuHost?: unknown }).nexuHost;
  if (!candidate || typeof candidate !== "object") {
    return;
  }

  const invoke = Reflect.get(candidate as Record<string, unknown>, "invoke");
  if (typeof invoke !== "function") {
    return;
  }

  void (invoke as (channel: string, payload: unknown) => Promise<unknown>).call(
    candidate,
    channel,
    payload,
  );
}

type PendingStatus = "starting" | "streaming" | "error";

export function PendingSessionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const params = useMemo(
    () => parsePendingSessionParams(searchParams),
    [searchParams],
  );
  const pendingText = getPendingSessionText(location.state);
  const pendingBotName = getPendingSessionBotName(location.state);
  const [streamingText, setStreamingText] = useState("");
  const [status, setStatus] = useState<PendingStatus>("starting");
  const resolvedRef = useRef(false);
  const latestStreamingTextRef = useRef("");

  const { data: botsData } = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const { data } = await getApiV1Bots();
      return data;
    },
  });
  const bots = (botsData?.bots ?? []) as BotItem[];
  const selectedBot =
    params?.botId != null
      ? (bots.find((bot) => bot.id === params.botId) ?? null)
      : null;
  const botName =
    selectedBot?.name ?? pendingBotName ?? t("localChat.selectBot");

  const navigateToSession = useCallback(
    (sessionId: string) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      void queryClient.invalidateQueries({ queryKey: ["sidebar-sessions"] });
      navigate(`/workspace/sessions/${sessionId}`, {
        replace: true,
        state: params
          ? {
              deskpetPendingReplyText: latestStreamingTextRef.current,
              deskpetPendingRunId: params.runId,
              deskpetPendingSessionKey: params.sessionKey,
            }
          : undefined,
      });
    },
    [navigate, params, queryClient],
  );

  const resolveSessionOnce = useCallback(async () => {
    if (!params || resolvedRef.current) return false;
    const { data } = await getApiV1ChatSession({
      query: {
        botId: params.botId,
        sessionKey: params.sessionKey,
      },
    });
    const session = data?.session ?? null;
    if (!session?.id) return false;
    navigateToSession(session.id);
    return true;
  }, [params, navigateToSession]);

  useEffect(() => {
    if (params) return;
    navigate("/workspace/chat", { replace: true });
  }, [params, navigate]);

  useEffect(() => {
    if (!params) return;

    let cancelled = false;
    resolvedRef.current = false;
    setStatus("starting");
    setStreamingText("");
    latestStreamingTextRef.current = "";
    invokeDesktopHost("desktop:deskpet-activity", {
      mood: "lobster-replying",
      durationMs: DESKPET_REPLYING_DURATION_MS,
    });

    void waitForLocalChatSession({
      botId: params.botId,
      sessionKey: params.sessionKey,
      lookupSession: getApiV1ChatSession,
      maxAttempts: 120,
      intervalMs: 500,
      shouldContinue: () => !cancelled && !resolvedRef.current,
    })
      .then((session) => {
        if (cancelled || !session?.id) {
          if (!cancelled && !resolvedRef.current) {
            setStatus("error");
          }
          return;
        }
        navigateToSession(session.id);
      })
      .catch(() => {
        if (!cancelled && !resolvedRef.current) {
          setStatus("error");
        }
      });

    const client = createLocalStreamSSEClient({
      botId: params.botId,
      sessionKey: params.sessionKey,
      runId: params.runId,
      onDelta: (delta) => {
        setStatus("streaming");
        setStreamingText((prev) => {
          const next = delta.replace ? delta.deltaText : prev + delta.deltaText;
          latestStreamingTextRef.current = next.trim().slice(0, 280);
          return next;
        });
        invokeDesktopHost("desktop:deskpet-activity", {
          mood: "lobster-replying",
          durationMs: DESKPET_REPLYING_DURATION_MS,
        });
      },
      onFinal: () => {
        invokeDesktopHost("desktop:deskpet-activity", {
          mood: "success",
          durationMs: DESKPET_SUCCESS_DURATION_MS,
          replyText: latestStreamingTextRef.current,
        });
        void resolveSessionOnce();
      },
      onAborted: () => {
        setStatus("error");
      },
      onError: () => {
        setStatus("error");
      },
    });
    client.connect();

    return () => {
      cancelled = true;
      client.disconnect();
    };
  }, [params, navigateToSession, resolveSessionOnce]);

  if (!params) {
    return null;
  }

  const statusText =
    status === "error"
      ? t("sessions.pending.error")
      : streamingText
        ? t("sessions.pending.streaming", { name: botName })
        : t("sessions.pending.waiting", { name: botName });

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-6 py-2 md:pt-7">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface-1">
              <Loader2 className="size-[16px] animate-spin text-text-muted" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-bold text-text-heading">
                {t("sessions.pending.title")}
              </h1>
              <div className="mt-0.5 text-[11px] text-text-muted">
                Web · {t("sessions.chat.messages", { count: 1 })} · {statusText}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          data-chat-layout="centered"
          data-pending-session={params.sessionKey}
          className="mx-auto flex w-full max-w-[800px] flex-col gap-5 px-4 pt-12 pb-8 sm:px-6"
        >
          {pendingText && (
            <div data-chat-role="user" className="flex items-start gap-3">
              <img
                src={USER_AVATAR}
                alt=""
                className="-ml-1 mt-0 h-9 w-9 shrink-0 object-contain"
              />
              <div className="flex max-w-[44rem] flex-col items-start gap-2">
                <div className="inline-block max-w-full rounded-[20px] bg-surface-3 px-4 py-3 text-[13px] text-text-primary break-words shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                  <p className="whitespace-pre-wrap break-words">
                    {pendingText}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div data-chat-role="assistant" className="flex items-start gap-3">
            <img
              src={BOT_AVATAR}
              alt=""
              className="-ml-1 mt-0 h-9 w-9 shrink-0 object-contain"
            />
            <div className="flex max-w-[44rem] flex-col items-start gap-2">
              <div className="inline-flex max-w-full items-center gap-1.5 rounded-[20px] border border-border bg-surface-1 px-4 py-3 text-[13px] text-text-primary break-words shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                {streamingText ? (
                  <p className="whitespace-pre-wrap break-words text-text-secondary">
                    {streamingText}
                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-text-secondary align-text-bottom" />
                  </p>
                ) : (
                  <>
                    <Loader2
                      size={14}
                      className="animate-spin text-text-muted"
                    />
                    <span className="text-text-muted">{statusText}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 py-3">
        <div className="mx-auto w-full max-w-[800px]">
          <ChatInputArea
            bots={bots}
            selectedBot={selectedBot}
            onSelectBot={() => {}}
            onSend={() => {}}
            sending={false}
            waitingReply
            disabled
            placeholder={t("localChat.inputPlaceholder")}
            showBotSelector={false}
            modelReadOnly
          />
        </div>
      </div>
    </div>
  );
}
