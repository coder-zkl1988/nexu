import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  agentBrowserActBodySchema,
  agentBrowserOutcomeSchema,
  agentBrowserResultAckSchema,
  agentBrowserResultBodySchema,
} from "@nexu/shared";
import { streamSSE } from "hono/streaming";
import type { ControllerContainer } from "../app/container.js";
import { logger } from "../lib/logger.js";
import {
  AgentBrowserTimeoutError,
  AgentBrowserUnavailableError,
} from "../services/agent-browser-bridge.js";
import type { ControllerBindings } from "../types.js";

/**
 * Agent control of the embedded browser.
 *
 *   nexu-browser plugin --POST /act--> controller --SSE--> desktop renderer
 *                       <--------- POST /result <---------
 *
 * The renderer executes because it owns the panel that gives the browser view
 * its bounds; see packages/shared/src/schemas/agent-browser.ts.
 */

const errorSchema = z.object({ message: z.string() });

/**
 * Second gate behind nexu-toolcall-guard's `before_tool_call` check. The guard
 * is the enforcement point (it also sees `channelId`, which never reaches
 * here), but a control plane that drives the user's logged-in browser should
 * not be one plugin misconfiguration away from open. Same key shape as
 * `isLocalInteractiveSession` in the guard.
 */
const LOCAL_SESSION_KEY = /^agent:[^:]+:(?:main|[0-9a-f]{8}-[0-9a-f-]{27})$/i;

export function isLocalDesktopSessionKey(sessionKey: string): boolean {
  return LOCAL_SESSION_KEY.test(sessionKey);
}

export function registerAgentBrowserRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  // The renderer's command stream. Not an OpenAPI route: the generated SDK has
  // no SSE client, and the web app opens it with EventSource directly.
  app.get("/api/v1/browser/agent/stream", (c) => {
    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      const unsubscribe = container.agentBrowserBridge.subscribe((message) => {
        if (aborted) return;
        const frame =
          message.kind === "command"
            ? { data: JSON.stringify(message.envelope), event: "command" }
            : {
                data: JSON.stringify({ sessionKey: message.sessionKey }),
                event: "run-ended",
              };
        void stream.writeSSE(frame).catch(() => {
          // Client is gone; the abort handler and unsubscribe clean up.
        });
      });

      await stream.writeSSE({ data: "connected", event: "connected" });
      while (!aborted) {
        await stream.writeSSE({ data: "ping", event: "ping" });
        await stream.sleep(15_000);
      }

      unsubscribe();
    });
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/browser/agent/act",
      tags: ["Browser"],
      request: {
        body: {
          content: {
            "application/json": { schema: agentBrowserActBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: agentBrowserOutcomeSchema },
          },
          description: "Command executed by the desktop browser panel",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not a local desktop session",
        },
        503: {
          content: { "application/json": { schema: errorSchema } },
          description: "No desktop browser panel is listening",
        },
        504: {
          content: { "application/json": { schema: errorSchema } },
          description: "The desktop browser panel did not answer in time",
        },
      },
    }),
    async (c) => {
      const { sessionKey, command } = c.req.valid("json");
      if (!isLocalDesktopSessionKey(sessionKey)) {
        return c.json(
          { message: "browser control is limited to the desktop main session" },
          403,
        );
      }
      try {
        const outcome = await container.agentBrowserBridge.dispatch(
          sessionKey,
          command,
        );
        return c.json(outcome, 200);
      } catch (error) {
        if (error instanceof AgentBrowserUnavailableError) {
          return c.json({ message: error.message }, 503);
        }
        if (error instanceof AgentBrowserTimeoutError) {
          return c.json({ message: error.message }, 504);
        }
        throw error;
      }
    },
  );

  // One-way signal from the nexu-browser plugin's agent_end hook: the run that
  // drove the browser is over, so the desktop can release the panel's agent
  // pin. Best-effort — a missed signal leaves the panel pinned, nothing worse.
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/browser/agent/run-ended",
      tags: ["Browser"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ sessionKey: z.string() }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ accepted: z.boolean() }),
            },
          },
          description: "Run-end signal forwarded to the desktop",
        },
      },
    }),
    (c) => {
      const { sessionKey } = c.req.valid("json");
      const accepted = container.agentBrowserBridge.notifyRunEnded(sessionKey);
      // The only observable trace of this one-way chain: plugin agent_end →
      // here → SSE → desktop → panel unpin. Without it, "the panel never
      // unpins" cannot be told apart from "the signal never arrived".
      logger.info(
        { sessionKey, accepted },
        "agent browser run-ended forwarded",
      );
      return c.json({ accepted }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/browser/agent/result",
      tags: ["Browser"],
      request: {
        body: {
          content: {
            "application/json": { schema: agentBrowserResultBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: agentBrowserResultAckSchema },
          },
          description: "Result recorded",
        },
      },
    }),
    (c) => {
      const { requestId, outcome } = c.req.valid("json");
      const accepted = container.agentBrowserBridge.settle(requestId, outcome);
      return c.json({ accepted }, 200);
    },
  );
}
