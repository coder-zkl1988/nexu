import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import type { ControllerEnv } from "#controller/app/env";
import { createRuntimeState } from "#controller/runtime/state";
import { ChannelService } from "#controller/services/channel-service";
import { NexuConfigStore } from "#controller/store/nexu-config-store";

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `nexu-feishu-perms-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createEnv(homeDir: string): ControllerEnv {
  const openclawStateDir = resolve(homeDir, "runtime", "openclaw", "state");
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://nexu.io",
    nexuLinkUrl: null,
    nexuHomeDir: homeDir,
    nexuConfigPath: resolve(homeDir, "config.json"),
    artifactsIndexPath: resolve(homeDir, "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: resolve(homeDir, "compiled-openclaw.json"),
    openclawStateDir,
    openclawConfigPath: resolve(openclawStateDir, "openclaw.json"),
    openclawSkillsDir: resolve(openclawStateDir, "skills"),
    userSkillsDir: "/tmp/.agents/skills",
    openclawExtensionsDir: resolve(openclawStateDir, "extensions"),
    runtimePluginTemplatesDir: resolve(homeDir, "runtime-plugins"),
    openclawRuntimeModelStatePath: resolve(
      openclawStateDir,
      "nexu-runtime-model.json",
    ),
    skillhubCacheDir: resolve(homeDir, "skillhub-cache"),
    skillDbPath: resolve(homeDir, "skill-ledger.json"),
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir: resolve(
      openclawStateDir,
      "workspace-templates",
    ),
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: undefined,
    manageOpenclawProcess: false,
    gatewayProbeEnabled: true,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
    analyticsStatePath: resolve(homeDir, "analytics-state.json"),
  } as ControllerEnv;
}

type Noop = () => void;

function makeService(
  env: ControllerEnv,
  store: NexuConfigStore,
  syncAll: Noop = () => {},
): { service: ChannelService; syncAll: ReturnType<typeof vi.fn> } {
  const syncFn = vi.fn(async () => {
    syncAll();
  });
  const syncService = {
    syncAll: syncFn,
  } as unknown as ConstructorParameters<typeof ChannelService>[2];
  const gatewayService = {} as unknown as ConstructorParameters<
    typeof ChannelService
  >[3];
  const openclawProcess = {} as unknown as ConstructorParameters<
    typeof ChannelService
  >[4];
  const runtimeHealth = {} as unknown as ConstructorParameters<
    typeof ChannelService
  >[5];
  const wsClient = {} as unknown as ConstructorParameters<
    typeof ChannelService
  >[6];
  const service = new ChannelService(
    env,
    store,
    syncService,
    gatewayService,
    openclawProcess,
    runtimeHealth,
    wsClient,
  );
  return { service, syncAll: syncFn };
}

describe("ChannelService.updateFeishuPermissions (service-level)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("updates feishu permissions and triggers sync", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    const bot = await store.createBot({ name: "Bot A", slug: "bot-a" });
    const channel = await store.connectFeishu({
      appId: "cli_feishu_app",
      appSecret: "feishu-secret",
      botId: bot.id,
    });

    const { service, syncAll } = makeService(env, store);
    const updated = await service.updateFeishuPermissions(channel.id, {
      requireMention: false,
      dmPolicy: "disabled",
      groupPolicy: "open",
      allowFrom: [],
    });

    expect(updated.id).toBe(channel.id);
    expect(updated.feishuPermissions).toEqual({
      requireMention: false,
      dmPolicy: "disabled",
      groupPolicy: "open",
      allowFrom: [],
    });
    expect(syncAll).toHaveBeenCalledTimes(1);

    const reread = await store.getChannel(channel.id);
    expect(reread?.feishuPermissions?.requireMention).toBe(false);
  });

  it("throws when channel is not a feishu channel", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);
    const bot = await store.createBot({ name: "Bot A", slug: "bot-a" });
    const channel = await store.connectWechat({
      accountId: "wechat-1",
      botId: bot.id,
    });

    const { service, syncAll } = makeService(env, store);
    await expect(
      service.updateFeishuPermissions(channel.id, {
        requireMention: true,
        dmPolicy: "open",
        groupPolicy: "open",
        allowFrom: [],
      }),
    ).rejects.toThrow(/Not a Feishu channel/);
    expect(syncAll).not.toHaveBeenCalled();
  });

  it("throws when channelId is unknown", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    const { service, syncAll } = makeService(env, store);
    await expect(
      service.updateFeishuPermissions("channel_does_not_exist", {
        requireMention: true,
        dmPolicy: "open",
        groupPolicy: "open",
        allowFrom: [],
      }),
    ).rejects.toThrow(/Channel not found/);
    expect(syncAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HTTP-level tests
// ---------------------------------------------------------------------------

function makeChannelRecord(overrides: Partial<Record<string, unknown>> = {}) {
  const iso = new Date().toISOString();
  return {
    id: "ch-1",
    botId: "bot-a",
    channelType: "feishu",
    accountId: "acct-1",
    status: "connected",
    teamName: null,
    appId: null,
    botUserId: null,
    feishuPermissions: {
      requireMention: true,
      dmPolicy: "open",
      groupPolicy: "open",
      allowFrom: [],
    },
    createdAt: iso,
    updatedAt: iso,
    ...overrides,
  };
}

function createHttpTestContainer(opts: {
  updateFeishuPermissions?: ReturnType<typeof vi.fn>;
}): ControllerContainer {
  const env = createEnv("/tmp/nexu-feishu-perms-route-http");
  const channelService = {
    listChannels: vi.fn().mockResolvedValue([]),
    getChannel: vi.fn().mockResolvedValue(null),
    updateFeishuPermissions:
      opts.updateFeishuPermissions ??
      vi.fn().mockResolvedValue(makeChannelRecord()),
  } as unknown as ControllerContainer["channelService"];

  return {
    env,
    configStore: {} as ControllerContainer["configStore"],
    gatewayClient: {} as ControllerContainer["gatewayClient"],
    runtimeHealth: {
      probe: vi.fn(async () => ({ ok: true })),
    } as unknown as ControllerContainer["runtimeHealth"],
    openclawProcess: {} as ControllerContainer["openclawProcess"],
    agentService: {} as ControllerContainer["agentService"],
    channelService,
    channelFallbackService: {
      stop: vi.fn(),
    } as unknown as ControllerContainer["channelFallbackService"],
    sessionService: {} as ControllerContainer["sessionService"],
    runtimeConfigService: {} as ControllerContainer["runtimeConfigService"],
    runtimeModelStateService: {
      getEffectiveModelId: vi.fn().mockReturnValue("link/gpt-5.4"),
    } as unknown as ControllerContainer["runtimeModelStateService"],
    modelProviderService: {
      listModels: vi.fn().mockResolvedValue({ models: [] }),
      upsertProvider: vi.fn(),
      deleteProvider: vi.fn(),
      ensureValidDefaultModel: vi.fn(),
    } as unknown as ControllerContainer["modelProviderService"],
    integrationService: {} as ControllerContainer["integrationService"],
    localUserService: {} as ControllerContainer["localUserService"],
    desktopLocalService: {} as ControllerContainer["desktopLocalService"],
    analyticsService: {} as ControllerContainer["analyticsService"],
    artifactService: {} as ControllerContainer["artifactService"],
    templateService: {} as ControllerContainer["templateService"],
    skillhubService: {
      catalog: {
        getCatalog: vi.fn(() => ({
          skills: [],
          installedSlugs: [],
          installedSkills: [],
          meta: null,
        })),
        installSkill: vi.fn(),
        uninstallSkill: vi.fn(),
        refreshCatalog: vi.fn(),
        importSkillZip: vi.fn(),
      },
      start: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ControllerContainer["skillhubService"],
    openclawSyncService: {
      syncAll: vi.fn(),
    } as unknown as ControllerContainer["openclawSyncService"],
    openclawAuthService: {
      startOAuthFlow: vi.fn(),
      getFlowStatus: vi.fn(() => ({ status: "completed" as const })),
      consumeCompleted: vi.fn(),
      getProviderOAuthStatus: vi.fn(),
      disconnectOAuth: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ControllerContainer["openclawAuthService"],
    wsClient: {
      stop: vi.fn(),
    } as unknown as ControllerContainer["wsClient"],
    gatewayService: {
      isConnected: vi.fn(() => true),
      getAllChannelsLiveStatus: vi.fn().mockResolvedValue({
        gatewayConnected: true,
        channels: [],
      }),
      getChannelReadiness: vi.fn().mockResolvedValue({
        ready: true,
        connected: true,
        running: true,
        configured: true,
        lastError: null,
        gatewayConnected: true,
      }),
    } as unknown as ControllerContainer["gatewayService"],
    runtimeState: createRuntimeState(),
    startBackgroundLoops: () => () => {},
  };
}

describe("PATCH /api/v1/channels/:id/feishu-permissions (HTTP)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 and updated channel on success", async () => {
    const updated = makeChannelRecord({
      feishuPermissions: {
        requireMention: false,
        dmPolicy: "disabled",
        groupPolicy: "open",
        allowFrom: [],
      },
    });
    const updateFn = vi.fn().mockResolvedValue(updated);
    const container = createHttpTestContainer({
      updateFeishuPermissions: updateFn,
    });
    const app = createApp(container);

    const resp = await app.request("/api/v1/channels/ch-1/feishu-permissions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requireMention: false,
        dmPolicy: "disabled",
        groupPolicy: "open",
        allowFrom: [],
      }),
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toMatchObject({
      id: "ch-1",
      feishuPermissions: {
        requireMention: false,
        dmPolicy: "disabled",
      },
    });
    expect(updateFn).toHaveBeenCalledWith("ch-1", {
      requireMention: false,
      dmPolicy: "disabled",
      groupPolicy: "open",
      allowFrom: [],
    });
  });

  it("returns 400 when channel is not a feishu channel", async () => {
    const updateFn = vi
      .fn()
      .mockRejectedValue(new Error("Not a Feishu channel: ch-1"));
    const container = createHttpTestContainer({
      updateFeishuPermissions: updateFn,
    });
    const app = createApp(container);

    const resp = await app.request("/api/v1/channels/ch-1/feishu-permissions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requireMention: true,
        dmPolicy: "open",
        groupPolicy: "open",
        allowFrom: [],
      }),
    });

    expect(resp.status).toBe(400);
  });

  it("returns 404 when channelId is unknown", async () => {
    const updateFn = vi
      .fn()
      .mockRejectedValue(new Error("Channel not found: ch-nope"));
    const container = createHttpTestContainer({
      updateFeishuPermissions: updateFn,
    });
    const app = createApp(container);

    const resp = await app.request(
      "/api/v1/channels/ch-nope/feishu-permissions",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requireMention: true,
          dmPolicy: "open",
          groupPolicy: "open",
          allowFrom: [],
        }),
      },
    );

    expect(resp.status).toBe(404);
  });
});
