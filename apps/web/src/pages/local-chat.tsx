import {
  type BotItem,
  ChatInputArea,
  type PendingAttachment,
} from "@/components/chat-input-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getApiV1Bots, getApiV1BotsDefault } from "../../lib/api/sdk.gen";

// Every local chat message targets the agent main webchat session.
function buildMainSessionKey(botId: string): string {
  return `agent:${botId}:main`;
}

const SESSION_DISCOVERY_MAX_ATTEMPTS = 30;
const SESSION_DISCOVERY_INTERVAL_MS = 100;

export function LocalChatPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [selectedBot, setSelectedBot] = useState<BotItem | null>(null);
  const [sending, setSending] = useState(false);
  const [waitingReply, setWaitingReply] = useState(false);

  const contextKeyRef = useRef<string>("");

  // Fetch bots
  const { data: botsData, isLoading: botsLoading } = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const { data } = await getApiV1Bots();
      return data;
    },
  });
  const bots = (botsData?.bots ?? []) as BotItem[];
  const activeBots = bots.filter((b) => b.status === "active");

  // Auto-create a default bot when none exist
  const createDefaultBot = useMutation({
    mutationFn: async () => {
      const { data } = await getApiV1BotsDefault();
      return data;
    },
    onSuccess: (newBot) => {
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      setSelectedBot(newBot as BotItem);
    },
  });

  const noActiveBots = activeBots.length === 0;
  const isCreatingBot = botsLoading || createDefaultBot.isPending;
  const createError = createDefaultBot.error;

  // Automatically create a default bot when none exist
  useEffect(() => {
    if (
      noActiveBots &&
      !botsLoading &&
      !createDefaultBot.isPending &&
      !createError
    ) {
      createDefaultBot.mutate();
    }
  }, [noActiveBots, botsLoading, createDefaultBot, createError]);

  // Auto-select the first active bot
  useEffect(() => {
    if (activeBots.length > 0 && !selectedBot && activeBots[0]) {
      setSelectedBot(activeBots[0]);
    }
  }, [activeBots, selectedBot]);

  // Bot selection
  const handleSelectBot = useCallback((bot: BotItem) => {
    setSelectedBot(bot);
  }, []);

  // Send message -- fires API, discovers session, and navigates
  const sendMessage = useCallback(
    async (text: string, atts: PendingAttachment[]) => {
      if (!selectedBot) return;

      const botId = selectedBot.id;
      const ctxKey = botId;
      contextKeyRef.current = ctxKey;
      const mainSessionKey = buildMainSessionKey(botId);

      setSending(true);

      try {
        const onlyImage = atts[0];
        const isImageOnly =
          atts.length === 1 && onlyImage?.type === "image" && !text.trim();
        const msgContent = isImageOnly
          ? {
              type: "image" as const,
              content: onlyImage!.content,
              metadata: { mimeType: onlyImage!.mimeType },
            }
          : {
              type: "text" as const,
              content: text,
              attachments:
                atts.length > 0
                  ? atts.map((a) => ({
                      type: a.type,
                      content: a.content,
                      metadata: {
                        mimeType: a.mimeType,
                        filename: a.filename,
                        size: a.size,
                      },
                    }))
                  : undefined,
            };

        const rawRes = await fetch("/api/v1/chat/local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            botId,
            sessionKey: mainSessionKey,
            message: msgContent,
          }),
        });
        const responseData = (await rawRes.json()) as Record<string, unknown>;

        setSending(false);
        setWaitingReply(true);

        if (contextKeyRef.current !== ctxKey) return;

        const sessionObj = responseData?.session as
          | { id?: string }
          | null
          | undefined;
        if (sessionObj?.id) {
          const target = `/workspace/sessions/${sessionObj.id}`;
          navigate(target);
          setTimeout(() => {
            window.location.href = target;
          }, 200);
          return;
        }

        let sid: string | null = null;
        for (
          let attempt = 0;
          attempt < SESSION_DISCOVERY_MAX_ATTEMPTS;
          attempt++
        ) {
          if (attempt > 0) {
            await new Promise((r) =>
              setTimeout(r, SESSION_DISCOVERY_INTERVAL_MS),
            );
          }
          if (contextKeyRef.current !== ctxKey) return;
          try {
            const sessionRes = await fetch(
              `/api/v1/chat/session?botId=${encodeURIComponent(botId)}&sessionKey=${encodeURIComponent(mainSessionKey)}`,
            );
            const sessionData = (await sessionRes.json()) as Record<
              string,
              unknown
            >;
            const found = (sessionData?.session as { id?: string } | null)?.id;
            if (found) {
              sid = found;
              break;
            }
          } catch {
            // retry
          }
        }

        if (sid) {
          const target = `/workspace/sessions/${sid}`;
          navigate(target);
          // Fallback: direct location change if React Router navigation fails
          setTimeout(() => {
            window.location.href = target;
          }, 200);
        } else {
          setWaitingReply(false);
        }
      } catch {
        setSending(false);
        setWaitingReply(false);
      }
    },
    [selectedBot, navigate],
  );

  const placeholder = createError
    ? t("localChat.createDefaultBotError")
    : isCreatingBot
      ? t("localChat.creatingDefaultBot")
      : !selectedBot
        ? t("localChat.selectBotFirst")
        : waitingReply
          ? t("localChat.waiting")
          : t("localChat.inputPlaceholder");

  return (
    <div className="h-full overflow-hidden">
      <main className="h-full w-full overflow-hidden relative flex flex-col">
        <div className="flex-1 overflow-y-auto overflow-x-hidden h-full">
          <div className="flex flex-col items-center justify-center min-h-full px-4 py-6 md:py-10">
            <div className="mb-5 md:mb-6 relative w-[144px] h-[144px] md:w-[176px] md:h-[176px]">
              <img
                src="/images/tabby-mascot.png"
                alt="Tabby mascot"
                className="w-full h-full object-contain transition-opacity duration-300 hover:opacity-0"
              />
              <img
                src="/images/tabby-mascot-colorful.png"
                alt="Tabby mascot colorful"
                className="absolute inset-0 w-full h-full object-contain opacity-0 transition-opacity duration-300 hover:opacity-100"
              />
            </div>
            <h2
              className="text-[26px] font-normal tracking-tight text-[var(--color-tabby-foreground)] mb-6 md:mb-8"
              style={{ fontFamily: "var(--font-script)" }}
            >
              Happy Tabby
            </h2>
            <div className="w-full max-w-xl md:max-w-2xl">
              <ChatInputArea
                bots={bots}
                selectedBot={selectedBot}
                onSelectBot={handleSelectBot}
                onSend={sendMessage}
                sending={sending}
                waitingReply={waitingReply}
                disabled={!selectedBot || isCreatingBot}
                placeholder={placeholder}
                showAddBot
                modelReadOnly
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
