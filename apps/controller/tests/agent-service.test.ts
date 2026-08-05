import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { AgentService } from "../src/services/agent-service.js";
import type { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import { NexuConfigStore } from "../src/store/nexu-config-store.js";

describe("AgentService default bot & system-bot guards", () => {
  let rootDir = "";
  let store: NexuConfigStore;
  let service: AgentService;

  const syncService = {
    writePlatformTemplatesForBot: vi.fn(async () => {}),
    syncAll: vi.fn(async () => {}),
  } as unknown as OpenClawSyncService;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-agent-service-"));
    const env = {
      nodeEnv: "test",
      nexuHomeDir: path.join(rootDir, ".nexu"),
      nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
      artifactsIndexPath: path.join(
        rootDir,
        ".nexu",
        "artifacts",
        "index.json",
      ),
      compiledOpenclawSnapshotPath: path.join(
        rootDir,
        ".nexu",
        "compiled-openclaw.json",
      ),
      openclawStateDir: path.join(rootDir, ".openclaw"),
      accountCreditStatePath: path.join(
        rootDir,
        ".openclaw",
        "nexu-account-credit-state.json",
      ),
      skillDbPath: path.join(rootDir, ".nexu", "skill-ledger.json"),
      analyticsStatePath: path.join(rootDir, ".nexu", "analytics-state.json"),
      defaultModelId: "anthropic/claude-sonnet-4",
    } as unknown as ControllerEnv;
    store = new NexuConfigStore(env);
    service = new AgentService(store, syncService);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("getOrCreateDefaultBot follows slug order, not insertion order", async () => {
    await store.createBot({ name: "Zeta", slug: "zeta" });
    await store.createBot({ name: "Alpha", slug: "alpha" });

    const bot = await service.getOrCreateDefaultBot();

    expect(bot.slug).toBe("alpha");
  });

  it("getOrCreateDefaultBot honors desktop.defaultBotId", async () => {
    await store.createBot({ name: "Alpha", slug: "alpha" });
    const zeta = await store.createBot({ name: "Zeta", slug: "zeta" });
    await store.setDesktopDefaultBot(zeta.id);

    const bot = await service.getOrCreateDefaultBot();

    expect(bot.id).toBe(zeta.id);
  });

  it("getOrCreateDefaultBot lazily creates the system Tabby bot", async () => {
    const bot = await service.getOrCreateDefaultBot();

    expect(bot.origin).toBe("system");
    expect(bot.name).toBe("Tabby");
    expect(bot.slug).toBe("tabby-local-chat");
  });

  it("deleteBot rejects the system bot", async () => {
    const systemBot = await store.createBot({
      name: "Tabby",
      slug: "tabby-local-chat",
      origin: "system",
    });

    await expect(service.deleteBot(systemBot.id)).rejects.toThrow(
      /system bot/i,
    );
    expect(await store.getBot(systemBot.id)).not.toBeNull();
  });

  it("pauseBot rejects the system bot", async () => {
    const systemBot = await store.createBot({
      name: "Tabby",
      slug: "tabby-local-chat",
      origin: "system",
    });

    await expect(service.pauseBot(systemBot.id)).rejects.toThrow(/system bot/i);
    expect((await store.getBot(systemBot.id))?.status).toBe("active");
  });

  it("setDefaultBot persists the choice and syncs", async () => {
    await store.createBot({ name: "Alpha", slug: "alpha" });
    const zeta = await store.createBot({ name: "Zeta", slug: "zeta" });

    const bot = await service.setDefaultBot(zeta.id);

    expect(bot.id).toBe(zeta.id);
    expect((await service.getOrCreateDefaultBot()).id).toBe(zeta.id);
    expect(syncService.syncAll).toHaveBeenCalled();
  });

  it("setDefaultBot rejects unknown or inactive bots", async () => {
    await expect(service.setDefaultBot("missing")).rejects.toThrow(
      /not found/i,
    );

    const paused = await store.createBot({ name: "Paused", slug: "paused" });
    await store.setBotStatus(paused.id, "paused");
    await expect(service.setDefaultBot(paused.id)).rejects.toThrow(/active/i);
  });

  it("deleteBot still deletes user bots", async () => {
    const userBot = await store.createBot({ name: "Mine", slug: "mine" });

    expect(await service.deleteBot(userBot.id)).toBe(true);
    expect(await store.getBot(userBot.id)).toBeNull();
  });

  // The guard captures its plugin config once at registration, so a
  // host-execution change that only rewrites openclaw.json is a silent no-op
  // until something else restarts OpenClaw.
  it("restarts OpenClaw when host execution changes, and not otherwise", async () => {
    const openclawProcess = {
      restart: vi.fn(async () => {}),
    } as unknown as ConstructorParameters<typeof AgentService>[2];
    const restarting = new AgentService(store, syncService, openclawProcess);
    const bot = await store.createBot({ name: "Runner", slug: "runner" });

    await restarting.updateBot(bot.id, { name: "Renamed" });
    expect(openclawProcess?.restart).not.toHaveBeenCalled();

    const updated = await restarting.updateBot(bot.id, {
      hostExecution: { channels: "host" },
    });
    expect(updated?.hostExecution).toEqual({
      channels: "host",
      automations: "restricted",
    });
    expect(openclawProcess?.restart).toHaveBeenCalledWith(
      "host-execution-changed",
    );
  });
});
