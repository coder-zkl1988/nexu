import { randomUUID } from "node:crypto";
import type { CreateSessionInput, UpdateSessionInput } from "@nexu/shared";
import { logger } from "../lib/logger.js";
import type { SessionsRuntime } from "../runtime/sessions-runtime.js";
import type { OpenClawGatewayService } from "./openclaw-gateway-service.js";

export class SessionService {
  constructor(
    private readonly sessionsRuntime: SessionsRuntime,
    /** Optional: session management RPC (rename/archive/fork) is skipped when absent. */
    private readonly gatewayService?: OpenClawGatewayService,
  ) {}

  async listSessions(params: {
    limit: number;
    offset: number;
    botId?: string;
    channelType?: string;
    status?: string;
  }) {
    let sessions = await this.sessionsRuntime.listSessions();

    if (params.botId) {
      sessions = sessions.filter((session) => session.botId === params.botId);
    }
    if (params.channelType) {
      sessions = sessions.filter(
        (session) => session.channelType === params.channelType,
      );
    }
    if (params.status) {
      sessions = sessions.filter((session) => session.status === params.status);
    }

    return {
      sessions: sessions.slice(params.offset, params.offset + params.limit),
      total: sessions.length,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async getSession(id: string) {
    return this.sessionsRuntime.getSession(id);
  }

  async createSession(input: CreateSessionInput) {
    return this.sessionsRuntime.createOrUpdateSession(input);
  }

  async updateSession(id: string, input: UpdateSessionInput) {
    const session = await this.sessionsRuntime.updateSession(id, input);
    // Mirror a rename into OpenClaw's session store label so gateway-side
    // views (Control UI, deriveSessionTitle) agree with nexu. Best-effort:
    // the .meta.json title above stays nexu's display authority.
    if (session && input.title && this.gatewayService?.isConnected()) {
      try {
        await this.gatewayService.sessionsPatch({
          key: session.sessionKey,
          agentId: session.botId,
          label: input.title,
        });
      } catch (err) {
        logger.warn(
          { id, error: err instanceof Error ? err.message : String(err) },
          "session_rename_gateway_label_patch_failed",
        );
      }
    }
    return session;
  }

  /**
   * Archive / unarchive via the OpenClaw session store (>=2026.7.1).
   * Archived sessions disappear from listSessions (index entry archivedAt).
   * Throws with OpenClaw's message when blocked (main session / active run).
   */
  async setSessionArchived(id: string, archived: boolean) {
    const session = await this.sessionsRuntime.getSession(id);
    if (!session) return null;
    if (!this.gatewayService?.isConnected()) {
      throw new Error("OpenClaw gateway is not connected");
    }
    await this.gatewayService.sessionsPatch({
      key: session.sessionKey,
      agentId: session.botId,
      archived,
    });
    return { ...session, archived };
  }

  /**
   * Fork a session (OpenClaw >=2026.7.1): creates a new session whose context
   * inherits from the parent chain. Materializes the forked session's
   * transcript file so it appears in the sidebar immediately.
   */
  async forkSession(id: string) {
    const session = await this.sessionsRuntime.getSession(id);
    if (!session) return null;
    if (!this.gatewayService?.isConnected()) {
      throw new Error("OpenClaw gateway is not connected");
    }
    const forkKey = `agent:${session.botId}:${randomUUID()}`;
    const created = await this.gatewayService.sessionsCreate({
      key: forkKey,
      agentId: session.botId,
      parentSessionKey: session.sessionKey,
    });
    const sessionFile = created.entry?.sessionFile;
    const forkTitle = `${session.title} · fork`;
    const materialized = await this.sessionsRuntime.materializeSessionFile(
      sessionFile,
      forkTitle,
    );
    return {
      id: materialized ?? "",
      botId: session.botId,
      sessionKey: created.key ?? forkKey,
      title: forkTitle,
    };
  }

  async resetSession(id: string) {
    return this.sessionsRuntime.resetSession(id);
  }

  async deleteSession(id: string) {
    return this.sessionsRuntime.deleteSession(id);
  }

  async getSessionBySessionKey(botId: string, sessionKey: string) {
    return this.sessionsRuntime.getSessionBySessionKey(botId, sessionKey);
  }

  async getChatHistory(id: string, limit?: number) {
    return this.sessionsRuntime.getChatHistory(id, limit);
  }

  async getChatHistoryBySessionKey(
    botId: string,
    sessionKey: string,
    limit?: number,
  ) {
    return this.sessionsRuntime.getChatHistoryBySessionKey(
      botId,
      sessionKey,
      limit,
    );
  }

  async getFullMainChatHistory(botId: string, limit?: number) {
    return this.sessionsRuntime.getFullMainChatHistory(botId, limit);
  }

  async appendCompatTranscript(input: {
    botId: string;
    sessionKey: string;
    title: string;
    channelType: string;
    channelId?: string | null;
    metadata?: Record<string, unknown>;
    userText: string;
    assistantText: string;
    provider?: string | null;
    model?: string | null;
    api?: string | null;
  }) {
    return this.sessionsRuntime.appendCompatTranscript(input);
  }
}
