import fs from "node:fs";
import path from "node:path";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { sessionResponseSchema } from "@nexu/shared";
import { streamSSE } from "hono/streaming";
import type { ControllerContainer } from "../app/container.js";
import { ChatService } from "../services/chat-service.js";
import type { ControllerBindings } from "../types.js";

// ~10 MB base64 cap → raw file ≈ 7.5 MB; prevents OOM/body-size attacks
const MAX_ATTACHMENT_CONTENT_BYTES = 10_000_000;

const chatAttachmentSchema = z.object({
  // Images go through OpenClaw's chat.send attachments pipeline unchanged.
  // Files (PDF / text-readable) are extracted on the controller and folded
  // into message text as <file>…</file> blocks before forwarding; OpenClaw's
  // gateway RPC itself only carries images over the wire.
  type: z.enum(["image", "file"]),
  content: z.string().max(MAX_ATTACHMENT_CONTENT_BYTES),
  metadata: z
    .object({
      mimeType: z.string().optional(),
      filename: z.string().optional(),
      size: z.number().optional(),
    })
    .optional(),
});

const localChatMessageInputSchema = z.object({
  type: z.enum(["text", "image", "video", "audio", "file"]),
  content: z.string().max(MAX_ATTACHMENT_CONTENT_BYTES),
  metadata: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.number().optional(),
      mimeType: z.string().optional(),
      filename: z.string().optional(),
      size: z.number().optional(),
    })
    .optional(),
  /** Optional additional attachments for multipart (text + images/files) messages */
  attachments: z.array(chatAttachmentSchema).optional(),
});

const localChatMessageOutputSchema = z.object({
  id: z.string(),
  role: z.string(),
  type: z.string(),
  content: z.unknown(),
  timestamp: z.number().nullable(),
  createdAt: z.string().nullable(),
});

