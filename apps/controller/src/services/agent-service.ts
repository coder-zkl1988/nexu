import type { BotResponse, CreateBotInput, UpdateBotInput } from "@nexu/shared";
import { HTTPException } from "hono/http-exception";
import { resolveDefaultBotFromConfig } from "../lib/default-bot.js";
import { logger } from "../lib/logger.js";
import type { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

export class AgentService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
    /** Optional: host-execution changes skip their restart when absent. */
    private readonly openclawProcess?: OpenClawProcessManager,
  ) {}

  async listBots() {
    return this.configStore.listBots();
  }

  async getBot(botId: string) {
    return this.configStore.getBot(botId);
  }

  async createBot(input: CreateBotInput, lang?: string) {
    const bot = await this.configStore.createBot(input);
    await this.syncService.writePlatformTemplatesForBot(bot.id, lang);
    await this.syncService.syncAll();
    return bot;
  }

  async updateBot(botId: string, input: UpdateBotInput) {
    const previous = await this.configStore.getBot(botId);
    const bot = await this.configStore.updateBot(botId, input);
    if (bot !== null) {
      await this.syncService.syncAll();
      // The guard captures `api.pluginConfig` once at registration, so writing
      // the new value into openclaw.json is not enough — without a restart the
      // switch silently does nothing until the next one.
      const hostExecutionChanged =
        previous !== null &&
        (previous.hostExecution.channels !== bot.hostExecution.channels ||
          previous.hostExecution.automations !== bot.hostExecution.automations);
      if (hostExecutionChanged) {
        if (!this.openclawProcess) {
          // Without the restart the switch is a silent no-op: the guard read
          // its policy once, at plugin registration.
          logger.error(
            { botId },
            "host_execution_change_without_process_manager",
          );
        }
        await this.openclawProcess?.restart("host-execution-changed");
      }
    }
    return bot;
  }

  async deleteBot(botId: string) {
    await this.assertNotSystemBot(botId, "deleted");
    const deleted = await this.configStore.deleteBot(botId);
    if (deleted) {
      await this.syncService.syncAll();
    }
    return deleted;
  }

  async pauseBot(botId: string) {
    await this.assertNotSystemBot(botId, "paused");
    const bot = await this.configStore.setBotStatus(botId, "paused");
    if (bot !== null) {
      await this.syncService.syncAll();
    }
    return bot;
  }

  private async assertNotSystemBot(
    botId: string,
    action: "deleted" | "paused",
  ): Promise<void> {
    const bot = await this.configStore.getBot(botId);
    if (bot?.origin === "system") {
      throw new HTTPException(400, {
        message: `The system bot cannot be ${action}.`,
      });
    }
  }

  async resumeBot(botId: string) {
    const bot = await this.configStore.setBotStatus(botId, "active");
    if (bot !== null) {
      await this.syncService.syncAll();
    }
    return bot;
  }

  /**
   * Single default-bot entrypoint (design:
   * specs/design-docs/2026-07-23-desktop-default-bot-and-system-bot.md).
   * Resolution is delegated to resolveDefaultBotFromConfig; when no active
   * bot exists, the product-owned system bot is created lazily.
   */
  async getOrCreateDefaultBot(lang?: string): Promise<BotResponse> {
    const config = await this.configStore.getConfig();
    const resolved = resolveDefaultBotFromConfig(config);
    if (resolved) {
      return resolved;
    }

    const bot = await this.configStore.createBot({
      name: "Tabby",
      slug: "tabby-local-chat",
      modelId: config.runtime.defaultModelId,
      origin: "system",
    });
    await this.syncService.writePlatformTemplatesForBot(bot.id, lang);
    await this.syncService.syncAll();
    return bot;
  }

  async setDefaultBot(botId: string): Promise<BotResponse> {
    const bot = await this.configStore.getBot(botId);
    if (!bot) {
      throw new HTTPException(404, { message: `Bot not found: ${botId}` });
    }
    if (bot.status !== "active") {
      throw new HTTPException(400, {
        message: "Only an active bot can be set as the default.",
      });
    }

    await this.configStore.setDesktopDefaultBot(botId);
    await this.syncService.syncAll();
    return bot;
  }
}
