import { describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import type { OpenClawProcessManager } from "../src/runtime/openclaw-process.js";
import { ModelProviderService } from "../src/services/model-provider-service.js";
import type { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import type { NexuConfigStore } from "../src/store/nexu-config-store.js";

describe("ModelProviderService managed model visibility", () => {
  it("hides the managed embedding model from the user model catalog", async () => {
    const service = new ModelProviderService(
      {
        getModelProviderConfigDocument: vi.fn(async () => ({
          mode: "merge" as const,
          providers: {},
        })),
        getDesktopCloudStatus: vi.fn(async () => ({
          models: [
            {
              id: "Qwen/Qwen3-Embedding-4B",
              name: "Qwen3 Embedding 4B",
            },
            { id: "tabby-ultra", name: "Tabby Ultra" },
          ],
        })),
      } as unknown as NexuConfigStore,
      {} as ControllerEnv,
      {} as OpenClawSyncService,
      {} as OpenClawProcessManager,
    );

    await expect(service.listModels()).resolves.toEqual({
      models: [
        {
          id: "tabby-ultra",
          name: "Tabby Ultra",
          provider: "nexu",
          description: "Cloud model via Tabby Link",
        },
      ],
    });
  });
});
