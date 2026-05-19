import {
  type BotItem,
  ChatInputArea,
  type PendingAttachment,
} from "@/components/chat-input-area";
import { PlatformIcon } from "@/components/platform-icons";
import { ChatMarkdown } from "@/components/ui/chat-markdown";
import { A2UIRenderer } from "@/lib/a2ui";
import type { A2UIMessage } from "@/lib/a2ui";
import { type SSEMessage, createSSEClient } from "@/lib/api/event-source";
import { getChannelChatUrl } from "@/lib/channel-links";
import { getSessionFolderUrl, openLocalFolderUrl } from "@/lib/desktop-links";
import { normalizeChannel, track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  FileImage,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquare,
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
  postApiV1ChatLocal,
  postApiV1SessionsByIdReset,
} from "../../lib/api/sdk.gen";

const BOT_AVATAR = "/images/claw-avatar.png";
const USER_AVATAR = "/images/tabby-avatar.png";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip OpenClaw-injected metadata blocks from user message text.
 *
 * OpenClaw prepends each user message with "Conversation info (untrusted
 * metadata)" and "Sender (untrusted metadata)" JSON blocks followed by a
 * `[message_id: ...]` line and `senderName: actualMessage`. We extract
 * only the real user text after the last metadata marker.
 */
function stripMetadata(raw: string): string {
  const withoutConversationMeta = raw.replace(
    /Conversation info \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/g,
    "",
  );
  const withoutSenderMeta = withoutConversationMeta.replace(
    /Sender \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/g,
    "",
  );
  const withoutReplyMeta = withoutSenderMeta.replace(
    /Replied message \(untrusted, for context\):\s*```json\s*[\s\S]*?```\s*/g,
    "",
  );

  // Pattern 1 (Feishu/Slack): [message_id: ...]\nsenderName: actualMessage
  const markerMatch = raw.match(
    /\[message_id:\s*[^\]]+\](?:\n|\\n)(.+?):\s*([\s\S]*)$/,
  );
  if (markerMatch?.[2] != null) {
    return markerMatch[2].trim();
  }
  // Pattern 2 (webchat): [Thu 2026-03-19 21:05 GMT+8] actualMessage
  const tsMatch = raw.match(
    /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*([\s\S]*)$/,
  );
  if (tsMatch?.[1] != null) {
    return tsMatch[1].trim();
  }
  if (withoutReplyMeta !== raw) {
    return withoutReplyMeta.trim();
  }
  return raw;
}

function stripAssistantReplyPrefix(raw: string): string {
  return raw
    .replace(/^\s*\[\[reply_to_current\]\]\s*/u, "")
    .replace(/<final>\s*/giu, "")
    .replace(/\s*<\/final>/giu, "");
}

/**
 * Extract sender name from raw message text metadata.
 *
 * Looks for the `[message_id: ...]\nsenderName: actualMessage` pattern
 * and returns the sender name portion.
 */
function extractSenderName(raw: string): string | null {
  const markerMatch = raw.match(
    /\[message_id:\s*[^\]]+\](?:\n|\\n)(.+?):\s*[\s\S]*$/,
  );
  if (markerMatch?.[1] != null) {
    return markerMatch[1].trim();
  }
  return null;
}

/** Strip ```a2ui fenced code blocks from text, extracting A2UI JSONL messages. */
function stripA2UIBlock(text: string): {
  cleanText: string;
  a2uiMessages: A2UIMessage[];
} {
  const a2uiMessages: A2UIMessage[] = [];
  const a2uiBlockRegex = /```a2ui\n([\s\S]*?)```/g;
  const cleanText = text.replace(a2uiBlockRegex, (_match, content: string) => {
    for (const line of content.split("\n")) {
      try {
        const parsed = JSON.parse(line.trim());
        if (
          parsed?.version === "v0.9" &&
          (parsed.createSurface ||
            parsed.updateComponents ||
            parsed.updateDataModel ||
            parsed.deleteSurface)
        ) {
          a2uiMessages.push(parsed as A2UIMessage);
        }
      } catch {
        // skip non-JSON lines (blank lines, malformed)
      }
    }
    return "";
  });
  return { cleanText, a2uiMessages };
}

