// Pure chat-message parsing: text-strip helpers, A2UI/canvas-op/file block
// extraction, and the extractMessage orchestrator. Moved verbatim out of
// pages/sessions.tsx (W4 close-out) — no React, no component state.
import type { A2UIMessage } from "@/lib/a2ui";
import type { CanvasOpBatchView } from "@/lib/canvas/canvas-op-card";
import { parseCanvasOpBlock } from "@/lib/canvas/canvas-ops-executor";

/**
 * Strip OpenClaw-injected metadata blocks from user message text.
 *
 * OpenClaw prepends each user message with "Conversation info (untrusted
 * metadata)" and "Sender (untrusted metadata)" JSON blocks followed by a
 * `[message_id: ...]` line and `senderName: actualMessage`. We extract
 * only the real user text after the last metadata marker.
 */
/** Controller-injected skill directive (chat-service.ts).  Hidden from the
 * user's own bubble — they picked the skill via the composer, so echoing the
 * directive text back is noise. */
const SKILL_DIRECTIVE_PATTERN = /^\[请使用「[^」]*」技能完成本次请求\]\s*/u;

/** Controller-injected routing nudge (chat-service.ts: EXPERT_ROUTING_HINT /
 * TEAM_LEAD_HINT). Hidden from the user's own bubble — it's an instruction
 * for the model, not something the user typed or should see. Matched by the
 * shared `[路由提示：…]` prefix so hint copy can evolve controller-side without
 * a frontend release. */
const EXPERT_ROUTING_HINT_PATTERN = /^\[路由提示：[^\]]+\]\s*/u;

/** OpenClaw runtime-injected internal context (e.g. subagent task-completion
 * events, delivered as a user-role message). Explicitly marked "internal —
 * keep private": never render any part of it. A message that is nothing but
 * this block extracts to empty text and the bubble is hidden entirely. */
const OPENCLAW_INTERNAL_CONTEXT_PATTERN =
  /<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>[\s\S]*?(?:<<<END_OPENCLAW_INTERNAL_CONTEXT>>>|$)/gu;

