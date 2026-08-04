import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The relay against a real HTTP controller stand-in.
 *
 * Every failure mode here was first hit live: a controller restart that left
 * the SSE socket open and silent while the agent's browser was simply gone, a
 * stream that ended without the relay coming back, commands answered into a
 * connection nobody read any more. The stand-in can do what the live stack
 * cannot — die, wedge, and come back on demand — so the reconnect behaviour
 * is pinned here instead of re-measured by hand after every change.
 */

const controlWindow = vi.fn();
const isAgentSharingAllowed = vi.fn(() => true);

vi.mock("../../apps/desktop/main/services/embedded-browser-manager", () => ({
  AGENT_TAB_ID: "agent",
  embeddedBrowserManager: {
    ensureAgentTab: vi.fn(),
    controlWindow: (...args: unknown[]) => controlWindow(...args),
    isAgentSharingAllowed: (...args: unknown[]) =>
      isAgentSharingAllowed(...args),
    isAgentTabPanelHosted: vi.fn(() => true),
    waitForAgentTabPanel: vi.fn(async () => true),
  },
}));

import { AgentBrowserRelay } from "../../apps/desktop/main/services/agent-browser-relay";

const TIMING = {
  reconnectDelayMs: 40,
  streamIdleTimeoutMs: 250,
  connectTimeoutMs: 1_000,
  settleMs: 10,
  panelWaitMs: 100,
};

type FakeController = {
  port: number;
  subscribers: () => number;
  totalSubscriptions: () => number;
  send: (envelope: unknown) => void;
  sendRunEnded: (sessionKey: string) => void;
  results: unknown[];
  close: () => Promise<void>;
};

async function startFakeController(port?: number): Promise<FakeController> {
  const streams = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  const results: unknown[] = [];
  let total = 0;

  const server: Server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      if (request.url?.endsWith("/stream")) {
        total += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("event: connected\ndata: connected\n\n");
        streams.add(response);
        request.on("close", () => streams.delete(response));
        return;
      }
      if (request.url?.endsWith("/result")) {
        let body = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        request.on("end", () => {
          results.push(JSON.parse(body));
          response.writeHead(200, { "content-type": "application/json" });
          response.end('{"accepted":true}');
        });
        return;
      }
      response.writeHead(404).end();
    },
  );
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => {
    server.listen(port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("no server address");
  }

  return {
    port: address.port,
    subscribers: () => streams.size,
    totalSubscriptions: () => total,
    send: (envelope) => {
      for (const stream of streams) {
        stream.write(`event: command\ndata: ${JSON.stringify(envelope)}\n\n`);
      }
    },
    sendRunEnded: (sessionKey) => {
      for (const stream of streams) {
        stream.write(
          `event: run-ended\ndata: ${JSON.stringify({ sessionKey })}\n\n`,
        );
      }
    },
    results,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

async function waitUntil(
  condition: () => boolean,
  what: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function createRelay(
  port: number,
  onRunEnded?: (sessionKey: string) => void,
): AgentBrowserRelay {
  return new AgentBrowserRelay({
    controllerBaseUrl: `http://127.0.0.1:${port}`,
    getWindow: () => ({ isDestroyed: () => false }) as unknown as BrowserWindow,
    onOpen: () => undefined,
    onRunEnded,
    timing: TIMING,
  });
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
  controlWindow.mockReset();
  isAgentSharingAllowed.mockReset();
  isAgentSharingAllowed.mockReturnValue(true);
});

describe("AgentBrowserRelay", () => {
  it("executes a command and posts the outcome back", async () => {
    const controller = await startFakeController();
    const relay = createRelay(controller.port);
    cleanups.push(
      () => controller.close(),
      () => relay.stop(),
    );
    controlWindow.mockResolvedValue({
      kind: "snapshot",
      url: "https://example.com/",
      title: "Example",
      truncated: false,
      nodes: [],
    });

    relay.start();
    await waitUntil(() => controller.subscribers() === 1, "subscription");
    controller.send({
      requestId: "r1",
      sessionKey: "agent:bot:main",
      command: { action: "snapshot" },
    });

    await waitUntil(() => controller.results.length === 1, "result POST");
    expect(controller.results[0]).toMatchObject({
      requestId: "r1",
      outcome: { ok: true, snapshot: { url: "https://example.com/" } },
    });
  });

  it("rejects browser commands after the user revokes sharing", async () => {
    const controller = await startFakeController();
    const relay = createRelay(controller.port);
    cleanups.push(
      () => controller.close(),
      () => relay.stop(),
    );
    isAgentSharingAllowed.mockReturnValue(false);

    relay.start();
    await waitUntil(() => controller.subscribers() === 1, "subscription");
    controller.send({
      requestId: "revoked-1",
      sessionKey: "agent:bot:main",
      command: { action: "snapshot" },
    });

    await waitUntil(() => controller.results.length === 1, "result POST");
    expect(controller.results[0]).toMatchObject({
      requestId: "revoked-1",
      outcome: {
        ok: false,
        error: expect.stringContaining("revoked by the user"),
      },
    });
    expect(controlWindow).not.toHaveBeenCalled();
  });

  it("reconnects after the controller closes the stream", async () => {
    const controller = await startFakeController();
    const relay = createRelay(controller.port);
    cleanups.push(
      () => controller.close(),
      () => relay.stop(),
    );

    relay.start();
    await waitUntil(() => controller.subscribers() === 1, "first subscription");
    await controller.close();
    const revived = await startFakeController(controller.port);
    cleanups.push(() => revived.close());

    // The relay must find the new instance on its own; nothing else will.
    await waitUntil(
      () => revived.subscribers() === 1,
      "resubscription to the revived controller",
    );
  });

  it("abandons a silently wedged stream via the idle watchdog", async () => {
    const controller = await startFakeController();
    const relay = createRelay(controller.port);
    cleanups.push(
      () => controller.close(),
      () => relay.stop(),
    );

    relay.start();
    await waitUntil(() => controller.subscribers() === 1, "subscription");
    // The wedge measured live: the socket stays open, nothing arrives, and
    // the pending read never settles. Only the idle watchdog can get out.
    await waitUntil(
      () => controller.totalSubscriptions() >= 2,
      "watchdog-driven resubscription",
    );
  });

  it("surfaces a run-ended signal without treating it as a command", async () => {
    const controller = await startFakeController();
    const ended: string[] = [];
    const relay = createRelay(controller.port, (sessionKey) =>
      ended.push(sessionKey),
    );
    cleanups.push(
      () => controller.close(),
      () => relay.stop(),
    );

    relay.start();
    await waitUntil(() => controller.subscribers() === 1, "subscription");
    controller.sendRunEnded("agent:bot:main");

    await waitUntil(() => ended.length === 1, "run-ended callback");
    expect(ended).toEqual(["agent:bot:main"]);
    // A run end must not produce a phantom command result.
    expect(controller.results).toEqual([]);
  });

  it("stays down after stop", async () => {
    const controller = await startFakeController();
    const relay = createRelay(controller.port);
    cleanups.push(() => controller.close());

    relay.start();
    await waitUntil(() => controller.subscribers() === 1, "subscription");
    relay.stop();

    await waitUntil(() => controller.subscribers() === 0, "stream release");
    // Give the reconnect delay several chances to fire wrongly.
    await new Promise((resolve) =>
      setTimeout(resolve, TIMING.reconnectDelayMs * 4),
    );
    expect(controller.subscribers()).toBe(0);
  });
});
