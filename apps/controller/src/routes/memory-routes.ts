import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import { MEMOS_API_KEY_SECRET } from "../lib/openclaw-config-compiler.js";
import { getOpenClawCommandSpec } from "../runtime/slimclaw-runtime-resolution.js";
import { memoryConfigSchema, memosConfigSchema } from "../store/schemas.js";
import type { ControllerBindings } from "../types.js";

const memorySettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  sources: z
    .array(z.enum(["memory", "sessions"]))
    .min(1)
    .max(20)
    .optional(),
  extraPaths: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
  syncIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(300).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

const memosSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  // Write-only: it goes into the encrypted secrets table and is never read
  // back out over the API. An empty string clears it.
  apiKey: z.string().trim().max(500).optional(),
  userId: z.string().trim().min(1).max(200).optional(),
  memoryLimitNumber: z.number().int().min(1).max(50).optional(),
  preferenceLimitNumber: z.number().int().min(1).max(50).optional(),
  relativity: z.number().min(0).max(1).optional(),
});

const memosSettingsEnvelopeSchema = z.object({
  memos: memosConfigSchema.extend({ apiKeyConfigured: z.boolean() }),
});

const memorySettingsEnvelopeSchema = z.object({
  memory: memoryConfigSchema,
});

const memoryRebuildResponseSchema = z.object({
  ok: z.literal(true),
  rebuiltAt: z.string(),
});

const memorySearchModeSchema = z.enum(["semantic", "fts-only"]);
const memoryStatusReasonCodeSchema = z.enum([
  "embedding-auth-missing",
  "embedding-provider-unavailable",
  "fts-unavailable",
  "probe-timeout",
  "invalid-status",
  "runtime-unavailable",
]);

const memoryStatusResponseSchema = z.object({
  connected: z.boolean(),
  available: z.boolean(),
  enabled: z.boolean(),
  lastSyncAtMs: z.number().optional(),
  indexedItems: z.number().optional(),
  promotedItems: z.number().optional(),
  mode: memorySearchModeSchema.optional(),
  reasonCode: memoryStatusReasonCodeSchema.optional(),
  status: z.enum(["ready", "sync-needed", "disabled", "unavailable"]),
});

type MemorySearchMode = z.infer<typeof memorySearchModeSchema>;
type MemoryStatusReasonCode = z.infer<typeof memoryStatusReasonCodeSchema>;

type MemoryIndexStatus = {
  indexedItems?: number;
  lastSyncAtMs?: number;
  dirty: boolean;
  mode?: MemorySearchMode;
};

type MemoryCommandOptions = {
  timeoutMs?: number;
};

type MemoryCommandRunner = (
  env: ControllerEnv,
  args: string[],
  options?: MemoryCommandOptions,
) => Promise<string>;

type MemoryRoutesDependencies = {
  rebuildIndex?: (env: ControllerEnv, agentId?: string) => Promise<void>;
  readStatus?: (
    env: ControllerEnv,
    agentId?: string,
  ) => Promise<MemoryIndexStatus>;
  runCommand?: MemoryCommandRunner;
  now?: () => Date;
};

