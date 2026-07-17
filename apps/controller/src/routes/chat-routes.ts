import fs from "node:fs";
import path from "node:path";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { sessionResponseSchema } from "@nexu/shared";
import { streamSSE } from "hono/streaming";
import type { ControllerContainer } from "../app/container.js";
import { logger } from "../lib/logger.js";
import { ChatService } from "../services/chat-service.js";
import { SessionBusyError } from "../services/session-run-registry.js";
import type { ControllerBindings } from "../types.js";
import {
  LOCAL_CHAT_SESSION_DISCOVERY_INTERVAL_MS,
  LOCAL_CHAT_SESSION_DISCOVERY_TIMEOUT_MS,
  waitForLocalChatSession,
} from "./local-chat-session-wait.js";

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
  /**
   * Optional skill the user picked in the composer.  Single-shot: the
   * controller folds it into the message text as a directive (OpenClaw's
   * chat.send has no skill param), then it is forgotten.
   */
  skillSlug: z.string().optional(),
});

const localChatSendBodySchema = z.object({
  botId: z.string(),
  sessionKey: z.string(),
  message: localChatMessageInputSchema,
});

const localChatMessageOutputSchema = z.object({
  id: z.string(),
  runId: z.string().nullable().optional(),
  role: z.string(),
  type: z.string(),
  content: z.unknown(),
  timestamp: z.number().nullable(),
  createdAt: z.string().nullable(),
});

// Returned when a turn is already running for the target session. A long turn
// (e.g. a multi-device tool) holds OpenClaw's session write-lock for minutes, so
// a concurrently-submitted message would time out on the lock and hard-fail with
// "session file locked". We reject fast with this friendly notice instead.
const SESSION_BUSY_MESSAGE = "上一条消息还在处理中，请等当前任务完成后再发送。";

