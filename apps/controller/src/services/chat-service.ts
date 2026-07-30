import { readFile } from "node:fs/promises";
import { CHAT_ATTACHMENT_LIMITS } from "@nexu/shared";
import { logger } from "../lib/logger.js";
import {
  type AttachmentExtractResult,
  extractAttachmentText,
} from "./attachment-extractor.js";
import type {
  AttachmentStore,
  ImportedStagedAttachmentResult,
  SaveAttachmentResult,
} from "./attachment-store.js";
import type { OpenClawGatewayService } from "./openclaw-gateway-service.js";
import {
  SessionBusyError,
  type SessionRunRegistry,
  isSessionLockedError,
} from "./session-run-registry.js";

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

function persistedAttachmentKind(
  filename: string | undefined,
  isDirectory = false,
): "office" | "pdf" | "directory" | "other" {
  if (isDirectory) return "directory";
  const normalized = filename?.trim().toLowerCase() ?? "";
  if (/\.(?:docx|xlsx|pptx)$/u.test(normalized)) return "office";
  if (normalized.endsWith(".pdf")) return "pdf";
  return "other";
}

function decodedBase64Size(content: string): number {
  const payload = content.includes(",")
    ? (content.split(",").pop() ?? content)
    : content;
  return Buffer.byteLength(payload, "base64");
}

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
  type: "image" | "file" | "directory";
  content?: string;
  stagedPath?: string;
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
    private readonly runRegistry: SessionRunRegistry,
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

    // Per-session serialization: OpenClaw guards each session transcript with a
    // 60s-timeout file lock that a turn holds for its whole duration (a
    // multi-device tool can block the agent for minutes). Submitting a second
    // turn while one is active makes OpenClaw's lock acquisition time out and
    // fail with "session file locked" → "Agent failed before reply". Reject fast
    // with a friendly signal instead of hanging 60s then surfacing the raw error.
    if (this.runRegistry.isBusy(effectiveSessionKey)) {
      logger.info(
        { botId, effectiveSessionKey },
        "chat.local: rejected — a run is already active for this session",
      );
      throw new SessionBusyError(effectiveSessionKey);
    }
    // Optimistic mark closes the tiny window between the busy-check and the
    // send. A terminal chat event clears it on normal completion; the catch
    // below releases it if this turn never actually got going.
    this.runRegistry.markStarted(effectiveSessionKey);
    try {
      const result = await this.deliverLocalMessage(
        botId,
        message,
        effectiveSessionKey,
      );
      if (result.runId) {
        this.runRegistry.attachRunId(effectiveSessionKey, result.runId);
      }
      return result;
    } catch (err) {
      this.runRegistry.releasePendingStart(effectiveSessionKey);
      if (isSessionLockedError(err)) {
        // Backstop: our tracker missed an in-flight run (e.g. a background /
        // automation turn) and OpenClaw rejected with the raw lock error.
        // Surface the same friendly busy signal, not "Agent failed before reply".
        logger.info(
          { botId, effectiveSessionKey },
          "chat.local: gateway reported session file locked — mapping to busy",
        );
        throw new SessionBusyError(effectiveSessionKey);
      }
      throw err;
    }
  }

  private async deliverLocalMessage(
    botId: string,
    message: LocalChatMessageInput,
    effectiveSessionKey: string,
  ): Promise<LocalChatMessageOutput> {
    const incomingAttachments = message.attachments ?? [];
    if (incomingAttachments.length > CHAT_ATTACHMENT_LIMITS.maxCount) {
      throw new Error(
        `You can attach up to ${CHAT_ATTACHMENT_LIMITS.maxCount} items at once`,
      );
    }
    const imageAttachments: LocalChatAttachment[] = [];
    const fileAttachments: LocalChatAttachment[] = [];
    for (const att of incomingAttachments) {
      if (att.type === "image") imageAttachments.push(att);
      else fileAttachments.push(att);
    }

    const gatewayImageAttachments: Array<{
      type: "image";
      content: string;
      metadata?: LocalChatAttachment["metadata"];
    }> = [];

    const fileResults: AttachmentExtractResult[] = [];
    let persistedFileCount = 0;
    let attachmentBytes = 0;
    const persistedKinds = new Set<"office" | "pdf" | "directory" | "other">();
    const importedStagedAttachments: ImportedStagedAttachmentResult[] = [];
    let deliveryCommitted = false;

    const assertWithinMessageBudget = (additionalBytes: number) => {
      if (
        attachmentBytes + additionalBytes >
        CHAT_ATTACHMENT_LIMITS.maxTotalBytes
      ) {
        throw new Error("Attachments exceed the 500 MB total limit");
      }
    };

    try {
      for (const attachment of imageAttachments) {
        if (attachment.content) {
          const sizeBytes = decodedBase64Size(attachment.content);
          if (sizeBytes > CHAT_ATTACHMENT_LIMITS.maxImageBytes) {
            throw new Error("Image attachment exceeds the 25 MB limit");
          }
          assertWithinMessageBudget(sizeBytes);
          attachmentBytes += sizeBytes;
          gatewayImageAttachments.push({
            type: "image",
            content: attachment.content,
            metadata: { ...attachment.metadata, size: sizeBytes },
          });
          continue;
        }
        if (!attachment.stagedPath) continue;
        const saved = await this.attachmentStore.importStagedAttachment({
          botId,
          sessionKey: effectiveSessionKey,
          stagedPath: attachment.stagedPath,
          filename: attachment.metadata?.filename,
          kind: "file",
          maxBytes: Math.min(
            CHAT_ATTACHMENT_LIMITS.maxImageBytes,
            CHAT_ATTACHMENT_LIMITS.maxTotalBytes - attachmentBytes,
          ),
        });
        importedStagedAttachments.push(saved);
        assertWithinMessageBudget(saved.sizeBytes);
        attachmentBytes += saved.sizeBytes;
        gatewayImageAttachments.push({
          type: "image",
          content: (await readFile(saved.absolutePath)).toString("base64"),
          metadata: {
            ...attachment.metadata,
            size: saved.sizeBytes,
          },
        });
        persistedFileCount += 1;
      }

      if (fileAttachments.length > 0) {
        // Persist first so we have a `path` to embed in the `<file>` block.
        // Extraction runs concurrently once each file is on disk.
        const extractionInputs: Array<
          Parameters<typeof extractAttachmentText>[0]
        > = [];
        for (const attachment of fileAttachments) {
          let storedPath: string | undefined;
          let storedSize = attachment.metadata?.size;
          if (!attachment.stagedPath && attachment.content) {
            assertWithinMessageBudget(decodedBase64Size(attachment.content));
          }
          try {
            let saved: SaveAttachmentResult;
            if (attachment.stagedPath) {
              const imported =
                await this.attachmentStore.importStagedAttachment({
                  botId,
                  sessionKey: effectiveSessionKey,
                  stagedPath: attachment.stagedPath,
                  filename: attachment.metadata?.filename,
                  kind: attachment.type === "directory" ? "directory" : "file",
                  maxBytes:
                    CHAT_ATTACHMENT_LIMITS.maxTotalBytes - attachmentBytes,
                });
              importedStagedAttachments.push(imported);
              saved = imported;
            } else {
              saved = await this.attachmentStore.saveAttachment({
                botId,
                sessionKey: effectiveSessionKey,
                base64: attachment.content ?? "",
                filename: attachment.metadata?.filename,
                mimeType:
                  attachment.metadata?.mimeType ?? "application/octet-stream",
              });
            }
            assertWithinMessageBudget(saved.sizeBytes);
            attachmentBytes += saved.sizeBytes;
            storedPath = saved.absolutePath;
            storedSize = saved.sizeBytes;
            persistedFileCount += 1;
            persistedKinds.add(
              persistedAttachmentKind(
                attachment.metadata?.filename,
                attachment.type === "directory",
              ),
            );
          } catch (error) {
            if (attachment.stagedPath) throw error;
            logger.warn(
              {
                filename: attachment.metadata?.filename,
                error: error instanceof Error ? error.message : String(error),
              },
              "chat.local: attachment persistence failed; falling back to preview-only",
            );
          }
          extractionInputs.push({
            content: attachment.content,
            mimeType:
              attachment.metadata?.mimeType ?? "application/octet-stream",
            filename: attachment.metadata?.filename,
            size: storedSize,
            mode: "preview",
            storedPath,
            kind: attachment.type === "directory" ? "directory" : "file",
          });
        }
        const perFile = await Promise.all(
          extractionInputs.map((input) => extractAttachmentText(input)),
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

      if (persistedKinds.has("office")) {
        appendedBlocks.push(
          "[Tool hint: Office attachments above include a `path` attribute. " +
            "Use the `officecli` skill with `$OFFICECLI_BIN` to read, edit, " +
            "validate, and render DOCX/XLSX/PPTX files. Preserve the source and " +
            "write final deliverables under `$OPENCLAW_STATE_DIR/media/officecli/`.]",
        );
      }
      if (persistedKinds.has("pdf")) {
        appendedBlocks.push(
          "[Tool hint: PDF attachments above include a `path` attribute. " +
            "Use the `pdf` tool (pdf, pdfs, pages, prompt) with that path to " +
            "read specific pages or analyze the full document when the preview " +
            "is insufficient.]",
        );
      }
      if (persistedKinds.has("other")) {
        appendedBlocks.push(
          "[Tool hint: Other file attachments above include a `path` attribute. " +
            "Use an appropriate local file tool with that path rather than " +
            "guessing from the filename.]",
        );
      }
      if (persistedKinds.has("directory")) {
        appendedBlocks.push(
          "[Tool hint: Directory attachments above include a `path` attribute. " +
            "Inspect only the files needed for the task and preserve the directory structure in generated outputs.]",
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
          imageAttachments: gatewayImageAttachments.length,
          fileAttachments: fileAttachments.length,
          filePersisted: persistedFileCount,
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
        attachments: gatewayImageAttachments,
      });

      const output: LocalChatMessageOutput = {
        id: result.messageId ?? `local_${Date.now()}`,
        runId: result.runId ?? null,
        role: "assistant",
        type: message.type,
        content: result.content ?? null,
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      };
      deliveryCommitted = true;
      return output;
    } finally {
      if (!deliveryCommitted) {
        for (
          let index = importedStagedAttachments.length - 1;
          index >= 0;
          index -= 1
        ) {
          const imported = importedStagedAttachments[index];
          if (imported) {
            await this.attachmentStore.restoreStagedAttachment(imported);
          }
        }
      }
    }
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
