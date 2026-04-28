import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "#controller/app/env";
import { NexuConfigStore } from "#controller/store/nexu-config-store";

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `nexu-feishu-perms-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("NexuConfigStore.updateChannelFeishuPermissions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("newly-created feishu channels have feishuPermissions=null", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    const bot = await store.createBot({ name: "b", slug: "b" });
    const channel = await store.connectFeishu({
      appId: "cli_feishu_app",
      appSecret: "feishu-secret",
      botId: bot.id,
    });

    expect(channel.feishuPermissions).toBeNull();
  });

  it("persists non-null permissions via updateChannelFeishuPermissions", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    const bot = await store.createBot({ name: "b", slug: "b" });
    const channel = await store.connectFeishu({
      appId: "cli_feishu_app",
      appSecret: "feishu-secret",
      botId: bot.id,
    });

    const updated = await store.updateChannelFeishuPermissions(channel.id, {
      requireMention: false,
      dmPolicy: "allowlist",
      groupPolicy: "open",
      allowFrom: ["ou_alice"],
    });

    expect(updated.feishuPermissions?.requireMention).toBe(false);
    expect(updated.feishuPermissions?.dmPolicy).toBe("allowlist");
    expect(updated.feishuPermissions?.groupPolicy).toBe("open");
    expect(updated.feishuPermissions?.allowFrom).toEqual(["ou_alice"]);

    const reread = await store.getChannel(channel.id);
    expect(reread?.feishuPermissions?.allowFrom).toEqual(["ou_alice"]);
  });

  it("allows clearing permissions back to null", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    const bot = await store.createBot({ name: "b", slug: "b" });
    const channel = await store.connectFeishu({
      appId: "cli_feishu_app",
      appSecret: "feishu-secret",
      botId: bot.id,
    });

    await store.updateChannelFeishuPermissions(channel.id, {
      requireMention: true,
      dmPolicy: "open",
      groupPolicy: "open",
      allowFrom: [],
    });
    const cleared = await store.updateChannelFeishuPermissions(
      channel.id,
      null,
    );
    expect(cleared.feishuPermissions).toBeNull();
  });

  it("rejects updates to non-feishu channels with 'Not a Feishu channel'", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    const bot = await store.createBot({ name: "b", slug: "b" });
    const wechatChannel = await store.connectWechat({
      accountId: "wxid_1",
      botId: bot.id,
    });

    await expect(
      store.updateChannelFeishuPermissions(wechatChannel.id, {
        requireMention: true,
        dmPolicy: "open",
        groupPolicy: "open",
        allowFrom: [],
      }),
    ).rejects.toThrow(/not a feishu channel/i);
  });

  it("throws 'Channel not found' for unknown channelId", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    await expect(
      store.updateChannelFeishuPermissions("does_not_exist", {
        requireMention: true,
        dmPolicy: "open",
        groupPolicy: "open",
        allowFrom: [],
      }),
    ).rejects.toThrow(/channel not found/i);
  });
});