function normalizeExtraPaths(paths: readonly string[]): string[] {
  return Array.from(
    new Set(
      paths.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
}

async function runMemoryCommand(
  env: ControllerEnv,
  args: string[],
  options: MemoryCommandOptions = {},
): Promise<string> {
  const spec = getOpenClawCommandSpec(env);

  return new Promise<string>((resolve, reject) => {
    execFile(
      spec.command,
      [...spec.argsPrefix, ...args],
      {
        cwd: env.openclawStateDir,
        env: {
          ...process.env,
          ...spec.extraEnv,
          OPENCLAW_CONFIG_PATH: env.openclawConfigPath,
          OPENCLAW_STATE_DIR: env.openclawStateDir,
        },
        timeout: options.timeoutMs ?? 5 * 60 * 1000,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function rebuildMemoryIndex(
  env: ControllerEnv,
  agentId?: string,
): Promise<void> {
  await runMemoryCommand(env, [
    "memory",
    "index",
    "--force",
    ...(agentId ? ["--agent", agentId] : []),
  ]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

class MemoryStatusError extends Error {
  readonly reasonCode: MemoryStatusReasonCode;

  constructor(reasonCode: MemoryStatusReasonCode, message: string) {
    super(message);
    this.name = "MemoryStatusError";
    this.reasonCode = reasonCode;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function classifyMemoryStatusFailure(error: unknown): MemoryStatusReasonCode {
  if (error instanceof MemoryStatusError) return error.reasonCode;

  const message = getErrorMessage(error);
  if (/missing-provider-auth|no api key found/i.test(message)) {
    return "embedding-auth-missing";
  }
  if (/timed?\s*out|etimedout/i.test(message)) return "probe-timeout";
  if (/embedding|model_not_found|provider/i.test(message)) {
    return "embedding-provider-unavailable";
  }
  return "runtime-unavailable";
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

async function readMemoryIndexStatus(
  env: ControllerEnv,
  agentId?: string,
  runCommand: MemoryCommandRunner = runMemoryCommand,
): Promise<MemoryIndexStatus> {
  // Plain status only inspects index metadata; --deep embeds one probe item.
  const stdout = await runCommand(
    env,
    [
      "memory",
      "status",
      "--json",
      "--deep",
      ...(agentId ? ["--agent", agentId] : []),
    ],
    { timeoutMs: 30_000 },
  );
  const parsed: unknown = JSON.parse(stdout);
  const entries = (Array.isArray(parsed) ? parsed : [parsed])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  if (entries.length === 0) {
    throw new MemoryStatusError(
      "invalid-status",
      "Memory status returned no agents",
    );
  }

  let indexedItems = 0;
  let hasIndexedItems = false;
  let dirty = false;
  let allSemantic = true;
  const syncTimes: number[] = [];

  for (const entry of entries) {
    const status = asRecord(entry.status);
    if (!status) {
      throw new MemoryStatusError(
        "invalid-status",
        "Memory status is missing agent details",
      );
    }

    const files = readFiniteNumber(status.files);
    if (files !== undefined) {
      indexedItems += files;
      hasIndexedItems = true;
    }
    dirty ||= status.dirty === true;

    const fts = asRecord(status.fts);
    const vector = asRecord(status.vector);
    const ftsOnly = status.provider === "none" || vector?.enabled === false;
    if (ftsOnly) {
      allSemantic = false;
      if (fts?.available !== true) {
        throw new MemoryStatusError(
          "fts-unavailable",
          "Memory full-text index is unavailable",
        );
      }
    } else {
      const embeddingProbe = asRecord(entry.embeddingProbe);
      if (embeddingProbe?.ok !== true) {
        throw new MemoryStatusError(
          classifyMemoryStatusFailure(embeddingProbe?.error),
          "Memory embedding probe is unavailable",
        );
      }
    }

    const dbPath = status.dbPath;
    if (typeof dbPath === "string" && dbPath.length > 0) {
      const mtimeMs = await stat(dbPath)
        .then((dbEntry) => dbEntry.mtimeMs)
        .catch(() => undefined);
      if (mtimeMs !== undefined) syncTimes.push(mtimeMs);
    }
  }

  return {
    ...(hasIndexedItems ? { indexedItems } : {}),
    ...(syncTimes.length > 0 ? { lastSyncAtMs: Math.max(...syncTimes) } : {}),
    dirty,
    mode: allSemantic ? "semantic" : "fts-only",
  };
}

export function registerMemoryRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
  dependencies: MemoryRoutesDependencies = {},
): void {
  const rebuildIndex = dependencies.rebuildIndex ?? rebuildMemoryIndex;
  const runCommand = dependencies.runCommand ?? runMemoryCommand;
  const readStatus =
    dependencies.readStatus ??
    ((env, agentId) => readMemoryIndexStatus(env, agentId, runCommand));
  const now = dependencies.now ?? (() => new Date());

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/memory/status",
      tags: ["Memory"],
      request: { query: z.object({ agentId: z.string().optional() }) },
      responses: {
        200: {
          content: {
            "application/json": { schema: memoryStatusResponseSchema },
          },
          description: "Memory search index status",
        },
      },
    }),
    async (c) => {
      const memory = await container.configStore.getMemoryConfig();
      if (!memory.enabled) {
        return c.json(
          {
            connected: true,
            available: false,
            enabled: false,
            status: "disabled" as const,
          },
          200,
        );
      }

      try {
        const status = await readStatus(
          container.env,
          c.req.valid("query").agentId,
        );
        return c.json(
          {
            connected: true,
            available: true,
            enabled: true,
            ...(status.indexedItems !== undefined
              ? { indexedItems: status.indexedItems }
              : {}),
            ...(status.lastSyncAtMs !== undefined
              ? { lastSyncAtMs: status.lastSyncAtMs }
              : {}),
            mode: status.mode ?? "semantic",
            status: status.dirty
              ? ("sync-needed" as const)
              : ("ready" as const),
          },
          200,
        );
      } catch (error) {
        const reasonCode = classifyMemoryStatusFailure(error);
        return c.json(
          {
            connected:
              reasonCode !== "runtime-unavailable" &&
              reasonCode !== "probe-timeout",
            available: false,
            enabled: true,
            reasonCode,
            status: "unavailable" as const,
          },
          200,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/memory/settings",
      tags: ["Memory"],
      responses: {
        200: {
          content: {
            "application/json": { schema: memorySettingsEnvelopeSchema },
          },
          description: "Memory search settings",
        },
      },
    }),
    async (c) =>
      c.json({ memory: await container.configStore.getMemoryConfig() }, 200),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/memory/settings",
      tags: ["Memory"],
      request: {
        body: {
          content: {
            "application/json": { schema: memorySettingsPatchSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: memorySettingsEnvelopeSchema },
          },
          description: "Updated memory search settings",
        },
        409: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Memory settings could not be applied",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const previous = await container.configStore.getMemoryConfig();
      const memory = await container.configStore.setMemoryConfig({
        ...body,
        ...(body.sources ? { sources: Array.from(new Set(body.sources)) } : {}),
        ...(body.extraPaths
          ? { extraPaths: normalizeExtraPaths(body.extraPaths) }
          : {}),
      });
      try {
        await container.openclawSyncService.syncAll();
      } catch (error) {
        logger.warn(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "memory_settings_sync_failed",
        );
        await container.configStore.setMemoryConfig(previous);
        // A rollback that cannot be synced leaves the stored config and the
        // runtime disagreeing, which is worse than the original failure and
        // must not be swallowed.
        await container.openclawSyncService.syncAll().catch((rollbackError) => {
          logger.error(
            {
              errorName:
                rollbackError instanceof Error
                  ? rollbackError.name
                  : "UnknownError",
            },
            "memory_settings_rollback_sync_failed",
          );
        });
        throw new HTTPException(409, {
          message: "Memory settings could not be applied",
        });
      }
      return c.json({ memory }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/memory/rebuild",
      tags: ["Memory"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ agentId: z.string().min(1).optional() }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: memoryRebuildResponseSchema },
          },
          description: "Memory index rebuilt",
        },
        409: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Memory is disabled or rebuilding failed",
        },
      },
    }),
    async (c) => {
      const { agentId } = c.req.valid("json");
      const memory = await container.configStore.getMemoryConfig();
      if (!memory.enabled) {
        throw new HTTPException(409, {
          message: "Enable memory before rebuilding the index",
        });
      }

      // Split the two awaits so a failure names the stage it came from. The
      // subprocess error message itself stays out of the log: it carries
      // OpenClaw stderr, which is not a vetted logging surface.
      try {
        await container.openclawSyncService.syncAll();
      } catch (error) {
        logger.warn(
          {
            ...(agentId ? { agentId } : {}),
            stage: "sync",
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          "memory_index_rebuild_failed",
        );
        throw new HTTPException(409, {
          message: "Memory index rebuild failed",
        });
      }

      try {
        await rebuildIndex(container.env, agentId);
      } catch (error) {
        logger.warn(
          {
            ...(agentId ? { agentId } : {}),
            stage: "rebuild",
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          "memory_index_rebuild_failed",
        );
        throw new HTTPException(409, {
          message: "Memory index rebuild failed",
        });
      }

      return c.json({ ok: true as const, rebuiltAt: now().toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/memos/settings",
      tags: ["Memory"],
      responses: {
        200: {
          content: {
            "application/json": { schema: memosSettingsEnvelopeSchema },
          },
          description: "MemOS Cloud memory settings",
        },
      },
    }),
    async (c) => {
      const memos = await container.configStore.getMemosConfig();
      const apiKey =
        await container.configStore.getSecret(MEMOS_API_KEY_SECRET);
      return c.json(
        { memos: { ...memos, apiKeyConfigured: (apiKey ?? "").length > 0 } },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/memos/settings",
      tags: ["Memory"],
      request: {
        body: {
          content: {
            "application/json": { schema: memosSettingsPatchSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: memosSettingsEnvelopeSchema },
          },
          description: "Updated MemOS Cloud memory settings",
        },
        409: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "MemOS settings could not be applied",
        },
      },
    }),
    async (c) => {
      const { apiKey, ...rest } = c.req.valid("json");
      const previous = await container.configStore.getMemosConfig();
      const previousKey =
        (await container.configStore.getSecret(MEMOS_API_KEY_SECRET)) ?? "";
      if (apiKey !== undefined) {
        await container.configStore.setSecret(MEMOS_API_KEY_SECRET, apiKey);
      }
      const memos = await container.configStore.setMemosConfig(rest);
      try {
        await container.openclawSyncService.syncAll();
      } catch (error) {
        logger.warn(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "memos_settings_sync_failed",
        );
        await container.configStore.setMemosConfig(previous);
        if (apiKey !== undefined) {
          await container.configStore.setSecret(
            MEMOS_API_KEY_SECRET,
            previousKey,
          );
        }
        await container.openclawSyncService.syncAll().catch((rollbackError) => {
          logger.error(
            {
              errorName:
                rollbackError instanceof Error
                  ? rollbackError.name
                  : "UnknownError",
            },
            "memos_settings_rollback_sync_failed",
          );
        });
        throw new HTTPException(409, {
          message: "MemOS settings could not be applied",
        });
      }
      // OpenClaw builds its plugin set at boot, so a config write alone leaves
      // the previous plugin state live.
      await container.openclawProcess.restart("memos-settings-changed");
      const effectiveKey =
        (await container.configStore.getSecret(MEMOS_API_KEY_SECRET)) ?? "";
      return c.json(
        { memos: { ...memos, apiKeyConfigured: effectiveKey.length > 0 } },
        200,
      );
    },
  );
}
