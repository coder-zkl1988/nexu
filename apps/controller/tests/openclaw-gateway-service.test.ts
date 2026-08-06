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

  it("queries the runtime-authenticated model catalog", async () => {
    const request = vi.fn(async () => ({
      models: [
        {
          id: "tabby-ultra",
          name: "tabby-ultra",
          provider: "link",
          api: "openai-completions",
          available: true,
          contextWindow: 258_000,
          reasoning: false,
          input: ["text", "image"],
          compat: { supportsStore: false },
        },
      ],
    }));
    const service = new OpenClawGatewayService({ request } as never);

    await expect(service.listModels("all")).resolves.toEqual({
      models: [
        expect.objectContaining({
          id: "tabby-ultra",
          provider: "link",
          available: true,
          contextWindow: 258_000,
        }),
      ],
    });
    expect(request).toHaveBeenCalledWith("models.list", { view: "all" });
  });

  it("rejects the obsolete key-based model catalog contract", async () => {
    const request = vi.fn(async () => ({
      models: [{ key: "link/tabby-ultra", available: true }],
    }));
    const service = new OpenClawGatewayService({ request } as never);

    await expect(service.listModels("configured")).rejects.toThrow();
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

  it("uses the OpenClaw operator RPCs for desktop operations", async () => {
    const request = vi.fn(async () => ({}));
    const service = new OpenClawGatewayService({ request } as never);

    await service.listExecApprovals();
    await service.listPluginApprovals();
    await service.resolveApproval({
      id: "approval-1",
      kind: "exec",
      decision: "allow-once",
    });
    await service.listTasks({ sessionKey: "agent:bot-1:main", limit: 20 });
    await service.cancelTask({ taskId: "task-1", reason: "Stopped by user" });
    await service.getSessionUsage({
      key: "agent:bot-1:main",
      includeContextWeight: true,
    });
    await service.getProviderUsage();
    await service.getMemoryStatus("bot-1");

    expect(request.mock.calls).toEqual([
      ["exec.approval.list", {}],
      ["plugin.approval.list", {}],
      ["exec.approval.resolve", { id: "approval-1", decision: "allow-once" }],
      ["tasks.list", { sessionKey: "agent:bot-1:main", limit: 20 }],
      ["tasks.cancel", { taskId: "task-1", reason: "Stopped by user" }],
      [
        "sessions.usage",
        {
          key: "agent:bot-1:main",
          includeContextWeight: true,
          groupBy: "instance",
          limit: 1,
        },
      ],
      ["usage.status", {}],
      ["doctor.memory.status", { agentId: "bot-1" }],
    ]);
  });
});
