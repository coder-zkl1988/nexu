import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { registerAgentBrowserRoutes } from "../src/routes/agent-browser-routes.js";
import { AgentBrowserBridge } from "../src/services/agent-browser-bridge.js";
import type { ControllerBindings } from "../src/types.js";

/**
 * A shutting-down controller must destroy its agent-browser stream, not wait
 * for it.
 *
 * `server.close()` waits for every connection to drain and an SSE stream never
 * drains. Measured live: SIGTERM closed the listener, the drain never ended,
 * `process.exit` was never reached — and the zombie kept pinging the desktop's
 * relay from beyond the grave. The relay saw a perfectly live stream, so it
 * never reconnected, while every /act request went to the successor controller
 * and found no subscriber. The agent's browser was gone until the desktop was
 * restarted.
 */

describe("agent browser stream on controller shutdown", () => {
  it("terminates an open stream when connections are force-closed", async () => {
    const app = new OpenAPIHono<ControllerBindings>();
    registerAgentBrowserRoutes(app, {
      agentBrowserBridge: new AgentBrowserBridge(),
    } as ControllerContainer);

    const server = (await new Promise((resolve) => {
      const started = serve(
        { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
        () => resolve(started),
      );
    })) as Server;
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("no server address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/browser/agent/stream`,
      { headers: { accept: "text/event-stream" } },
    );
    expect(response.ok).toBe(true);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no stream body");
    // The stream is live — the `connected` frame arrives.
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("connected");

    // The shutdown sequence under test: stop listening, then destroy what
    // `close()` would otherwise wait on forever.
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server.closeAllConnections();

    // Both sides must come free promptly: the server's close callback fires
    // instead of hanging, and the client's read settles instead of pinning a
    // relay to a dead controller.
    await expect(
      Promise.race([
        closed,
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("server.close still waiting")),
            2_000,
          ),
        ),
      ]),
    ).resolves.toBeUndefined();
    await expect(
      Promise.race([
        reader.read().then(
          () => undefined,
          () => undefined,
        ),
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("client read still pending")),
            2_000,
          ),
        ),
      ]),
    ).resolves.toBeUndefined();
  });

  it("keeps the shutdown path force-closing connections", () => {
    // Pins the wiring in index.ts: remove `closeAllConnections` from the
    // shutdown sequence and an open SSE stream turns a controller restart
    // into the zombie scenario above.
    const source = readFileSync(
      path.resolve(__dirname, "../src/index.ts"),
      "utf8",
    );
    expect(source).toContain("closeAllConnections");
  });
});
