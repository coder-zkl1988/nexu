import { logger } from "../lib/logger.js";
import {
  type AttachmentExtractResult,
  extractAttachmentText,
} from "./attachment-extractor.js";
import type { AttachmentStore } from "./attachment-store.js";
import type { OpenClawGatewayService } from "./openclaw-gateway-service.js";

/**
 * Per-turn nudge so the model routes specialist requests to a domain expert
 * (in-chat auto-routing). Kept balanced so general/simple questions are still
 * answered directly. See specs/design-docs/2026-06-30-in-chat-expert-auto-route.md.
 */
const EXPERT_ROUTING_HINT =
  "[路由提示：如果本请求属于某个垂直专业领域、且有更合适的专家来处理，请先调用 find_expert 检索；" +
  "命中已安装专家就用 sessions_spawn 委派给它并把结果转述给用户，命中未安装专家就调用 propose_expert_install 让用户确认安装；" +
  "如果任务需要专家实际产出交付物（如成稿、方案、分析报告）或需要多位专家分工，改用 expert_run_auto 自动组织专家完成并展示运行卡；" +
  "如果只是通用、简单或闲聊类问题，直接自己回答，不要路由。]";

/**
 * Per-turn nudge for TEAM LEAD agents: collaborative tasks go through the
 * structured team engine (team_run_auto / team_run_workflow) instead of
 * free-form sessions_spawn, so runs land on the board with a live run card.
 * Replaces the expert-routing hint for leads — a lead should not be nudged
 * into installing experts. The web UI strips any `[路由提示：…]` prefix from
 * the user's bubble. See
 * specs/design-docs/2026-07-02-chat-first-team-operations.md.
 */
const TEAM_LEAD_HINT =
  "[路由提示：你是团队队长。需要成员产出实际工作的协作型任务，优先调用 team_run_auto（自动拆解派发）；" +
  "用户点名要跑某个已保存的工作流/SOP 时用 team_list_workflows + team_run_workflow；" +
  "启动后运行卡会自动展示给用户，只需一句话确认，不要复述计划。" +
  "通用、简单或闲聊类问题直接自己回答，不要派发。]";

export interface LocalChatMessageMetadata {
  width?: number;
  height?: number;
  duration?: number;
  mimeType?: string;
  filename?: string;
  size?: number;
}

export interface LocalChatAttachment {
  /**
   * Images travel through OpenClaw's chat.send attachment pipeline unchanged.
   * Files are saved to disk + folded into the message body as `<file path="…"
   * name="…" …>preview</file>` blocks; the agent can then reach for the
   * OpenClaw `pdf` tool (sub-agent) if it needs content beyond the preview.
   */
  type: "image" | "file";
  content: string;
  metadata?: {
    mimeType?: string;
    filename?: string;
    size?: number;
  };
}

export interface LocalChatMessageInput {
  type: "text" | "image" | "video" | "audio" | "file";
  content: string;
  metadata?: LocalChatMessageMetadata;
  attachments?: LocalChatAttachment[];
  /** Skill the user picked in the composer; folded into message text as a directive. */
  skillSlug?: string;
}

export interface LocalChatMessageOutput {
  id: string;
  runId?: string | null;
  role: "user" | "assistant";
  type: "text" | "image" | "video" | "audio" | "file";
  content: unknown;
  timestamp: number | null;
  createdAt: string | null;
}

export interface SendToMainSessionInput {
  botId: string;
  sessionKey: string;
  message: string;
  messageType: string;
  metadata?: LocalChatMessageMetadata;
  /** Images only — file attachments have already been folded into `message`. */
  attachments?: Array<{
    type: "image";
    content: string;
    metadata?: {
      mimeType?: string;
      filename?: string;
      size?: number;
    };
  }>;
}

export interface SendToMainSessionResult {
  runId?: string;
  messageId?: string;
  content?: unknown;
}

/**
 * ChatService
 *
 * Handles local chat messages sent directly to an agent's main session,
 * bypassing channel configurations.
 *
 * Attachment routing:
 *   - Images → forwarded verbatim via OpenClaw's chat.send attachments
 *   - Files  → persisted to `<stateDir>/agents/<botId>/attachments/<sessionKey>/`
 *             (a root OpenClaw's media tools already trust), previewed into
 *             the prompt as `<file path="…" name="…" …>snippet</file>` so the
 *             agent can invoke the `pdf` sub-agent tool against the path for
 *             follow-up queries without re-ingesting the full doc.
 *
 * This is the only place the webchat→OpenClaw attachment split lives; the
 * route handler stays purely transport-level.
 */
export class ChatService {
  constructor(
    private readonly gatewayService: OpenClawGatewayService,
    private readonly attachmentStore: AttachmentStore,
    /** True when this bot is some team's lead (drives the per-turn hint). */
    private readonly isTeamLead: (botId: string) => boolean = () => false,
  ) {}

