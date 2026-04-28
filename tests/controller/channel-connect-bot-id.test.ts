import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "#controller/app/env";
import { NexuConfigStore } from "#controller/store/nexu-config-store";

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `nexu-channel-bot-id-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("NexuConfigStore channel connect honors botId", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("connectWechat uses the client-supplied botId, not the first bot", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    const defaultBot = await store.createBot({
      name: "Default",
      slug: "default-bot",
    });
    const targetBot = await store.createBot({
      name: "Target",
      slug: "target-bot",
    });

    const channel = await store.connectWechat({
      accountId: "wechat-acct-1",
      botId: targetBot.id,
    });

    expect(channel.botId).toBe(targetBot.id);
    expect(channel.botId).not.toBe(defaultBot.id);
  });

  it("connectWechat throws when the supplied botId does not exist", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);
    await store.createBot({ name: "Default", slug: "default-bot" });

    await expect(
      store.connectWechat({
        accountId: "wechat-acct-x",
        botId: "bot-does-not-exist",
      }),
    ).rejects.toThrow(/Bot not found/);
  });

  it("connectFeishu uses the client-supplied botId, not the first bot", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    const defaultBot = await store.createBot({
      name: "Default",
      slug: "default-bot",
    });
    const targetBot = await store.createBot({
      name: "Target",
      slug: "target-bot",
    });

    const channel = await store.connectFeishu({
      appId: "cli_feishu_app",
      appSecret: "feishu-secret",
      botId: targetBot.id,
    });

    expect(channel.botId).toBe(targetBot.id);
    expect(channel.botId).not.toBe(defaultBot.id);
  });

  it("connectFeishu throws when the supplied botId does not exist", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);
    await store.createBot({ name: "Default", slug: "default-bot" });

    await expect(
      store.connectFeishu({
        appId: "cli_feishu_app",
        appSecret: "feishu-secret",
        botId: "bot-does-not-exist",
      }),
    ).rejects.toThrow(/Bot not found/);
  });
});
