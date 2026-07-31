import type { OpenClawConfig } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import { OpenClawGatewayService } from "../src/services/openclaw-gateway-service.js";

function makeConfig(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    gateway: { port: 18789, mode: "local", bind: "127.0.0.1" },
    agents: { list: [], defaults: {} },
    channels: {},
    bindings: [],
    plugins: { load: { paths: [] }, entries: {} },
    skills: { load: { watch: true } },
    commands: { native: "auto" },
    ...overrides,
  } as OpenClawConfig;
}

describe("OpenClawGatewayService", () => {
  it("treats semantically identical configs as unchanged despite key reorder", async () => {
    const service = new OpenClawGatewayService({
      isConnected: () => true,
    } as never);

    const configA = makeConfig({
      plugins: {
        entries: {
          zed: { enabled: true },
          alpha: { enabled: true },
        },
        load: { paths: [] },
      },
    });
    const configB = makeConfig({
      plugins: {
        load: { paths: [] },
        entries: {
          alpha: { enabled: true },
          zed: { enabled: true },
        },
      },
    });

    service.noteConfigWritten(configA);

    await expect(service.shouldPushConfig(configB)).resolves.toBe(false);
  });

  describe("getAllChannelsLiveStatus gateway-offline reporting", () => {
    const channels = [
      { id: "ch1", channelType: "feishu", accountId: "feishu-acct" },
      { id: "ch2", channelType: "slack", accountId: "T0001" },
    ];

    it("reports connecting + configured when WS is not connected", async () => {
      const service = new OpenClawGatewayService({
        isConnected: () => false,
        request: vi.fn(),
      } as never);

      const result = await service.getAllChannelsLiveStatus(channels);

      expect(result.gatewayConnected).toBe(false);
      for (const entry of result.channels) {
        expect(entry.status).toBe("connecting");
        expect(entry.configured).toBe(true);
        expect(entry.connected).toBe(false);
        expect(entry.running).toBe(false);
        expect(entry.lastError).toBeNull();
      }
    });

    it("reports connecting + configured when the channels.status RPC throws", async () => {
      const service = new OpenClawGatewayService({
        isConnected: () => true,
        request: vi.fn(async () => {
          throw new Error("openclaw gateway not connected");
        }),
      } as never);

      const result = await service.getAllChannelsLiveStatus(channels);

      expect(result.gatewayConnected).toBe(false);
      for (const entry of result.channels) {
        expect(entry.status).toBe("connecting");
        expect(entry.configured).toBe(true);
        expect(entry.connected).toBe(false);
        expect(entry.running).toBe(false);
        expect(entry.lastError).toBeNull();
      }
    });
  });

  it("sends side questions through OpenClaw's isolated BTW lane", async () => {
    const request = vi.fn(async () => ({ runId: "side-run-1" }));
    const service = new OpenClawGatewayService({ request } as never);

    await expect(
      service.sendSideQuestion("agent:bot-1:main", "what is still running?"),
    ).resolves.toEqual({ runId: "side-run-1" });
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "agent:bot-1:main",
        message: "/btw what is still running?",
        deliver: false,
        idempotencyKey: expect.any(String),
      }),
      { timeoutMs: 130_000 },
    );
  });

  it("replaces the active run through OpenClaw's sessions.steer RPC", async () => {
    const request = vi.fn(async () => ({
      runId: "steer-command-1",
      interruptedActiveRun: true,
    }));
    const service = new OpenClawGatewayService({ request } as never);

    await expect(
      service.steerChatSession("agent:bot-1:main", "summarize findings now"),
    ).resolves.toEqual({
      runId: "steer-command-1",
      interruptedActiveRun: true,
    });

    expect(request).toHaveBeenCalledWith(
      "sessions.steer",
      expect.objectContaining({
        key: "agent:bot-1:main",
        message: "summarize findings now",
        idempotencyKey: expect.any(String),
      }),
      { timeoutMs: 130_000 },
    );
  });
});