  /**
   * Send a local chat message to agent main session
   *
   * Message format: { type: "text" | "image" | "video" | "audio", content: string, metadata?: {...} }
   *
   * Uses OpenClaw Gateway's main session mechanism,
   * bypassing any channel configuration.
   */
  async sendLocalMessage(
    botId: string,
    message: LocalChatMessageInput,
    sessionKey?: string,
  ): Promise<LocalChatMessageOutput> {
    const effectiveSessionKey = sessionKey ?? `agent:${botId}:main`;

    const incomingAttachments = message.attachments ?? [];
    const imageAttachments: LocalChatAttachment[] = [];
    const fileAttachments: LocalChatAttachment[] = [];
    for (const att of incomingAttachments) {
      if (att.type === "image") imageAttachments.push(att);
      else fileAttachments.push(att);
    }

    const fileResults: AttachmentExtractResult[] = [];
    let anyFilePersisted = false;
    if (fileAttachments.length > 0) {
      // Persist first so we have a `path` to embed in the `<file>` block.
      // Extraction runs concurrently once each file is on disk.
      const perFile = await Promise.all(
        fileAttachments.map(async (att) => {
          let storedPath: string | undefined;
          try {
            const saved = await this.attachmentStore.saveAttachment({
              botId,
              sessionKey: effectiveSessionKey,
              base64: att.content,
              filename: att.metadata?.filename,
              mimeType: att.metadata?.mimeType ?? "application/octet-stream",
            });
            storedPath = saved.absolutePath;
            anyFilePersisted = true;
          } catch (err) {
            logger.warn(
              {
                filename: att.metadata?.filename,
                error: err instanceof Error ? err.message : String(err),
              },
              "chat.local: attachment persistence failed; falling back to preview-only",
            );
          }
          return extractAttachmentText({
            content: att.content,
            mimeType: att.metadata?.mimeType ?? "application/octet-stream",
            filename: att.metadata?.filename,
            size: att.metadata?.size,
            mode: "preview",
            storedPath,
          });
        }),
      );
      fileResults.push(...perFile);
    }

    const appendedBlocks: string[] = [];
    for (const result of fileResults) {
      if (result.ok) {
        appendedBlocks.push(result.block);
      } else {
        appendedBlocks.push(result.fallbackMarker);
        logger.warn(
          {
            filename: result.filename,
            mimeType: result.mimeType,
            size: result.size,
            reason: result.reason,
            detail: result.message,
          },
          "chat.local: file attachment extraction skipped",
        );
      }
    }

    // Tool-use hint: tell the agent it can dispatch the `pdf` sub-agent
    // against the embedded `path` attributes instead of staying confined
    // to the inline preview text.  Only added when we actually persisted
    // at least one file — otherwise the hint would point at nothing.
    if (anyFilePersisted) {
      appendedBlocks.push(
        "[Tool hint: the <file> blocks above include a `path` attribute. " +
          "Use the `pdf` tool (pdf, pdfs, pages, prompt) with that path to " +
          "read specific pages or analyze the full document when the preview " +
          "is insufficient.]",
      );
    }

    const bodyContent =
      appendedBlocks.length === 0
        ? message.content
        : [message.content, ...appendedBlocks].filter(Boolean).join("\n\n");

    // Skill directive injection: OpenClaw's chat.send has no skill param
    // (additionalProperties:false), so the only per-message activation path
    // is the message text itself.  Prepend a directive the model reliably
    // resolves to the matching skills/<slug>/SKILL.md (verified empirically).
    const skillSlug = message.skillSlug?.trim();
    // Expert auto-routing nudge (in-chat auto-route, P4): remind the model it can
    // route a specialist request to a domain expert. Skipped for explicit skill
    // requests and for A2UI action round-trips (e.g. install_expert confirms),
    // which must reach the model verbatim.
    const isA2uiAction = bodyContent.includes('"a2ui_action"');
    let messageContent = bodyContent;
    if (skillSlug) {
      messageContent = `[请使用「${skillSlug}」技能完成本次请求]\n\n${bodyContent}`;
    } else if (!isA2uiAction) {
      const hint = this.isTeamLead(botId)
        ? TEAM_LEAD_HINT
        : EXPERT_ROUTING_HINT;
      messageContent = `${hint}\n\n${bodyContent}`;
    }

    logger.info(
      {
        route: "chat.sendLocalMessage",
        botId,
        effectiveSessionKey,
        messageType: message.type,
        imageAttachments: imageAttachments.length,
        fileAttachments: fileAttachments.length,
        filePersisted: fileResults.filter((r) => r.ok).length,
      },
      "sending local chat via main session",
    );

    // Send via Gateway using chat.send — queues message to agent main session.
    // Throws on failure; the route handler will propagate a 500 to the client.
    const result = await this.sendToMainSession({
      botId,
      sessionKey: effectiveSessionKey,
      message: messageContent,
      messageType: message.type,
      metadata: message.metadata,
      attachments: imageAttachments.map((att) => ({
        type: "image" as const,
        content: att.content,
        metadata: att.metadata,
      })),
    });

    return {
      id: result.messageId ?? `local_${Date.now()}`,
      runId: result.runId ?? null,
      role: "assistant",
      type: message.type,
      content: result.content ?? null,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };
  }

  private async sendToMainSession(
    input: SendToMainSessionInput,
  ): Promise<SendToMainSessionResult> {
    return this.gatewayService.sendToMainSession({
      botId: input.botId,
      sessionKey: input.sessionKey,
      message: input.message,
      messageType: input.messageType as
        | "text"
        | "image"
        | "video"
        | "audio"
        | "file",
      metadata: input.metadata as Record<string, unknown> | undefined,
      attachments: input.attachments?.map((a) => ({
        type: a.type,
        data: a.content,
        mimeType: a.metadata?.mimeType,
        filename: a.metadata?.filename,
      })),
    });
  }
}