interface ImageBlockInfo {
  mimeType: string;
  data: string;
}

interface FileCardInfo {
  name: string;
  mimeType: string;
  size?: number;
}

interface ExtractedMessage {
  text: string;
  replyContextText: string | null;
  senderName: string | null;
  hasToolCall: boolean;
  toolCallSummary: string | null;
  hasA2UI: boolean;
  a2uiMessages: A2UIMessage[] | null;
  images: ImageBlockInfo[];
  fileCards: FileCardInfo[];
}

function extractReplyContextPrefix(raw: string): {
  text: string;
  replyContextText: string | null;
} {
  const englishMatch = raw.match(
    /^\[Replying to:\s*(?:"([\s\S]*?)"|([^\]]+))\]\s*(?:(?:\r?\n)|\\n)+([\s\S]*)$/u,
  );
  if (englishMatch) {
    return {
      replyContextText: (englishMatch[1] ?? englishMatch[2] ?? "").trim(),
      text: (englishMatch[3] ?? "").trim(),
    };
  }

  const chineseMatch = raw.match(
    /^\[引用:\s*([\s\S]*?)\]\s*(?:(?:\r?\n)|\\n)+([\s\S]*)$/u,
  );
  if (chineseMatch) {
    return {
      replyContextText: (chineseMatch[1] ?? "").trim(),
      text: (chineseMatch[2] ?? "").trim(),
    };
  }

  return {
    text: raw,
    replyContextText: null,
  };
}

/** Extract display text, sender name, tool call info, and A2UI messages from various message content formats. */
function parseFileBlocksFromText(text: string): {
  cleanText: string;
  fileCards: FileCardInfo[];
} {
  const fileCards: FileCardInfo[] = [];
  const fileRegex = /<file\s+([^>]*)>([\s\S]*?)<\/file>/g;
  let cleanText = text;
  let match = fileRegex.exec(text);
  while (match !== null) {
    const attrs = match[1] ?? "";
    const innerText = match[2] ?? "";
    const nameMatch = attrs.match(/name="([^"]*)"/);
    const mimeMatch = attrs.match(/mime="([^"]*)"/);
    const sizeMatch = attrs.match(/size="([^"]*)"/);
    if (nameMatch?.[1]) {
      fileCards.push({
        name: nameMatch[1],
        mimeType: mimeMatch?.[1] ?? "application/octet-stream",
        size: sizeMatch?.[1] ? Number(sizeMatch[1]) : undefined,
      });
    }
    cleanText = cleanText.replace(match[0], innerText);
    match = fileRegex.exec(text);
  }
  return { cleanText, fileCards };
}