export function registerChatRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  const chatService = new ChatService(
    container.gatewayService,
    container.attachmentStore,
  );

  // GET /api/v1/chat/session - Resolve a named sessionKey to a real session
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/chat/session",
      tags: ["Chat"],
      request: {
        query: z.object({
          botId: z.string(),
          sessionKey: z.string(),
        }),
      },
      responses: {
        200: {
          description: "Session resolved from sessionKey",
          content: {
            "application/json": {
              schema: z.object({
                session: sessionResponseSchema.nullable(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { botId, sessionKey } = c.req.valid("query");
      const session = await container.sessionService.getSessionBySessionKey(
        botId,
        sessionKey,
      );
      return c.json({ session });
    },
  );

  // POST /api/v1/chat/local - Send local chat message (direct to main session)
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/chat/local",
      tags: ["Chat"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                botId: z.string(),
                sessionKey: z.string(),
                message: localChatMessageInputSchema,
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Local chat message sent",
          content: {
            "application/json": {
              schema: z.object({
                session: sessionResponseSchema.nullable(),
                message: localChatMessageOutputSchema,
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { botId, message, sessionKey } = c.req.valid("json");

      const result = await chatService.sendLocalMessage(
        botId,
        message,
        sessionKey,
      );

      // OpenClaw writes sessions.json asynchronously after chat.send returns.
      // Give it up to ~1 s (2 attempts × 500 ms) to flush the index before
      // returning null to the client (which then runs its own discovery loop).
      const lookupKey = sessionKey || `agent:${botId}:main`;
      let session: Awaited<
        ReturnType<typeof container.sessionService.getSessionBySessionKey>
      > = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        session = await container.sessionService.getSessionBySessionKey(
          botId,
          lookupKey,
        );
        if (session) break;
      }

      return c.json({
        session,
        message: result,
      });
    },
  );

  // POST /api/v1/chat/cancel - Abort active runs for a chat session
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/chat/cancel",
      tags: ["Chat"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                botId: z.string(),
                sessionKey: z.string(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Chat session aborted",
          content: {
            "application/json": {
              schema: z.object({
                ok: z.boolean(),
                aborted: z.boolean(),
                runIds: z.array(z.string()),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { botId, sessionKey } = c.req.valid("json");
      const lookupKey = sessionKey || `agent:${botId}:main`;
      const result = await container.gatewayService.abortChatSession(lookupKey);
      return c.json(result);
    },
  );

  // GET /api/v1/chat/history - Full aggregated message history across all
  // compacted sessions for a bot's main webchat conversation.
  // When OpenClaw performs context compaction it creates a new UUID-named JSONL
  // and leaves previous session files orphaned on disk.  This endpoint collects
  // all such orphaned files plus the current main session file, sorts them
  // chronologically, and returns the concatenated message list — giving the
  // frontend a single continuous timeline regardless of how many compactions
  // have occurred.
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/chat/history",
      tags: ["Chat"],
      request: {
        query: z.object({
          botId: z.string(),
          limit: z.coerce.number().int().min(1).max(2000).optional(),
        }),
      },
      responses: {
        200: {
          description:
            "Full conversation history aggregated across all compacted sessions",
          content: {
            "application/json": {
              schema: z.object({
                messages: z.array(
                  z.object({
                    id: z.string(),
                    role: z.enum(["user", "assistant"]),
                    content: z.unknown(),
                    timestamp: z.number().nullable(),
                    createdAt: z.string().nullable(),
                  }),
                ),
                sessionCount: z.number(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { botId, limit } = c.req.valid("query");
      const result = await container.sessionService.getFullMainChatHistory(
        botId,
        limit,
      );
      return c.json(result);
    },
  );

  // GET /api/v1/chat/stream — SSE endpoint for real-time message delivery.
  // Uses plain app.get() because SSE streaming is incompatible with OpenAPI
  // response schemas. Input parameters are still validated with Zod.
  app.get("/api/v1/chat/stream", async (c) => {
    const rawBotId = c.req.query("botId");
    const rawSessionKey = c.req.query("sessionKey");

    const parsed = z
      .object({
        botId: z.string().min(1),
        sessionKey: z.string().min(1),
      })
      .safeParse({ botId: rawBotId, sessionKey: rawSessionKey });
    if (!parsed.success) {
      return c.json({ message: "Invalid botId or sessionKey" }, 400);
    }
    const { botId, sessionKey } = parsed.data;

    const PATH_TRAVERSAL_RE = /[/\\]|\.\./;
    if (PATH_TRAVERSAL_RE.test(botId) || PATH_TRAVERSAL_RE.test(sessionKey)) {
      return c.json({ message: "Invalid botId or sessionKey" }, 400);
    }

    const stateDir = path.resolve(container.env.openclawStateDir);
    const sessionsDir = path.join(stateDir, "agents", botId, "sessions");
    const indexPath = path.join(sessionsDir, "sessions.json");

    let jsonlPath: string | null = null;
    try {
      const raw = fs.readFileSync(indexPath, "utf8");
      const index = JSON.parse(raw);
      const entry = index[sessionKey];
      if (entry) {
        let fileRef: string | null = null;
        if (typeof entry.sessionFile === "string" && entry.sessionFile.trim()) {
          fileRef = entry.sessionFile;
        } else if (
          typeof entry.sessionId === "string" &&
          entry.sessionId.trim()
        ) {
          fileRef = `${entry.sessionId}.jsonl`;
        }
        if (fileRef) {
          const resolved = path.resolve(sessionsDir, path.basename(fileRef));
          if (
            resolved.startsWith(sessionsDir + path.sep) ||
            resolved === sessionsDir
          ) {
            jsonlPath = resolved;
          }
        }
      }
    } catch {
      return c.json({ message: "Session not found" }, 404);
    }

    if (!jsonlPath) {
      return c.json({ message: "Session not found" }, 404);
    }
    const resolvedJsonl = jsonlPath;

    let lastSize = 0;
    try {
      lastSize = fs.statSync(resolvedJsonl).size;
    } catch {
      return c.json({ message: "Session file not found" }, 404);
    }

    const MAX_READ_PER_POLL = 1_048_576;

    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      await stream.writeSSE({ data: "connected", event: "connected" });

      const interval = setInterval(() => {
        if (aborted) {
          clearInterval(interval);
          return;
        }
        try {
          const currentSize = fs.statSync(resolvedJsonl).size;
          if (currentSize <= lastSize) return;

          const delta = currentSize - lastSize;
          const readLen = Math.min(delta, MAX_READ_PER_POLL);
          const fd = fs.openSync(resolvedJsonl, "r");
          const buf = Buffer.alloc(readLen);
          fs.readSync(fd, buf, 0, readLen, lastSize);
          fs.closeSync(fd);

          lastSize =
            delta > MAX_READ_PER_POLL ? lastSize + readLen : currentSize;

          const newContent = buf.toString("utf8");
          for (const line of newContent.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const entry = JSON.parse(trimmed) as {
                type?: string;
                id?: string;
                timestamp?: string;
                message?: {
                  role?: string;
                  content?: unknown;
                  timestamp?: number;
                };
              };
              if (entry.type === "message" && entry.message) {
                void stream.writeSSE({
                  data: JSON.stringify({
                    id: entry.id ?? "",
                    role: entry.message.role ?? "assistant",
                    content: entry.message.content,
                    timestamp:
                      entry.message.timestamp ??
                      (entry.timestamp
                        ? new Date(entry.timestamp).getTime()
                        : null),
                    createdAt: entry.timestamp ?? null,
                  }),
                  event: "message",
                });
              }
            } catch {
              // skip malformed lines
            }
          }

          // Keep-alive ping every 30s
        } catch {
          // stat / read may fail if file is rotated mid-poll; retry next tick
        }
      }, 1000);

      // Keep-alive
      const pingInterval = setInterval(() => {
        if (aborted) {
          clearInterval(pingInterval);
          return;
        }
        void stream.writeSSE({ data: "ping", event: "ping" });
      }, 30000);

      stream.onAbort(() => {
        clearInterval(interval);
        clearInterval(pingInterval);
      });
    });
  });
}