function stripMetadata(rawInput: string): string {
  // Drop controller-injected directives before any other parsing.
  const raw = rawInput
    .replace(OPENCLAW_INTERNAL_CONTEXT_PATTERN, "")
    .replace(SKILL_DIRECTIVE_PATTERN, "")
    .replace(EXPERT_ROUTING_HINT_PATTERN, "");
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
 * Hide `MEDIA:<path>` delivery directives from streamed assistant text.
 * The controller strips them from persisted history; this covers the live
 * SSE delta view so raw markers never flash mid-stream.
 */
export function stripMediaMarkerLines(raw: string): string {
  return raw
    .replace(/^MEDIA:\S[^\n]*$/gmu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

/**
 * Strip ```canvas-op fenced blocks from text and parse the FIRST one into a
 * canvas-op batch (client-side re-validated through canvasOpBatchSchema). The
 * agent's raw JSON never renders — it becomes the CanvasOpCard instead.
 */
function stripCanvasOpBlock(text: string): {
  cleanText: string;
  canvasOpBatch: CanvasOpBatchView | null;
} {
  const canvasOpBatch = parseCanvasOpBlock(text);
  const cleanText = text.replace(/```canvas-op\n[\s\S]*?```/g, "");
  return { cleanText, canvasOpBatch };
}

export interface ImageBlockInfo {
  mimeType: string;
  /** Inline base64 payload (OpenClaw flat blocks / Anthropic source blocks). */
  data?: string;
  /** Controller-served media URL (transcript MediaPaths / MEDIA: markers). */
  url?: string;
}

export interface FileCardInfo {
  name: string;
  mimeType: string;
  size?: number;
  url?: string;
}

export interface ToolCallInfo {
  id: string | null;
  name: string;
  arguments: unknown;
}

export interface SidebarA2UIPayload {
  surfaceId: string;
  messages: A2UIMessage[];
}

export interface ExtractedMessage {
  text: string;
  replyContextText: string | null;
  senderName: string | null;
  hasToolCall: boolean;
  toolCallSummary: string | null;
  toolCalls: ToolCallInfo[];
  reasoning: string[];
  hasA2UI: boolean;
  a2uiMessages: A2UIMessage[] | null;
  /** Sidebar-bound A2UI rendered as a jump button instead of inline. */
  sidebarA2UI: SidebarA2UIPayload | null;
  /** Machine round-trip A2UI action (e.g. XHSEditor publish) — shown as a chip,
   * never as raw JSON/base64. */
  a2uiAction: { actionName: string } | null;
  /** S8 chat-drives-canvas: a validated canvas-op batch → renders a confirm card. */
  canvasOpBatch: CanvasOpBatchView | null;
  /** Machine round-trip reporting a canvas-op apply failure back to the agent
   * (canvas-op-card.tsx, sent only when applyCanvasOps() returned errors) —
   * shown as a chip, never as raw JSON. */
  canvasOpResult: { applied: number; errors: string[] } | null;
  images: ImageBlockInfo[];
  fileCards: FileCardInfo[];
}

/** Tools whose toolResult payloads carry renderable A2UI JSONL. */
export const A2UI_TOOL_NAMES = new Set([
  "render_a2ui",
  "render_skill_confirmation",
  "propose_expert_install",
  "team_run_auto",
  "team_run_workflow",
  "expert_run_auto",
]);

/** Tools whose toolResult text carries a fenced ```canvas-op``` batch (S8). */
export const CANVAS_OP_TOOL_NAMES = new Set(["canvas_op"]);

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
export function extractMessage(msg: Record<string, unknown>): ExtractedMessage {
  let raw = "";
  let replyContextText: string | null = null;
  let hasToolCall = false;
  let toolCallSummary: string | null = null;
  const toolCalls: ToolCallInfo[] = [];
  const reasoning: string[] = [];
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
        toolCalls.push({
          id:
            typeof b?.id === "string"
              ? b.id
              : typeof b?.toolCallId === "string"
                ? b.toolCallId
                : null,
          name,
          arguments: b?.arguments ?? b?.input ?? null,
        });
      } else if (
        b?.type === "thinking" ||
        b?.type === "reasoning" ||
        b?.type === "reasoning_content" ||
        b?.type === "analysis"
      ) {
        const reasoningText = String(
          b?.thinking ?? b?.reasoning ?? b?.text ?? b?.content ?? "",
        ).trim();
        if (reasoningText.length > 0) {
          reasoning.push(reasoningText);
        }
      } else if (b?.type === "a2ui" && typeof b.data === "object" && b.data) {
        hasA2UI = true;
        if (!a2uiMessages) a2uiMessages = [];
        a2uiMessages.push(b.data as A2UIMessage);
      } else if (b?.type === "image") {
        // Three shapes: controller-served {url, mimeType}, OpenClaw flat
        // {data, mimeType}, Anthropic {source: {data, media_type}}.
        const url = typeof b?.url === "string" ? b.url : "";
        const source = b?.source as Record<string, unknown> | undefined;
        const sourceData = typeof source?.data === "string" ? source.data : "";
        const flatData = typeof b?.data === "string" ? b.data : "";
        const rawData = sourceData || flatData;
        if (url.length > 0) {
          images.push({
            mimeType: String(b?.mimeType ?? "image/png"),
            url,
          });
        } else if (rawData.length > 0) {
          const mimeType = String(
            source?.media_type ?? b?.mimeType ?? "image/png",
          );
          const base64 = rawData.includes(",")
            ? rawData.slice(rawData.indexOf(",") + 1)
            : rawData;
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
          url:
            typeof b?.url === "string"
              ? b.url
              : typeof metadata?.url === "string"
                ? metadata.url
                : undefined,
        });
      }
    }
    raw = textParts.join("\n");
  }

  // S8: strip any fenced ```canvas-op``` block from the display text and capture
  // the first validated batch (parallel to the a2ui strip above).
  const strippedCanvasOp = stripCanvasOpBlock(raw);
  raw = strippedCanvasOp.cleanText;
  const canvasOpBatch = strippedCanvasOp.canvasOpBatch;

  const senderName = msg.role === "user" ? extractSenderName(raw) : null;
  const sanitizedText =
    msg.role === "assistant"
      ? stripAssistantReplyPrefix(stripMetadata(raw))
      : stripMetadata(raw);
  const extractedReply = extractReplyContextPrefix(sanitizedText);
  const text = extractedReply.text;
  replyContextText ??= extractedReply.replyContextText;

  // Detect machine A2UI action round-trips (e.g. XHSEditor publish). These are
  // sent as a JSON text message carrying the full payload (including base64
  // images); render a friendly chip instead of dumping raw JSON/base64.
  const a2uiAction = parseA2UIAction(text);
  // Same round-trip pattern for a canvas-op apply failure reported back to
  // the agent (canvas-op-card.tsx) — mutually exclusive with a2uiAction.
  const canvasOpResult = a2uiAction ? null : parseCanvasOpResult(text);
  const isMachineRoundTrip = Boolean(a2uiAction || canvasOpResult);

  // Parse <file> XML blocks from text so they render as file cards instead of raw markup
  const parsedFiles = parseFileBlocksFromText(text);

  return {
    text: isMachineRoundTrip ? "" : parsedFiles.cleanText,
    replyContextText,
    senderName,
    hasToolCall,
    toolCallSummary,
    toolCalls,
    reasoning,
    hasA2UI,
    a2uiMessages,
    sidebarA2UI: null,
    a2uiAction,
    canvasOpBatch: isMachineRoundTrip ? null : canvasOpBatch,
    canvasOpResult,
    images: isMachineRoundTrip ? [] : images,
    fileCards: isMachineRoundTrip
      ? []
      : [...fileCards, ...parsedFiles.fileCards],
  };
}

/**
 * Detect an `a2ui_action` machine message (the JSON round-trip an A2UI button
 * click posts back to the agent). Returns the action name, or null.
 */
function parseA2UIAction(text: string): { actionName: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes("a2ui_action")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      type?: string;
      actionName?: string;
    };
    if (parsed?.type === "a2ui_action") {
      return { actionName: String(parsed.actionName ?? "") };
    }
  } catch {
    // not JSON — fall through
  }
  return null;
}

/**
 * Detect a `canvas_op_result` machine message (canvas-op-card.tsx reporting
 * an apply failure back to the agent — only sent when applyCanvasOps()
 * returned errors, never on a clean apply). Returns the applied count and
 * error list, or null.
 */
function parseCanvasOpResult(
  text: string,
): { applied: number; errors: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes("canvas_op_result")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      type?: string;
      applied?: number;
      errors?: string[];
    };
    if (parsed?.type === "canvas_op_result") {
      return {
        applied: Number(parsed.applied ?? 0),
        errors: Array.isArray(parsed.errors) ? parsed.errors.map(String) : [],
      };
    }
  } catch {
    // not JSON — fall through
  }
  return null;
}
