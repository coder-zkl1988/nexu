import { describe, expect, it, vi } from "vitest";
import { OpenClawGatewayService } from "../../apps/controller/src/services/openclaw-gateway-service.js";
import type { OpenClawWsClient } from "../../apps/controller/src/services/openclaw-ws-client.js";

function serviceWith(request: (method: string, params: unknown) => unknown) {
  return new OpenClawGatewayService({
    request: vi.fn(async (method: string, params: unknown) =>
      request(method, params),
    ),
  } as unknown as OpenClawWsClient);
}

describe("OpenClawGatewayService.sessionHasActiveRun", () => {
  it("is true only for the exact session key with an active run", async () => {
    const service = serviceWith(() => ({
      sessions: [
        { key: "agent:bot-1:main", hasActiveRun: false },
        { key: "agent:bot-1:direct:ou_x", hasActiveRun: true },
      ],
    }));

    await expect(
      service.sessionHasActiveRun("agent:bot-1:direct:ou_x"),
    ).resolves.toBe(true);
    await expect(service.sessionHasActiveRun("agent:bot-1:main")).resolves.toBe(
      false,
    );
  });

  it("treats a key that only search-matched another row as idle", async () => {
    // `search` narrows but can still return sibling rows; only an exact key
    // match may count, otherwise a parent key would inherit a child's run.
    const service = serviceWith(() => ({
      sessions: [{ key: "agent:bot-1:direct:ou_x", hasActiveRun: true }],
    }));

    await expect(service.sessionHasActiveRun("agent:bot-1")).resolves.toBe(
      false,
    );
  });

  it("degrades to idle when the gateway call fails", async () => {
    const service = serviceWith(() => {
      throw new Error("gateway down");
    });

    await expect(service.sessionHasActiveRun("agent:bot-1:main")).resolves.toBe(
      false,
    );
  });
});

describe("OpenClawGatewayService.listAgentDirectDmPeers", () => {
  it("parses, dedupes and sorts direct-DM peers, ignoring deeper suffixes", async () => {
    const service = serviceWith(() => ({
      sessions: [
        { key: "agent:bot-1:direct:ou_old", updatedAt: 100 },
        { key: "agent:bot-1:direct:ou_new", updatedAt: 900 },
        // Same peer seen twice — the newer timestamp must win.
        { key: "agent:bot-1:direct:ou_old", updatedAt: 500 },
        // Not plain DMs: must not become candidates.
        { key: "agent:bot-1:main", updatedAt: 999 },
        { key: "agent:bot-1:direct:ou_x:thread:1", updatedAt: 999 },
      ],
    }));

    await expect(service.listAgentDirectDmPeers("bot-1")).resolves.toEqual([
      { openId: "ou_new", lastActiveAt: 900 },
      { openId: "ou_old", lastActiveAt: 500 },
    ]);
  });
});
