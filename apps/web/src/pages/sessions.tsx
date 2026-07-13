import {
  type BotItem,
  ChatInputArea,
  type PendingAttachment,
} from "@/components/chat-input-area";
import { PlatformIcon } from "@/components/platform-icons";
import { ChatMarkdown } from "@/components/ui/chat-markdown";
import { A2UIRenderer } from "@/lib/a2ui";
import type { A2UIMessage } from "@/lib/a2ui";
import { useA2UISidebar } from "@/lib/a2ui/a2ui-sidebar-context";
import { createLocalStreamSSEClient } from "@/lib/api/event-source";
import {
  type CanvasOpBatchView,
  CanvasOpCard,
} from "@/lib/canvas/canvas-op-card";
import { bindSessionToBoard } from "@/lib/canvas/canvas-session-binding";
import { setPanelOpen, useCanvas } from "@/lib/canvas/canvas-store";
import { getChannelChatUrl } from "@/lib/channel-links";
import {
  A2UI_TOOL_NAMES,
  CANVAS_OP_TOOL_NAMES,
  type ExtractedMessage,
  type FileCardInfo,
  type ImageBlockInfo,
  type SidebarA2UIPayload,
  extractMessage,
  stripMediaMarkerLines,
} from "@/lib/chat/chat-message-extract";
import { normalizeChannel, track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  FileImage,
  FileText,
  Loader2,
  MessageSquare,
  PanelRight,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  getApiV1Bots,
  getApiV1BotsByBotId,
  getApiV1Channels,
  getApiV1SessionsById,
  getApiV1SessionsByIdMessages,
  postApiV1ChatCancel,
  postApiV1ChatLocal,
  postApiV1SessionsByIdReset,
} from "../../lib/api/sdk.gen";

const BOT_AVATAR = "/images/claw-avatar.png";
const USER_AVATAR = "/images/tabby-avatar.png";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Complex editor components — their surfaces always open in the side panel. */
const SIDEBAR_DOC_COMPONENT_TYPES = new Set(["MarkdownEditor", "XHSEditor"]);

/**
 * Decide where an A2UI surface renders.
 *
 * Side panel: only complex-interaction editor surfaces (MarkdownEditor /
 * XHSEditor).  Everything else — forms, images, video/audio, status cards —
 * renders inline in the conversation flow.  A `sidebar:` surfaceId prefix
 * remains an explicit override for "show this in the side panel".
 */
function isSidebarBoundSurface(
  surfaceId: string,
  msgs: A2UIMessage[],
): boolean {
  if (surfaceId.startsWith("sidebar:")) return true;
  for (const m of msgs) {
    if (!("updateComponents" in m)) continue;
    for (const comp of m.updateComponents?.components ?? []) {
      const type = (comp as { type?: string }).type ?? "";
      if (SIDEBAR_DOC_COMPONENT_TYPES.has(type)) return true;
    }
  }
  return false;
}

/** True when the server history already contains this optimistic message. */
function isPendingMessageOnServer(
  pm: { text: string; timestamp: number; attachments: unknown[] },
  serverUserTexts: Set<string>,
  serverMediaOnlyTimes: number[],
): boolean {
  if (pm.text.trim().length > 0) {
    return serverUserTexts.has(pm.text);
  }
  if (pm.attachments.length === 0) return false;
  // Media-only: match a captionless server upload that arrived at or after
  // this send (60s skew tolerance for client/server clocks).
  return serverMediaOnlyTimes.some((t) => t >= pm.timestamp - 60_000);
}

/** Friendly label for a known A2UI action chip. */
function a2uiActionLabel(actionName: string): string {
  switch (actionName) {
    case "xhs_editor_publish":
      return "已提交小红书发布";
    case "skill_confirmation":
      return "已确认操作";
    case "install_expert":
      return "已确认安装专家";
    case "install_expert_cancel":
      return "已取消安装";
    default:
      return "已提交操作";
  }
}