export function registerChatRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  const chatService = new ChatService(
    container.gatewayService,
    container.attachmentStore,
    container.sessionRunRegistry,
    // Team leads get the team-engine hint instead of the expert-routing one.
    (botId) =>
      container.teamService
        .listTeams()
        .some((team) => team.leadBotId === botId),
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

  // POST /api/v1/chat/local/start - Send local chat message and return after
  // OpenClaw acknowledges chat.send. This is used by the new-conversation page
  // so it can leave the composer immediately while session indexing continues.
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/chat/local/start",
      tags: ["Chat"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: localChatSendBodySchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: "Local chat run started",
          content: {
            "application/json": {
              schema: z.object({
                sessionKey: z.string(),
                session: sessionResponseSchema.nullable(),
                message: localChatMessageOutputSchema.nullable(),
              }),
            },
          },
        },
        409: {
          description: "A run is already active for this session",
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
        },
      },
    }),
    async (c) => {
      const startedAt = Date.now();
      const { botId, message, sessionKey } = c.req.valid("json");
      const lookupKey = sessionKey || `agent:${botId}:main`;

      let messageResult: Awaited<
        ReturnType<typeof chatService.sendLocalMessage>
      >;
      try {
        messageResult = await chatService.sendLocalMessage(
          botId,
          message,
          lookupKey,
        );
      } catch (err) {
        if (err instanceof SessionBusyError) {
          return c.json({ message: SESSION_BUSY_MESSAGE }, 409);
        }
        throw err;
      }
      const session = await container.sessionService.getSessionBySessionKey(
        botId,
        lookupKey,
      );

      logger.info(
        {
          botId,
          sessionKey: lookupKey,
          runId: messageResult.runId ?? null,
          sessionFound: Boolean(session?.id),
          elapsedMs: Date.now() - startedAt,
        },
        "chat.local: run accepted",
      );

      return c.json(
        {
          sessionKey: lookupKey,
          session,
          message: messageResult,
        },
        200,
      );
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
              schema: localChatSendBodySchema,
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
                message: localChatMessageOutputSchema.nullable(),
              }),
            },
          },
        },
        409: {
          description: "A run is already active for this session",
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
        },
      },
    }),
    async (c) => {
      const { botId, message, sessionKey } = c.req.valid("json");
      const lookupKey = sessionKey || `agent:${botId}:main`;

      let messageResult: Awaited<
        ReturnType<typeof chatService.sendLocalMessage>
      >;
      try {
        messageResult = await chatService.sendLocalMessage(
          botId,
          message,
          lookupKey,
        );
      } catch (err) {
        if (err instanceof SessionBusyError) {
          return c.json({ message: SESSION_BUSY_MESSAGE }, 409);
        }
        throw err;
      }

      // OpenClaw acknowledges chat.send before the session index is written.
      // Wait long enough to cover cold run initialization, while the frontend
      // still keeps a sessionKey-based fallback for slower runs.
      const discovery = await waitForLocalChatSession({
        lookupSession: () =>
          container.sessionService.getSessionBySessionKey(botId, lookupKey),
      });

      if (discovery.timedOut) {
        logger.warn(
          {
            botId,
            sessionKey: lookupKey,
            attempts: discovery.attempts,
            elapsedMs: discovery.elapsedMs,
            timeoutMs: LOCAL_CHAT_SESSION_DISCOVERY_TIMEOUT_MS,
            intervalMs: LOCAL_CHAT_SESSION_DISCOVERY_INTERVAL_MS,
          },
          "chat.local: session discovery timed out",
        );
      } else {
        logger.info(
          {
            botId,
            sessionKey: lookupKey,
            attempts: discovery.attempts,
            elapsedMs: discovery.elapsedMs,
          },
          "chat.local: session discovered",
        );
      }

      return c.json(
        { session: discovery.session, message: messageResult },
        200,
      );
    },
  );

  // GET /api/v1/chat/run-status - Whether a turn is currently running for a
  // session (SessionRunRegistry view). Lets the composer show a stop button
  // for runs it did not initiate (A2UI actions, automations) instead of
  // bouncing sends off the 409 busy guard with no way to cancel.
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/chat/run-status",
      tags: ["Chat"],
      request: {
        query: z.object({
          botId: z.string(),
          sessionKey: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: "Active-run state for the session",
          content: {
            "application/json": {
              schema: z.object({ busy: z.boolean() }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { botId, sessionKey } = c.req.valid("query");
      const lookupKey = sessionKey || `agent:${botId}:main`;
      return c.json(
        { busy: container.sessionRunRegistry.isBusy(lookupKey) },
        200,
      );
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
                /**
                 * Also emergency-stop running device (phone) tasks. A device
                 * task dispatched by this run keeps executing on the phone
                 * after the agent run aborts; the composer's stop button opts
                 * in so "cancel the bot" really halts the phone too.
                 */
                stopDeviceTasks: z.boolean().optional(),
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
                deviceTasksCancelled: z.number(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { botId, sessionKey, stopDeviceTasks } = c.req.valid("json");
      const lookupKey = sessionKey || `agent:${botId}:main`;
      const result = await container.gatewayService.abortChatSession(lookupKey);
      // Clear the registry immediately: OpenClaw's aborted event can lag (or
      // never arrive when the run is stuck inside a blocking tool), and the
      // whole point of cancel is to unblock the composer.
      container.sessionRunRegistry.markFinished(lookupKey);

      let deviceTasksCancelled = 0;
      if (stopDeviceTasks) {
        try {
          const { devices } =
            await container.deviceControlService.listDevices();
          const busyDevices = devices.filter(
            (device) => device.status === "busy" && device.currentTaskId,
          );
          const results = await Promise.allSettled(
            busyDevices.map((device) =>
              container.deviceControlService.cancelTask(device.deviceId, {
                taskId: device.currentTaskId as string,
              }),
            ),
          );
          deviceTasksCancelled = results.filter(
            (entry) => entry.status === "fulfilled" && entry.value.cancelled,
          ).length;
        } catch (err) {
          logger.warn(
            {
              error: err instanceof Error ? err.message : String(err),
              sessionKey: lookupKey,
            },
            "chat_cancel_device_stop_failed",
          );
        }
      }

      return c.json({ ...result, deviceTasksCancelled });
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
                    role: z.enum(["user", "assistant", "toolResult"]),
                    content: z.unknown(),
                    timestamp: z.number().nullable(),
                    createdAt: z.string().nullable(),
                    toolName: z.string().optional(),
                    toolCallId: z.string().optional(),
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

  // GET /api/v1/chat/local/stream — SSE endpoint for real-time WS-based chat
  // events. Uses plain app.get() because SSE streaming is incompatible with
  // OpenAPI response schemas.
  app.get("/api/v1/chat/local/stream", async (c) => {
    const { botId, sessionKey, runId } = c.req.query();

    // Validate params
    if (!botId || !sessionKey) {
      return c.json({ error: "botId and sessionKey are required" }, 400);
    }

    let aborted = false;
    let streamCleanup: (() => void) | null = null;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        function send(event: string, data: string) {
          if (aborted) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
            );
          } catch {
            // Stream closed — no-op
          }
        }

        // Send connected event immediately
        send("connected", "connected");

        // Subscribe to WS chat events
        const unsubChat = container.wsClient.onChatEvent((payload: unknown) => {
          const evt = payload as Record<string, unknown>;
          if (runId && evt.runId !== runId) return;
          if (evt.sessionKey && evt.sessionKey !== sessionKey) return;

          const state = evt.state as string;
          if (state === "delta") {
            send(
              "delta",
              JSON.stringify({
                runId: evt.runId,
                seq: evt.seq,
                deltaText: evt.deltaText,
                replace: evt.replace ?? false,
              }),
            );
          } else if (state === "final") {
            send(
              "final",
              JSON.stringify({
                runId: evt.runId,
                seq: evt.seq,
                message: evt.message,
                stopReason: evt.stopReason,
              }),
            );
            // Don't close — there might be side_results after final
          } else if (state === "aborted") {
            send("aborted", JSON.stringify({ runId: evt.runId, seq: evt.seq }));
          } else if (state === "error") {
            send(
              "error",
              JSON.stringify({
                runId: evt.runId,
                seq: evt.seq,
                errorMessage: evt.errorMessage,
                errorKind: evt.errorKind,
              }),
            );
          }
        });

        const unsubSide = container.wsClient.onChatSideResult(
          (payload: unknown) => {
            const evt = payload as Record<string, unknown>;
            if (runId && evt.runId !== runId) return;
            send("side_result", JSON.stringify(evt));
          },
        );

        // Ping keepalive every 30s
        const pingInterval = setInterval(() => {
          send("ping", "");
        }, 30_000);

        streamCleanup = () => {
          unsubChat();
          unsubSide();
          clearInterval(pingInterval);
        };

        // Listen for client disconnect via the request abort signal
        c.req.raw.signal.addEventListener("abort", () => {
          aborted = true;
          streamCleanup?.();
        });
      },
      cancel() {
        aborted = true;
        streamCleanup?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });
}
