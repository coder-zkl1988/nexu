import {
  type BotItem,
  ChatInputArea,
  type PendingAttachment,
} from "@/components/chat-input-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getApiV1Bots,
  getApiV1BotsDefault,
  postApiV1ChatLocalStart,
} from "../../lib/api/sdk.gen";
import { buildPendingSessionPath } from "../lib/local-chat-pending";

// Every local chat message targets the agent main webchat session.
function buildMainSessionKey(botId: string): string {
  return `agent:${botId}:main`;
}

export function LocalChatPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlBotId = searchParams.get("botId");

  const [selectedBot, setSelectedBot] = useState<BotItem | null>(null);
  const [waitingReply, setWaitingReply] = useState(false);

  const contextKeyRef = useRef<string>("");
  const urlBotResolvedRef = useRef(false);

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

  // Auto-select bot: prefer URL botId, then first active bot
  useEffect(() => {
    if (activeBots.length === 0 || selectedBot) return;

    // Resolve URL botId once
    if (urlBotId && !urlBotResolvedRef.current) {
      const target = activeBots.find((b) => b.id === urlBotId);
      if (target) {
        urlBotResolvedRef.current = true;
        setSelectedBot(target);
        return;
      }
    }

    // Fall back to first active bot
    if (activeBots[0]) {
      setSelectedBot(activeBots[0]);
    }
  }, [activeBots, selectedBot, urlBotId]);

  // Bot selection
  const handleSelectBot = useCallback((bot: BotItem) => {
    setSelectedBot(bot);
  }, []);

  // Send message, then leave the new-conversation page as soon as OpenClaw
  // acknowledges chat.send. PendingSessionPage resolves the real session later.
  const sendMessage = useCallback(
    async (
      text: string,
      atts: PendingAttachment[],
      skillSlug: string | null,
    ) => {
      if (!selectedBot) return;

      const botId = selectedBot.id;
      const ctxKey = botId;
      contextKeyRef.current = ctxKey;
      const mainSessionKey = buildMainSessionKey(botId);

      try {
        setWaitingReply(true);

        const onlyImage = atts.length === 1 ? atts[0] : undefined;
        const isImageOnly = onlyImage?.type === "image" && !text.trim();
        const msgContent =
          isImageOnly && onlyImage
            ? {
                type: "image" as const,
                content: onlyImage.content,
                metadata: { mimeType: onlyImage.mimeType },
              }
            : {
                type: "text" as const,
                content: text,
                ...(skillSlug ? { skillSlug } : {}),
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

        const { data: responseData } = await postApiV1ChatLocalStart({
          body: {
            botId,
            sessionKey: mainSessionKey,
            message: msgContent,
          },
        });

        if (contextKeyRef.current !== ctxKey) {
          setWaitingReply(false);
          return;
        }

        const session = responseData?.session ?? null;
        if (session?.id) {
          navigate(`/workspace/sessions/${session.id}`);
          return;
        }

        const runId =
          typeof responseData?.message?.runId === "string"
            ? responseData.message.runId
            : undefined;
        const pendingText = text.trim()
          ? text
          : isImageOnly
            ? "[Image]"
            : atts.length > 0
              ? "[File]"
              : "";
        navigate(
          buildPendingSessionPath({
            botId,
            sessionKey: responseData?.sessionKey ?? mainSessionKey,
            runId,
          }),
          {
            state: { pendingText, pendingBotName: selectedBot.name },
          },
        );
      } catch {
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
                sending={false}
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