/** Millisecond timestamp -> HH:mm */
function formatTs(ts?: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Format relative time from ISO string */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function formatToolCallSummary(summary: string | null): string | null {
  if (!summary) return null;

  const uppercaseTokens = new Set([
    "api",
    "ci",
    "csv",
    "db",
    "gh",
    "pdf",
    "qa",
    "sql",
    "ui",
    "ux",
  ]);

  const formatted = summary
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((token) => {
      const normalized = token.trim();
      if (normalized.length === 0) return "";
      if (/^[A-Z0-9]+$/.test(normalized)) return normalized;
      if (uppercaseTokens.has(normalized.toLowerCase())) {
        return normalized.toUpperCase();
      }
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ")
    .trim();

  if (formatted.length === 0 || formatted.toLowerCase() === "tool") {
    return null;
  }

  return formatted;
}

type Platform =
  | "slack"
  | "discord"
  | "whatsapp"
  | "telegram"
  | "web"
  | "feishu"
  | "dingtalk"
  | "wechat"
  | "wecom"
  | "qqbot";

interface PlatformConfig {
  badgeClass: string;
  label: string;
  openLabel: string;
}

const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  badgeClass:
    "border-[rgba(107,114,128,0.14)] bg-[rgba(107,114,128,0.08)] text-[#6B7280]",
  label: "Web",
  openLabel: "channels.open",
};

const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  slack: {
    badgeClass:
      "border-[rgba(224,30,90,0.12)] bg-[rgba(224,30,90,0.06)] text-[#E01E5A]",
    label: "Slack",
    openLabel: "channels.openInSlack",
  },
  discord: {
    badgeClass:
      "border-[rgba(88,101,242,0.14)] bg-[rgba(88,101,242,0.08)] text-[#5865F2]",
    label: "Discord",
    openLabel: "channels.openInDiscord",
  },
  whatsapp: {
    badgeClass:
      "border-[rgba(37,211,102,0.14)] bg-[rgba(37,211,102,0.08)] text-[#25D366]",
    label: "WhatsApp",
    openLabel: "channels.openInWhatsApp",
  },
  telegram: {
    badgeClass:
      "border-[rgba(36,161,222,0.14)] bg-[rgba(36,161,222,0.08)] text-[#24A1DE]",
    label: "Telegram",
    openLabel: "channels.openInTelegram",
  },
  feishu: {
    badgeClass:
      "border-[rgba(51,112,255,0.14)] bg-[rgba(51,112,255,0.08)] text-[#3370FF]",
    label: "Feishu",
    openLabel: "channels.openInFeishu",
  },
  dingtalk: {
    badgeClass:
      "border-[rgba(44,44,44,0.14)] bg-[rgba(44,44,44,0.08)] text-[#2C2C2C]",
    label: "DingTalk",
    openLabel: "channels.openInDingTalk",
  },
  wecom: {
    badgeClass:
      "border-[rgba(7,193,96,0.14)] bg-[rgba(7,193,96,0.08)] text-[#07C160]",
    label: "WeCom",
    openLabel: "channels.openInWeCom",
  },
  qqbot: {
    badgeClass:
      "border-[rgba(24,144,255,0.14)] bg-[rgba(24,144,255,0.08)] text-[#1890FF]",
    label: "QQ",
    openLabel: "channels.openInQQ",
  },
  wechat: {
    badgeClass:
      "border-[rgba(141,200,27,0.14)] bg-[rgba(141,200,27,0.08)] text-[#8DC81B]",
    label: "WeChat",
    openLabel: "channels.openInWeChat",
  },
  web: DEFAULT_PLATFORM_CONFIG,
};

function getPlatformConfig(platform: string): PlatformConfig {
  return PLATFORM_CONFIG[platform as Platform] ?? DEFAULT_PLATFORM_CONFIG;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-3">
          <MessageSquare className="h-8 w-8 text-text-muted" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-text-primary">
          {t("sessions.selectSession")}
        </h3>
        <p className="max-w-sm text-sm text-text-muted">
          {t("sessions.selectSessionDesc")}
        </p>
      </div>
    </div>
  );
}

function ChatEmpty() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center py-16">
        <div className="text-[13px] text-text-muted">
          {t("sessions.chat.empty")}
        </div>
      </div>
    </div>
  );
}

function ChatUnavailable() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-3">
          <WifiOff className="h-8 w-8 text-text-muted" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-text-primary">
          {t("sessions.chat.unavailable")}
        </h3>
        <p className="max-w-sm text-sm text-text-muted">
          {t("sessions.chat.unavailableDesc")}
        </p>
      </div>
    </div>
  );
}

interface ChatMessageData {
  id: string;
  role: "user" | "assistant" | "toolResult";
  content: unknown;
  timestamp: number | null;
  createdAt: string | null;
  toolName?: string;
  toolCallId?: string;
}

function ArtifactCard({ summary }: { summary: string | null }) {
  const { t } = useTranslation();
  const formattedSummary =
    formatToolCallSummary(summary) ?? t("sessions.chat.toolActivity");

  return (
    <div
      data-tool-card={summary ?? undefined}
      data-tool-card-variant="inline-chip"
      className="mt-0.5 inline-flex max-w-full items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--color-success)_12%,transparent)] bg-[rgba(0,163,101,0.06)] px-2.5 py-1.5 text-[12px] shadow-none"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-success-muted)] text-[var(--color-success)]">
        <CheckCircle2 className="size-[13px]" />
      </span>
      <span className="min-w-0 max-w-[16rem] truncate font-medium text-text-primary">
        {formattedSummary}
      </span>
      <span className="shrink-0 text-text-muted/70">·</span>
      <span className="shrink-0 text-[11px] font-medium text-[var(--color-success)]">
        {t("sessions.chat.toolCompleted")}
      </span>
    </div>
  );
}

function ReplyContextCard({ text, isBot }: { text: string; isBot: boolean }) {
  const { t } = useTranslation();

  return (
    <div
      data-reply-context={text}
      className={cn(
        "inline-flex max-w-full items-start gap-2 rounded-2xl border px-3 py-2 text-left shadow-[0_6px_18px_rgba(15,23,42,0.04)]",
        isBot
          ? "border-border bg-[rgba(248,250,252,0.95)] text-text-secondary"
          : "border-border/70 bg-white/80 text-text-secondary",
      )}
    >
      <span className="mt-0.5 h-8 w-1 shrink-0 rounded-full bg-[rgba(148,163,184,0.6)]" />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
          {t("sessions.chat.replyLabel")}
        </div>
        <div className="mt-1 max-w-[28rem] truncate text-[12px] leading-5">
          {text}
        </div>
      </div>
    </div>
  );
}

function SessionPlatformBadge({
  platform,
  className,
}: {
  platform: string;
  className?: string;
}) {
  const platformCfg = getPlatformConfig(platform);
  return (
    <span
      data-session-platform={platform}
      className={cn(
        "inline-flex items-center justify-center rounded-xl border shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
        platformCfg.badgeClass,
        className,
      )}
    >
      <PlatformIcon platform={platform} size={16} />
    </span>
  );
}