/** Extract display text, sender name, and tool call info from various message content formats. */
function extractMessage(msg: Record<string, unknown>): ExtractedMessage {
  let raw = "";
  let replyContextText: string | null = null;
  let hasToolCall = false;
  let toolCallSummary: string | null = null;
  let hasA2UI = false;
  let a2uiMessages: A2UIMessage[] | null = null;
  const images: ImageBlockInfo[] = [];
  const fileCards: FileCardInfo[] = [];

  // Format 1: msg.text (shorthand)
  if (typeof msg.text === "string") {
    const stripped = stripA2UIBlock(msg.text);
    raw = stripped.cleanText;
    if (stripped.a2uiMessages.length > 0) {
      hasA2UI = true;
      if (!a2uiMessages) a2uiMessages = [];
      a2uiMessages.push(...stripped.a2uiMessages);
    }
  } else if (typeof msg.content === "string") {
    // Format 2: msg.content (string)
    const stripped = stripA2UIBlock(msg.content);
    raw = stripped.cleanText;
    if (stripped.a2uiMessages.length > 0) {
      hasA2UI = true;
      if (!a2uiMessages) a2uiMessages = [];
      a2uiMessages.push(...stripped.a2uiMessages);
    }
  } else if (Array.isArray(msg.content)) {
    // Format 3: msg.content (array of blocks)
    const blocks = msg.content as Record<string, unknown>[];
    const textParts: string[] = [];
    for (const b of blocks) {
      if (b?.type === "text") {
        const textContent = String(b?.text ?? "");
        const stripped = stripA2UIBlock(textContent);
        textParts.push(stripped.cleanText);
        if (stripped.a2uiMessages.length > 0) {
          hasA2UI = true;
          if (!a2uiMessages) a2uiMessages = [];
          a2uiMessages.push(...stripped.a2uiMessages);
        }
      } else if (b?.type === "replyContext") {
        const candidate = String(b?.text ?? "").trim();
        if (candidate.length > 0) {
          replyContextText = candidate;
        }
      } else if (b?.type === "toolCall" || b?.type === "tool_use") {
        hasToolCall = true;
        const name = String(b?.name ?? b?.toolName ?? "tool");
        toolCallSummary = name;
      } else if (b?.type === "a2ui" && typeof b.data === "object" && b.data) {
        hasA2UI = true;
        if (!a2uiMessages) a2uiMessages = [];
        a2uiMessages.push(b.data as A2UIMessage);
      } else if (b?.type === "image") {
        const source = b?.source as Record<string, unknown> | undefined;
        const sourceData = typeof source?.data === "string" ? source.data : "";
        if (sourceData.length > 0) {
          const mimeType = String(source?.media_type ?? "image/png");
          const base64 = sourceData.includes(",")
            ? sourceData.slice(sourceData.indexOf(",") + 1)
            : sourceData;
          images.push({ mimeType, data: base64 });
        }
      } else if (b?.type === "file") {
        const metadata = (b?.metadata ?? b) as Record<string, unknown>;
        const filename =
          typeof metadata?.filename === "string"
            ? metadata.filename
            : typeof b?.filename === "string"
              ? b.filename
              : "file";
        fileCards.push({
          name: filename,
          mimeType:
            typeof metadata?.mimeType === "string"
              ? metadata.mimeType
              : "application/octet-stream",
          size: typeof metadata?.size === "number" ? metadata.size : undefined,
        });
      }
    }
    raw = textParts.join("\n");
  }

  const senderName = msg.role === "user" ? extractSenderName(raw) : null;
  const sanitizedText =
    msg.role === "assistant"
      ? stripAssistantReplyPrefix(stripMetadata(raw))
      : stripMetadata(raw);
  const extractedReply = extractReplyContextPrefix(sanitizedText);
  const text = extractedReply.text;
  replyContextText ??= extractedReply.replyContextText;

  // Parse <file> XML blocks from text so they render as file cards instead of raw markup
  const parsedFiles = parseFileBlocksFromText(text);

  return {
    text: parsedFiles.cleanText,
    replyContextText,
    senderName,
    hasToolCall,
    toolCallSummary,
    hasA2UI,
    a2uiMessages,
    images,
    fileCards: [...fileCards, ...parsedFiles.fileCards],
  };
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
  role: "user" | "assistant";
  content: unknown;
  timestamp: number | null;
  createdAt: string | null;
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

function InlineImage({ mimeType, data }: ImageBlockInfo) {
  const [expanded, setExpanded] = useState(false);
  const src = `data:${mimeType};base64,${data}`;
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
}: {
  msg: ChatMessageData;
  extracted?: ExtractedMessage;
  onA2UIAction?: (actionName: string, context: Record<string, unknown>) => void;
}) {
  const resolvedExtracted =
    extracted ?? extractMessage(msg as unknown as Record<string, unknown>);
  const {
    text,
    replyContextText,
    senderName,
    hasToolCall,
    toolCallSummary,
    hasA2UI,
    a2uiMessages,
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
      {isBot ? (
        <img
          src={BOT_AVATAR}
          alt=""
          className="shrink-0 w-9 h-9 -ml-1 mt-0 object-contain"
        />
      ) : (
        <img
          src={USER_AVATAR}
          alt=""
          className="shrink-0 w-9 h-9 -ml-1 mt-0 object-contain"
        />
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
        {isBot && hasToolCall && <ArtifactCard summary={toolCallSummary} />}
        {isBot && hasA2UI && a2uiMessages && (
          <div className="mt-1 inline-block max-w-full">
            <A2UIRenderer messages={a2uiMessages} onAction={onA2UIAction} />
          </div>
        )}
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

  // SSE real-time connection — invalidates chat history on new messages.
  // Polling (5s refetchInterval above) handles the fallback regardless of SSE state.
  useEffect(() => {
    if (!id || !session?.botId || !session?.sessionKey) return;

    const client = createSSEClient({
      botId: session.botId,
      sessionKey: session.sessionKey,
      onMessage: (msg: SSEMessage) => {
        // Clear waiting state immediately when assistant reply arrives via SSE
        if (msg.role === "assistant" && sentAtRef.current > 0) {
          setWaitingForReply(false);
          sentAtRef.current = 0;
          setPendingMessages([]);
        }
        void queryClient.invalidateQueries({ queryKey: ["chat-history", id] });
      },
    });

    client.connect();
    return () => {
      client.disconnect();
    };
  }, [id, session?.botId, session?.sessionKey, queryClient]);

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

  // Send message handler
  const [pendingMessages, setPendingMessages] = useState<
    { id: string; text: string; timestamp: number }[]
  >([]);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [newSessionDividerTime, setNewSessionDividerTime] = useState<
    number | null
  >(null);
  const sentAtRef = useRef(0);

  // Reset waiting state when switching sessions
  useEffect(() => {
    setWaitingForReply(false);
    sentAtRef.current = 0;
    setPendingMessages([]);
  }, [id]);

  const handleSend = useCallback(
    async (text: string, attachments: PendingAttachment[]) => {
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
          text: text || (isImageOnly ? "[Image]" : "[File]"),
          timestamp: now,
        },
      ]);
      setWaitingForReply(true);

      try {
        await postApiV1ChatLocal({
          body: {
            botId: selectedBot.id,
            sessionKey: session.sessionKey,
            message: msgContent,
          },
        });
        await queryClient.invalidateQueries({
          queryKey: ["chat-history", id],
        });
      } catch {
        setWaitingForReply(false);
        setPendingMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      }
    },
    [selectedBot, id, session?.sessionKey, queryClient, t],
  );

  // null = not yet loaded, [] = loaded but empty, [...] = loaded with messages
  const messages = (
    chatData ? ((chatData as Record<string, unknown>)?.messages ?? []) : null
  ) as ChatMessageData[] | null;
  // Keep existing data during refetch so optimistic messages and Thinking remain visible
  const safeMessages = chatLoading && !chatData ? [] : (messages ?? []);

  // Build a set of server user message texts to deduplicate against optimistic messages
  const serverUserTexts = new Set(
    safeMessages
      .filter((m) => m.role === "user")
      .map((m) => extractMessage(m as unknown as Record<string, unknown>).text),
  );

  // Clear optimistic messages that already appear in server data
  useEffect(() => {
    if (pendingMessages.length === 0) return;
    const remaining = pendingMessages.filter(
      (pm) => !serverUserTexts.has(pm.text),
    );
    if (remaining.length < pendingMessages.length) {
      setPendingMessages(remaining);
    }
  }, [serverUserTexts, pendingMessages]);

  // Detect when assistant reply arrives — clear waiting state
  const assistantMessages = safeMessages.filter((m) => m.role === "assistant");
  const lastAssistantMsg =
    assistantMessages.length > 0
      ? assistantMessages[assistantMessages.length - 1]
      : undefined;
  const lastAssistantTimestamp = lastAssistantMsg?.timestamp ?? 0;

  useEffect(() => {
    if (
      waitingForReply &&
      sentAtRef.current > 0 &&
      lastAssistantTimestamp >= sentAtRef.current
    ) {
      setWaitingForReply(false);
      sentAtRef.current = 0;
      setPendingMessages([]);
    }
  }, [lastAssistantTimestamp, waitingForReply]);

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
    .filter((pm) => !serverUserTexts.has(pm.text))
    .map((pm) => ({
      id: `user-${pm.text.slice(0, 40)}`, // stable key based on text content
      role: "user" as const,
      content: pm.text,
      timestamp: pm.timestamp,
      createdAt: new Date(pm.timestamp).toISOString(),
    }));

  const displayMessages = [...safeMessages, ...optimisticMessages];

  // Enrich assistant messages with A2UI from matching render_a2ui toolResults.
  // render_a2ui results contain A2UI JSONL in ```a2ui code blocks, but
  // ChatBubble only renders A2UI for assistant (bot) messages.
  // Inject the A2UI into the assistant message that called render_a2ui.
  const a2uiFromToolResults = new Map<string, A2UIMessage[]>();
  for (const m of displayMessages) {
    const rm = m as unknown as Record<string, unknown>;
    if (rm.role === "toolResult" && rm.toolName === "render_a2ui") {
      const te = extractMessage(rm);
      if (te.a2uiMessages?.length) {
        a2uiFromToolResults.set(String(rm.toolCallId ?? ""), te.a2uiMessages);
      }
    }
  }
  const enrichedMessages = displayMessages
    .map((msg) => {
      const rm = msg as unknown as Record<string, unknown>;
      const extracted = extractMessage(rm);

      // Inject A2UI from matching render_a2ui toolResult
      if (rm.role === "assistant" && !extracted.hasA2UI) {
        const content = rm.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "toolCall" && block?.name === "render_a2ui") {
              const a2uiFromResult = a2uiFromToolResults.get(
                String(block.id ?? ""),
              );
              if (a2uiFromResult?.length) {
                extracted.hasA2UI = true;
                extracted.a2uiMessages = a2uiFromResult;
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
      // Hide render_a2ui toolResult — A2UI shown on parent assistant msg
      if (rm.role === "toolResult" && rm.toolName === "render_a2ui") {
        return false;
      }
      if (extracted.text.trim().length > 0) return true;
      if ((extracted.replyContextText?.trim().length ?? 0) > 0) return true;
      if (extracted.hasToolCall) return true;
      if (extracted.images.length > 0) return true;
      if (extracted.fileCards.length > 0) return true;
      return false;
    });

  // Auto-scroll on new messages or state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages or waiting state changes
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "instant" });
  }, [chatData, waitingForReply, pendingMessages.length]);

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
  const sessionFolderUrl = getSessionFolderUrl(sessionMetadata);
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

  const handleOpenFolder = async (): Promise<void> => {
    if (!sessionFolderUrl) {
      toast.error("Session folder is unavailable.");
      return;
    }

    try {
      await openLocalFolderUrl(sessionFolderUrl);
    } catch {
      toast.error("Failed to open session folder.");
    }
  };

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
      <div className="shrink-0 border-b border-border px-6 py-2 md:pt-7">
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
              data-session-folder-url={sessionFolderUrl ?? undefined}
              onClick={() => {
                void handleOpenFolder();
              }}
              disabled={!sessionFolderUrl}
              className={cn(
                buttonClassName,
                !sessionFolderUrl && "cursor-not-allowed opacity-60",
              )}
            >
              <FolderOpen className="size-[18px] text-text-secondary" />
              <span>{t("sessions.openFolder")}</span>
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
                return [
                  ...divider,
                  <ChatBubble
                    key={msg.id}
                    msg={msg}
                    extracted={extracted}
                    onA2UIAction={(actionName, context) => {
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
                    }}
                  />,
                ];
              })}
              {waitingForReply && (
                <div className="flex gap-3 items-start">
                  <img
                    src={BOT_AVATAR}
                    alt=""
                    className="shrink-0 w-9 h-9 -ml-1 mt-0 object-contain"
                  />
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
            onSend={(text, attachments) => {
              void handleSend(text, attachments);
            }}
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