function InlineImage({ mimeType, data, url }: ImageBlockInfo) {
  const [expanded, setExpanded] = useState(false);
  const src = url ?? `data:${mimeType};base64,${data ?? ""}`;
  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block max-w-[240px] cursor-pointer rounded-xl overflow-hidden border border-border hover:opacity-90 transition-opacity"
      >
        <img
          src={src}
          alt=""
          className="w-full h-auto max-h-[200px] object-cover"
        />
      </button>
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setExpanded(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setExpanded(false);
          }}
        >
          <img
            src={src}
            alt=""
            className="max-w-full max-h-full rounded-xl object-contain"
          />
        </div>
      )}
    </>
  );
}

/** Chip rendered in place of sidebar-bound A2UI — click opens the side panel. */
function SidebarA2UIButton({
  payload,
  onOpen,
}: {
  payload: SidebarA2UIPayload;
  onOpen: (payload: SidebarA2UIPayload) => void;
}) {
  const { t } = useTranslation();
  // "sidebar:xhs-editor" -> "xhs editor"
  const surfaceLabel = payload.surfaceId
    .replace(/^sidebar:/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return (
    <button
      type="button"
      data-a2ui-sidebar-trigger={payload.surfaceId}
      onClick={() => onOpen(payload)}
      className="mt-0.5 inline-flex max-w-full items-center gap-2 rounded-2xl border border-border bg-surface-1 px-3.5 py-2.5 text-[13px] shadow-[0_6px_18px_rgba(15,23,42,0.05)] transition-colors hover:bg-surface-2"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-[var(--color-info-subtle)] text-[var(--color-info)]">
        <PanelRight className="size-[14px]" />
      </span>
      <span className="min-w-0 truncate font-medium text-text-primary">
        {surfaceLabel ||
          t("sessions.chat.interactivePanel", {
            defaultValue: "Interactive panel",
          })}
      </span>
      <span className="shrink-0 text-[11px] font-medium text-[var(--color-info)]">
        {t("sessions.chat.openPanel", { defaultValue: "Open" })}
      </span>
      <ArrowUpRight className="size-[14px] shrink-0 text-text-muted" />
    </button>
  );
}

function MessageFileCard({ name, mimeType, size }: FileCardInfo) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = mimeType.startsWith("image/");
  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-1 px-3 py-2 max-w-[240px]">
      <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-surface-2">
        {isImage ? (
          <FileImage size={14} className="text-purple-500" />
        ) : (
          <FileText size={14} className="text-text-muted" />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] text-text-primary truncate font-medium">
          {name}
        </div>
        <div className="text-[10px] text-text-muted">
          {ext.toUpperCase()}
          {size !== undefined && ` · ${formatBytes(size)}`}
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChatBubble({
  msg,
  extracted,
  onA2UIAction,
  onOpenSidebar,
  showAvatar = true,
}: {
  msg: ChatMessageData;
  extracted?: ExtractedMessage;
  onA2UIAction?: (actionName: string, context: Record<string, unknown>) => void;
  onOpenSidebar?: (payload: SidebarA2UIPayload) => void;
  /** False for consecutive same-sender messages — renders an alignment spacer instead. */
  showAvatar?: boolean;
}) {
  const resolvedExtracted =
    extracted ?? extractMessage(msg as unknown as Record<string, unknown>);
  const {
    text,
    replyContextText,
    // biome-ignore lint/correctness/noUnusedVariables: used in extractMessage return shape
    senderName,
    hasToolCall,
    toolCallSummary,
    hasA2UI,
    a2uiMessages,
    sidebarA2UI,
    a2uiAction,
    canvasOpBatch,
    images,
    fileCards,
  } = resolvedExtracted;
  const time = formatTs(msg.timestamp);
  const isBot = msg.role === "assistant";
  const hasText = text.trim().length > 0;
  const hasReplyContext = (replyContextText?.trim().length ?? 0) > 0;
  const hasMedia = images.length > 0 || fileCards.length > 0;

  return (
    <div
      data-chat-message={msg.id}
      data-chat-role={msg.role}
      className="flex gap-3 items-start"
    >
      {showAvatar ? (
        <img
          src={isBot ? BOT_AVATAR : USER_AVATAR}
          alt=""
          className="shrink-0 w-9 h-9 -ml-1 mt-0 object-contain"
        />
      ) : (
        <div aria-hidden className="shrink-0 w-9 h-9 -ml-1" />
      )}
      <div className={cn("flex max-w-[44rem] flex-col gap-2", "items-start")}>
        {hasReplyContext && replyContextText && (
          <ReplyContextCard text={replyContextText} isBot={isBot} />
        )}
        {hasMedia && (
          <div className="flex flex-col gap-1.5">
            {images.map((img, i) => (
              <InlineImage key={`img-${img.mimeType}-${i}`} {...img} />
            ))}
            {fileCards.map((fc, i) => (
              <MessageFileCard key={`fc-${fc.name}-${i}`} {...fc} />
            ))}
          </div>
        )}
        {a2uiAction && (
          <div className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--color-success)_12%,transparent)] bg-[rgba(0,163,101,0.06)] px-3 py-1.5 text-[12px]">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-success-muted)] text-[var(--color-success)]">
              <CheckCircle2 className="size-[13px]" />
            </span>
            <span className="font-medium text-text-primary">
              {a2uiActionLabel(a2uiAction.actionName)}
            </span>
          </div>
        )}
        {hasText && (
          <div
            className={cn(
              "inline-block max-w-full rounded-[20px] px-4 py-3 text-[13px] break-words shadow-[0_10px_24px_rgba(15,23,42,0.04)]",
              isBot
                ? "border border-border bg-surface-1 text-text-primary"
                : "bg-surface-3 text-text-primary",
            )}
          >
            <ChatMarkdown content={text} />
          </div>
        )}
        {isBot && hasToolCall && !sidebarA2UI && (
          <ArtifactCard summary={toolCallSummary} />
        )}
        {isBot && hasA2UI && a2uiMessages && (
          <div className="mt-1 w-full min-w-[20rem] max-w-full rounded-[20px] border border-border bg-surface-1 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
            <A2UIRenderer messages={a2uiMessages} onAction={onA2UIAction} />
          </div>
        )}
        {isBot && sidebarA2UI && onOpenSidebar && (
          <SidebarA2UIButton payload={sidebarA2UI} onOpen={onOpenSidebar} />
        )}
        {isBot && canvasOpBatch && <CanvasOpCard batch={canvasOpBatch} />}
        {time && <div className="text-[10px] text-text-muted pl-1">{time}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SessionsPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const endRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { openWith } = useA2UISidebar();

  useEffect(() => {
    if (id) track("session_detail_view");
  }, [id]);

  // Session metadata
  const { data: session } = useQuery({
    queryKey: ["session-meta", id],
    queryFn: async () => {
      const { data } = await getApiV1SessionsById({ path: { id: id ?? "" } });
      return data;
    },
    enabled: !!id,
  });

  // Chat history — polls every 5s as reliable fallback. SSE invalidates for instant updates.
  const {
    data: chatData,
    isLoading: chatLoading,
    isError: chatError,
  } = useQuery({
    queryKey: ["chat-history", id],
    queryFn: async () => {
      const { data } = await getApiV1SessionsByIdMessages({
        path: { id: id ?? "" },
        query: { limit: 200 },
      });
      return data;
    },
    enabled: !!id,
    refetchInterval: 5000,
  });

  // SSE real-time connection — streams delta events for fast perceived response
  // and invalidates chat history on final/aborted/error.
  // Polling (5s refetchInterval above) handles the fallback regardless of SSE state.
  const [streamingText, setStreamingText] = useState("");

  useEffect(() => {
    if (!id || !session?.botId || !session?.sessionKey) return;

    const client = createLocalStreamSSEClient({
      botId: session.botId,
      sessionKey: session.sessionKey,
      onConnected: () => {
        // Stream established — no action needed
      },
      onDelta: (delta) => {
        // Accumulate streaming text for real-time display
        setStreamingText((prev) =>
          delta.replace ? delta.deltaText : prev + delta.deltaText,
        );
      },
      onFinal: (final) => {
        // OpenClaw emits ONE final per run, at run end (emitChatFinal fires
        // on jobState "done") — intermediate visible replies arrive only via
        // history polling.  So final IS the "whole reply finished" signal.
        if (
          activeRunIdRef.current &&
          final.runId &&
          final.runId !== activeRunIdRef.current
        ) {
          // A different run in this session (e.g. cron-triggered) finished —
          // refresh history but keep waiting for our own run.
          void queryClient.invalidateQueries({
            queryKey: ["chat-history", id],
          });
          return;
        }
        activeRunIdRef.current = null;
        setStreamingText("");
        setWaitingForReply(false);
        sentAtRef.current = 0;
        setPendingMessages([]);
        void queryClient.invalidateQueries({ queryKey: ["chat-history", id] });
      },
      onAborted: (aborted) => {
        if (
          activeRunIdRef.current &&
          aborted.runId &&
          aborted.runId !== activeRunIdRef.current
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["chat-history", id],
          });
          return;
        }
        activeRunIdRef.current = null;
        setStreamingText("");
        setWaitingForReply(false);
        sentAtRef.current = 0;
        void queryClient.invalidateQueries({ queryKey: ["chat-history", id] });
      },
      onError: (error) => {
        if (
          activeRunIdRef.current &&
          error.runId &&
          error.runId !== activeRunIdRef.current
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["chat-history", id],
          });
          return;
        }
        activeRunIdRef.current = null;
        setStreamingText("");
        setWaitingForReply(false);
        sentAtRef.current = 0;
        void queryClient.invalidateQueries({ queryKey: ["chat-history", id] });
      },
    });

    client.connect();
    return () => {
      client.disconnect();
    };
  }, [id, session?.botId, session?.sessionKey, queryClient]);

  // Bind this session to its own canvas board (W5): opening a session switches
  // the global canvas to that session's board, lazily creating one on first
  // visit. Keyed on sessionKey so it fires once per focused session, not per
  // render (title is read only to name a freshly-created board — a later title
  // change must not re-bind, so it is intentionally not a dependency).
  // bindSessionToBoard routes through the reviewed switchCanvasBoard
  // (flush-save-first) so no board content is ever lost or mixed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionKey keys the bind; title is a creation-only label
  useEffect(() => {
    if (!session?.sessionKey) return;
    void bindSessionToBoard(session.sessionKey, session.title ?? undefined);
  }, [session?.sessionKey]);

  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data } = await getApiV1Channels();
      return data;
    },
    enabled: !!id,
  });

  // Bots list (for ChatInputArea)
  const { data: botsData } = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const { data } = await getApiV1Bots();
      return data;
    },
  });
  const bots = (botsData?.bots ?? []) as BotItem[];

  // Selected bot for this session
  const { data: botData } = useQuery({
    queryKey: ["bot", session?.botId],
    queryFn: async () => {
      if (!session?.botId) return null;
      const { data } = await getApiV1BotsByBotId({
        path: { botId: session.botId },
      });
      return data;
    },
    enabled: !!session?.botId,
  });
  const bot = (botData as Record<string, unknown> | null) ?? null;
  const selectedBot: BotItem | null = bot
    ? ({
        id: (bot as Record<string, unknown>).id as string,
        name: (bot as Record<string, unknown>).name as string,
        slug: (bot as Record<string, unknown>).slug as string,
        status: (bot as Record<string, unknown>).status as
          | "active"
          | "paused"
          | "deleted",
        modelId: (bot as Record<string, unknown>).modelId as string,
      } as BotItem)
    : null;

  // Stable A2UI action handler shared by inline rendering and sidebar
  const onA2UIAction = useCallback(
    (actionName: string, context: Record<string, unknown>) => {
      if (!selectedBot || !id || !session?.sessionKey) return;
      void postApiV1ChatLocal({
        body: {
          botId: selectedBot.id,
          sessionKey: session.sessionKey,
          message: {
            type: "text",
            content: JSON.stringify({
              type: "a2ui_action",
              actionName,
              data: context,
            }),
          },
        },
      });
    },
    [selectedBot, id, session?.sessionKey],
  );

  // Send message handler
  const [pendingMessages, setPendingMessages] = useState<
    {
      id: string;
      text: string;
      timestamp: number;
      attachments: PendingAttachment[];
    }[]
  >([]);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [newSessionDividerTime, setNewSessionDividerTime] = useState<
    number | null
  >(null);
  const sentAtRef = useRef(0);
  /** runId of the chat run this composer is waiting on (null = any run). */
  const activeRunIdRef = useRef<string | null>(null);

  // Reset waiting state when switching sessions
  // biome-ignore lint/correctness/useExhaustiveDependencies: id triggers reset on session navigation
  useEffect(() => {
    setWaitingForReply(false);
    sentAtRef.current = 0;
    activeRunIdRef.current = null;
    setPendingMessages([]);
    setStreamingText("");
  }, [id]);

  const handleSend = useCallback(
    async (
      text: string,
      attachments: PendingAttachment[],
      skillSlug: string | null,
    ) => {
      if (!selectedBot || !id || !session?.sessionKey) return;

      // Intercept /new command
      const trimmed = text.trim().toLowerCase();
      if (["/new", "/reset", "/clear"].includes(trimmed)) {
        try {
          await postApiV1SessionsByIdReset({ path: { id } });
          setNewSessionDividerTime(Date.now());
          setWaitingForReply(false);
          sentAtRef.current = 0;
          await queryClient.invalidateQueries({
            queryKey: ["chat-history", id],
          });
          toast.success(
            t("sessions.chat.newSession", { defaultValue: "New conversation" }),
          );
        } catch {
          toast.error(
            t("sessions.chat.newSession", { defaultValue: "New conversation" }),
          );
        }
        return;
      }

      // Format message payload with attachment support (mirrors local-chat.tsx)
      const onlyImage = attachments[0];
      const isImageOnly =
        attachments.length === 1 && onlyImage?.type === "image" && !text.trim();
      const msgContent = isImageOnly
        ? {
            type: "image" as const,
            content: onlyImage?.content ?? "",
            metadata: { mimeType: onlyImage?.mimeType ?? "image/png" },
          }
        : {
            type: "text" as const,
            content: text,
            ...(skillSlug ? { skillSlug } : {}),
            attachments:
              attachments.length > 0
                ? attachments.map((a) => ({
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

      const optimisticId = `pending-${Date.now()}`;
      const now = Date.now();
      sentAtRef.current = now;
      setPendingMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          text,
          timestamp: now,
          attachments,
        },
      ]);
      setWaitingForReply(true);

      try {
        const result = await postApiV1ChatLocal({
          body: {
            botId: selectedBot.id,
            sessionKey: session.sessionKey,
            message: msgContent,
          },
        });
        if (result.error) {
          // Send was rejected before a run started — most commonly 409 "a run
          // is already active for this session" (OpenClaw holds the session
          // write-lock for the whole in-flight turn, so a concurrent turn can't
          // start). Roll the optimistic bubble back and show a friendly notice
          // instead of leaving the composer stuck "waiting".
          activeRunIdRef.current = null;
          setWaitingForReply(false);
          setPendingMessages((prev) =>
            prev.filter((m) => m.id !== optimisticId),
          );
          toast.info(
            t("sessions.chat.sessionBusy", {
              defaultValue: "上一条消息还在处理中，请等当前任务完成后再发送。",
            }),
          );
          return;
        }
        // Remember our run id so SSE final/aborted/error events from OTHER
        // runs in this session don't prematurely re-enable the composer.
        activeRunIdRef.current = result.data?.message?.runId ?? null;
        await queryClient.invalidateQueries({
          queryKey: ["chat-history", id],
        });
      } catch {
        activeRunIdRef.current = null;
        setWaitingForReply(false);
        setPendingMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      }
    },
    [selectedBot, id, session?.sessionKey, queryClient, t],
  );

  const handleCancel = useCallback(async () => {
    if (!session?.sessionKey || !selectedBot) return;
    try {
      const { data } = await postApiV1ChatCancel({
        body: {
          botId: selectedBot.id,
          sessionKey: session.sessionKey,
        },
      });
      if (data) {
        activeRunIdRef.current = null;
        setWaitingForReply(false);
        sentAtRef.current = 0;
      }
    } catch {
      // Silently ignore — the reply may have already finished
    }
  }, [session?.sessionKey, selectedBot]);

  // null = not yet loaded, [] = loaded but empty, [...] = loaded with messages
  const messages = (
    chatData ? ((chatData as Record<string, unknown>)?.messages ?? []) : null
  ) as ChatMessageData[] | null;
  // Keep existing data during refetch so optimistic messages and Thinking remain visible
  const safeMessages = chatLoading && !chatData ? [] : (messages ?? []);

  // Build a set of server user message texts to deduplicate against optimistic messages
  const serverUserTexts = new Set<string>();
  // Arrival times of media-only (no caption) server user messages — used to
  // clear media-only optimistic messages, whose empty text would otherwise
  // match any historical captionless upload.
  const serverMediaOnlyTimes: number[] = [];
  for (const m of safeMessages) {
    if (m.role !== "user") continue;
    const extracted = extractMessage(m as unknown as Record<string, unknown>);
    if (extracted.text.trim().length > 0) {
      serverUserTexts.add(extracted.text);
    } else if (extracted.images.length > 0 || extracted.fileCards.length > 0) {
      const arrivedAt =
        m.timestamp ?? (m.createdAt ? new Date(m.createdAt).getTime() : 0);
      serverMediaOnlyTimes.push(arrivedAt);
    }
  }

  // Clear optimistic messages that already appear in server data
  useEffect(() => {
    if (pendingMessages.length === 0) return;
    const remaining = pendingMessages.filter(
      (pm) =>
        !isPendingMessageOnServer(pm, serverUserTexts, serverMediaOnlyTimes),
    );
    if (remaining.length < pendingMessages.length) {
      setPendingMessages(remaining);
    }
  }, [serverUserTexts, pendingMessages]);

  // NOTE: waiting state is intentionally NOT cleared when an assistant
  // message appears in polled history — OpenClaw runs can emit several
  // intermediate visible replies while the run is still working.  The
  // composer re-enables only on the run-level SSE final/aborted/error
  // (or the safety timeout below).

  // Safety timeout: clear waitingForReply after 2 minutes regardless of SSE/polling state
  const waitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (waitingForReply) {
      waitingTimerRef.current = setTimeout(() => {
        setWaitingForReply(false);
        sentAtRef.current = 0;
        setPendingMessages([]);
      }, 120_000);
    }
    return () => {
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
        waitingTimerRef.current = null;
      }
    };
  }, [waitingForReply]);

  // Optimistic messages: use text-based key so React reuses the DOM node
  // when the server message replaces the optimistic one
  const optimisticMessages: ChatMessageData[] = pendingMessages
    .filter(
      (pm) =>
        !isPendingMessageOnServer(pm, serverUserTexts, serverMediaOnlyTimes),
    )
    .map((pm) => ({
      // stable key based on text content + attachment count
      id: `user-${pm.text.slice(0, 40)}-${pm.attachments.length}`,
      role: "user" as const,
      content:
        pm.attachments.length === 0
          ? pm.text
          : [
              ...(pm.text.trim().length > 0
                ? [{ type: "text", text: pm.text }]
                : []),
              ...pm.attachments.map((a) =>
                a.type === "image"
                  ? { type: "image", data: a.content, mimeType: a.mimeType }
                  : {
                      type: "file",
                      metadata: {
                        filename: a.filename ?? "file",
                        mimeType: a.mimeType,
                        size: a.size,
                      },
                    },
              ),
            ],
      timestamp: pm.timestamp,
      createdAt: new Date(pm.timestamp).toISOString(),
    }));

  const displayMessages = [...safeMessages, ...optimisticMessages];

  // Enrich assistant messages with A2UI from matching render_a2ui toolResults.
  // render_a2ui results contain A2UI JSONL in ```a2ui code blocks, but
  // ChatBubble only renders A2UI for assistant (bot) messages.
  // Inject the A2UI into the assistant message that called render_a2ui.
  const a2uiFromToolResults = new Map<string, A2UIMessage[]>();
  // S8: canvas_op toolResults carry a fenced ```canvas-op``` batch — collect it
  // by toolCallId so it can render on the parent assistant message.
  const canvasOpFromToolResults = new Map<string, CanvasOpBatchView>();
  for (const m of displayMessages) {
    const rm = m as unknown as Record<string, unknown>;
    if (rm.role === "toolResult" && A2UI_TOOL_NAMES.has(String(rm.toolName))) {
      const te = extractMessage(rm);
      if (te.a2uiMessages?.length) {
        a2uiFromToolResults.set(String(rm.toolCallId ?? ""), te.a2uiMessages);
      }
    }
    if (
      rm.role === "toolResult" &&
      CANVAS_OP_TOOL_NAMES.has(String(rm.toolName))
    ) {
      const te = extractMessage(rm);
      if (te.canvasOpBatch) {
        canvasOpFromToolResults.set(
          String(rm.toolCallId ?? ""),
          te.canvasOpBatch,
        );
      }
    }
  }

  // Detect sidebar-bound surfaces (surfaceId starts with "sidebar:")
  const enrichedMessages = displayMessages
    .map((msg) => {
      const rm = msg as unknown as Record<string, unknown>;
      const extracted = extractMessage(rm);

      // Inject A2UI from matching render_a2ui toolResult
      if (rm.role === "assistant" && !extracted.hasA2UI) {
        const content = rm.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block?.type === "toolCall" &&
              A2UI_TOOL_NAMES.has(String(block?.name))
            ) {
              const a2uiFromResult = a2uiFromToolResults.get(
                String(block.id ?? ""),
              );
              if (a2uiFromResult?.length) {
                const createMsg = a2uiFromResult.find(
                  (m) => "createSurface" in m,
                );
                const sid = (
                  createMsg as
                    | { createSurface: { surfaceId: string } }
                    | undefined
                )?.createSurface?.surfaceId;
                if (sid && isSidebarBoundSurface(sid, a2uiFromResult)) {
                  // Sidebar-bound surface: render a jump button in the
                  // thread; opening happens on click (or automatically the
                  // first time the surface arrives — see effect below).
                  extracted.sidebarA2UI = {
                    surfaceId: sid,
                    messages: a2uiFromResult,
                  };
                } else {
                  extracted.hasA2UI = true;
                  extracted.a2uiMessages = a2uiFromResult;
                }
                break;
              }
            }
          }
        }
      }

      // S8: inject the canvas-op batch from the matching canvas_op toolResult
      // onto the assistant message that called it (parallel to the a2ui path).
      if (rm.role === "assistant" && !extracted.canvasOpBatch) {
        const content = rm.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block?.type === "toolCall" &&
              CANVAS_OP_TOOL_NAMES.has(String(block?.name))
            ) {
              const batch = canvasOpFromToolResults.get(String(block.id ?? ""));
              if (batch) {
                extracted.canvasOpBatch = batch;
                break;
              }
            }
          }
        }
      }

      return { msg, extracted };
    })
    .filter(({ msg, extracted }) => {
      const rm = msg as unknown as Record<string, unknown>;
      // Hide A2UI toolResults — their payload shows on the parent assistant msg
      if (
        rm.role === "toolResult" &&
        A2UI_TOOL_NAMES.has(String(rm.toolName))
      ) {
        return false;
      }
      // Hide canvas_op toolResults — the confirm card shows on the parent msg.
      if (
        rm.role === "toolResult" &&
        CANVAS_OP_TOOL_NAMES.has(String(rm.toolName))
      ) {
        return false;
      }
      if (extracted.text.trim().length > 0) return true;
      if ((extracted.replyContextText?.trim().length ?? 0) > 0) return true;
      if (extracted.hasToolCall) return true;
      if (extracted.sidebarA2UI) return true;
      if (extracted.a2uiAction) return true;
      if (extracted.canvasOpBatch) return true;
      if (extracted.images.length > 0) return true;
      if (extracted.fileCards.length > 0) return true;
      return false;
    });

  // Auto-open the sidebar when a NEW sidebar surface arrives during a live
  // conversation.  Surfaces already present on initial load stay closed —
  // the jump button in the thread reopens them on demand.
  const sidebarPayloads = enrichedMessages
    .map(({ extracted }) => extracted.sidebarA2UI)
    .filter((p): p is SidebarA2UIPayload => p !== null);
  const sidebarSurfaceKey = sidebarPayloads.map((p) => p.surfaceId).join("|");
  const seenSidebarSurfacesRef = useRef<Set<string> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sidebarSurfaceKey tracks payload identity
  useEffect(() => {
    if (!chatData) return;
    if (seenSidebarSurfacesRef.current === null) {
      seenSidebarSurfacesRef.current = new Set(
        sidebarPayloads.map((p) => p.surfaceId),
      );
      return;
    }
    const seen = seenSidebarSurfacesRef.current;
    for (const payload of sidebarPayloads) {
      if (seen.has(payload.surfaceId)) continue;
      seen.add(payload.surfaceId);
      openWith(payload.surfaceId, payload.messages, onA2UIAction);
    }
  }, [sidebarSurfaceKey, chatData]);

  // Reset surface tracking when navigating to a different session
  // biome-ignore lint/correctness/useExhaustiveDependencies: id change resets tracking
  useEffect(() => {
    seenSidebarSurfacesRef.current = null;
  }, [id]);

  // Auto-scroll on new messages or state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages or waiting state changes
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "instant" });
  }, [chatData, waitingForReply, pendingMessages.length]);

  // Whether the thread currently ends with an assistant message — the
  // Thinking/streaming bubbles then drop their avatar to read as a
  // continuation of the same reply run.
  const lastDisplayedIsAssistant =
    enrichedMessages.length > 0 &&
    enrichedMessages[enrichedMessages.length - 1]?.msg.role === "assistant";

  if (!id) {
    return <EmptyState />;
  }

  const platform = (session?.channelType ?? "web") as Platform;
  const platformCfg = getPlatformConfig(platform);
  const messageCount = session?.messageCount ?? messages?.length ?? 0;
  const lastActive = session?.lastMessageAt ?? session?.updatedAt ?? null;
  const sessionMetadata =
    (session?.metadata as Record<string, unknown> | null | undefined) ?? null;
  const linkedChannel = channelsData?.channels?.find(
    (channel) => channel.id === session?.channelId,
  );
  const externalChatUrl =
    platform === "web"
      ? ""
      : getChannelChatUrl(
          platform,
          linkedChannel?.appId,
          linkedChannel?.botUserId,
          linkedChannel?.accountId,
          {
            preferExactSessionTarget: true,
            sessionMetadata,
          },
        );

  // Detect group session from title or metadata
  const isGroup =
    (session?.metadata as Record<string, unknown> | null)?.isGroup === true ||
    (session?.title ?? "").includes("(group)");

  const buttonClassName = cn(
    "inline-flex h-12 items-center justify-center gap-3 rounded-[18px] border bg-white px-5 text-[13px] font-medium text-text-primary shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition-colors",
    "border-[rgba(15,23,42,0.1)] hover:bg-[rgba(248,250,252,0.9)]",
  );

  // Canvas workbench toggle state for the header entry button. The session
  // is already bound 1:1 to its own board (bindSessionToBoard above), so
  // opening the panel lands directly on this session's canvas.
  const { panelOpen: canvasPanelOpen } = useCanvas();

  const handleUnavailableChatLink = (): void => {
    if (platform === "feishu") {
      toast.info(
        "This session is missing Feishu openChatId metadata, so the exact bot chat cannot be opened yet.",
      );
      return;
    }

    toast.info("This channel does not expose a direct chat link yet.");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="shrink-0 border-b border-border px-6 py-2 md:pt-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-3 items-center">
            <SessionPlatformBadge
              platform={platform}
              className="h-[34px] w-[34px] shrink-0"
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-bold text-text-heading truncate">
                  {session?.title ?? id}
                </h1>
                {isGroup && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-[var(--color-info-subtle)] text-[var(--color-info)]">
                    Group
                  </span>
                )}
              </div>
              <div className="text-[11px] text-text-muted mt-0.5">
                {platformCfg.label} ·{" "}
                {t("sessions.chat.messages", { count: messageCount })}
                {lastActive && (
                  <>
                    {" "}
                    ·{" "}
                    {t("sessions.chat.lastActive", {
                      time: formatRelativeTime(lastActive),
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-session-canvas-toggle="true"
              aria-pressed={canvasPanelOpen}
              aria-label={t("sessions.chat.canvas")}
              title={t("sessions.chat.canvas")}
              onClick={() => setPanelOpen(!canvasPanelOpen)}
              className={cn(
                "rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary",
                canvasPanelOpen && "text-sky-600",
              )}
            >
              <PanelRight size={18} />
            </button>
            {!!session?.channelId &&
              platform !== "wechat" &&
              (externalChatUrl ? (
                <a
                  href={externalChatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    const channel = normalizeChannel(platform);
                    if (!channel) {
                      return;
                    }
                    track("workspace_chat_in_im_click", {
                      channel,
                      where: "conversation",
                    });
                  }}
                  className={buttonClassName}
                >
                  <PlatformIcon platform={platform} size={18} />
                  <span>{t(platformCfg.openLabel)}</span>
                  <ArrowUpRight className="size-[16px] text-text-muted" />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={handleUnavailableChatLink}
                  className={buttonClassName}
                >
                  <PlatformIcon platform={platform} size={18} />
                  <span>{t(platformCfg.openLabel)}</span>
                  <ArrowUpRight className="size-[16px] text-text-muted" />
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
        {chatError ? (
          <ChatUnavailable />
        ) : chatLoading ? null : displayMessages.length === 0 ? (
          <ChatEmpty />
        ) : (
          <div data-chat-thread={id} className="px-4 pt-12 pb-8 sm:px-6">
            <div
              data-chat-layout="centered"
              className="mx-auto flex max-w-[800px] flex-col gap-5"
            >
              {enrichedMessages.flatMap(({ msg, extracted }, idx, arr) => {
                const msgTime = msg.timestamp ?? 0;
                const prevTime =
                  idx > 0 ? (arr[idx - 1]?.msg.timestamp ?? 0) : 0;
                const divider =
                  newSessionDividerTime &&
                  msgTime >= newSessionDividerTime &&
                  prevTime < newSessionDividerTime
                    ? [
                        <div
                          key="session-divider"
                          className="flex items-center gap-3 my-4"
                        >
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-[11px] text-text-muted shrink-0">
                            {t("sessions.chat.newSession", {
                              defaultValue: "New conversation",
                            })}
                          </span>
                          <div className="flex-1 h-px bg-border" />
                        </div>,
                      ]
                    : [];
                // Collapse avatars for consecutive assistant messages — only
                // the first message of a run shows the bot avatar.  A "new
                // conversation" divider restarts the run.
                const showAvatar =
                  msg.role !== "assistant" ||
                  divider.length > 0 ||
                  idx === 0 ||
                  arr[idx - 1]?.msg.role !== "assistant";
                return [
                  ...divider,
                  <ChatBubble
                    key={msg.id}
                    msg={msg}
                    extracted={extracted}
                    showAvatar={showAvatar}
                    onA2UIAction={onA2UIAction}
                    onOpenSidebar={(payload) => {
                      openWith(
                        payload.surfaceId,
                        payload.messages,
                        onA2UIAction,
                      );
                    }}
                  />,
                ];
              })}
              {waitingForReply && !streamingText && (
                <div className="flex gap-3 items-start">
                  {lastDisplayedIsAssistant ? (
                    <div aria-hidden className="shrink-0 w-9 h-9 -ml-1" />
                  ) : (
                    <img
                      src={BOT_AVATAR}
                      alt=""
                      className="shrink-0 w-9 h-9 -ml-1 mt-0 object-contain"
                    />
                  )}
                  <div className="inline-flex items-center gap-1.5 rounded-[20px] border border-border bg-surface-1 px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                    <Loader2
                      size={14}
                      className="animate-spin text-text-muted"
                    />
                    <span className="text-[13px] text-text-muted">
                      {t("sessions.chat.thinking", {
                        defaultValue: "Thinking...",
                      })}
                    </span>
                  </div>
                </div>
              )}
              {waitingForReply && streamingText && (
                <div className="flex gap-3 items-start">
                  {lastDisplayedIsAssistant ? (
                    <div aria-hidden className="shrink-0 w-9 h-9 -ml-1" />
                  ) : (
                    <img
                      src={BOT_AVATAR}
                      alt=""
                      className="shrink-0 w-9 h-9 -ml-1 mt-0 object-contain"
                    />
                  )}
                  <div className="rounded-[20px] border border-border bg-surface-1 px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] max-w-[80%]">
                    <p className="text-[13px] text-text-secondary whitespace-pre-wrap break-words">
                      {stripMediaMarkerLines(streamingText)}
                      <span className="inline-block w-1.5 h-4 ml-0.5 bg-text-secondary animate-pulse align-text-bottom" />
                    </p>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>
        )}
      </div>

      {/* Chat Input */}
      <div className="shrink-0 px-4 py-3">
        <div className="mx-auto w-full max-w-[800px]">
          <ChatInputArea
            bots={bots}
            selectedBot={selectedBot}
            onSelectBot={() => {}}
            onSend={(text, attachments, skillSlug) => {
              void handleSend(text, attachments, skillSlug);
            }}
            onCancel={handleCancel}
            sending={false}
            waitingReply={waitingForReply}
            disabled={!session?.botId}
            placeholder={t("localChat.inputPlaceholder")}
            showBotSelector={false}
            modelReadOnly
          />
        </div>
      </div>
    </div>
  );
}
