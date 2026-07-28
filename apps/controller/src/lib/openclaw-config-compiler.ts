import { existsSync } from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "@nexu/shared";
import { openclawConfigSchema } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import type { OAuthConnectionState } from "../runtime/openclaw-auth-profiles-store.js";
import type { NexuConfig } from "../store/schemas.js";
import {
  compileChannelBindings,
  compileChannelsConfig,
  resolveManagedChannelPluginId,
} from "./channel-binding-compiler.js";
import { resolveDefaultBotFromConfig } from "./default-bot.js";
import {
  buildProviderRuntimeModelId,
  buildProviderRuntimeModelRef,
  findProviderDescriptorForModelRef,
  listModelProviderRuntimeDescriptors,
  resolveModelProviderApiKey,
} from "./model-provider-runtime.js";
import { normalizeProviderBaseUrl } from "./provider-base-url.js";

/**
 * Known model capabilities for popular providers.
 * Keys are matched case-insensitively against the model ID (without provider prefix).
 * When a match is found, the contextWindow and maxTokens values override the defaults.
 */
const MODEL_CAPABILITIES: Record<
  string,
  { contextWindow: number; maxTokens?: number; reasoning?: boolean }
> = {
  // DeepSeek V4
  "deepseek-v4-pro": { contextWindow: 1048576, maxTokens: 384000 },
  "deepseek-v4-flash": { contextWindow: 1048576, maxTokens: 384000 },
  "deepseek-chat": { contextWindow: 1048576, maxTokens: 384000 },
  "deepseek-reasoner": { contextWindow: 1048576, maxTokens: 384000 },

  // OpenAI GPT
  "gpt-5.4": { contextWindow: 1048576, maxTokens: 32768 },
  "gpt-5.4-mini": { contextWindow: 1048576, maxTokens: 32768 },
  "gpt-4.1": { contextWindow: 1048576, maxTokens: 32768 },
  "gpt-4.1-mini": { contextWindow: 1048576, maxTokens: 32768 },
  "gpt-4.1-nano": { contextWindow: 1048576, maxTokens: 32768 },
  "o4-mini": { contextWindow: 200000, maxTokens: 100000, reasoning: true },
  o3: { contextWindow: 200000, maxTokens: 100000, reasoning: true },
  "o3-mini": { contextWindow: 200000, maxTokens: 100000, reasoning: true },

  // Anthropic Claude
  "claude-sonnet-4-20250514": { contextWindow: 200000, maxTokens: 64000 },
  "claude-opus-8-20250514": { contextWindow: 200000, maxTokens: 32000 },

  // Google Gemini
  "gemini-3-flash-preview": { contextWindow: 1048576, maxTokens: 65536 },
  "gemini-3-pro-preview": { contextWindow: 1048576, maxTokens: 65536 },

  // Groq
  "llama-4-scout-17b-16e-instruct": { contextWindow: 1048576, maxTokens: 8192 },
  "llama-4-maverick-17b-128e-instruct": {
    contextWindow: 1048576,
    maxTokens: 8192,
  },

  // Tabby Official aliases → underlying-model limits. Without these the aliases
  // fall back to the compiler default (contextWindow 200000), which mismatches
  // the real window and causes context-overflow errors. Comment = the gateway's
  // underlying model and source. contextWindow is set at or just under the
  // documented cap (never above it — overshooting is what causes the overflow
  // error; undershooting only triggers compaction a little earlier, which is
  // safe). Values for unknown upstreams (stepfun) and the auto router are set
  // conservatively so they never overflow; raise once confirmed.
  // gpt-5.5/5.4/5.4-mini are accessed through the Codex subscription (see the
  // `openai: "openai-codex"` OAuth mapping below), NOT the raw pay-per-token
  // API — Codex enforces its own product-level context window, which is
  // smaller than the API's published 1,050,000. Use the Codex window, not the
  // API one, or these overflow exactly like tabby-mini did before.
  "tabby-ultra": { contextWindow: 384000, maxTokens: 128000 }, // gpt-5.5 via Codex — Codex window is 400,000, not the API's 1,050,000
  "tabby-pro": { contextWindow: 384000, maxTokens: 128000 }, // gpt-5.4 via Codex — same 400,000 Codex window assumed (same subscription/product path as 5.5)
  "tabby-mini": { contextWindow: 384000, maxTokens: 32768 }, // gpt-5.4-mini via Codex — API cap (400,000) and assumed Codex cap coincide
  "tabby-fast": { contextWindow: 983040, maxTokens: 384000 }, // deepseek-v4-pro — official docs: 1,000,000 ctx (was wrongly 1,048,576, slightly over cap)
  "tabby-free": { contextWindow: 240000, maxTokens: 8192 }, // agnes-2.0-flash — docs conflict (512K vs 256K); using the more conservative 256K with margin
  "tabby-phone": { contextWindow: 245760, maxTokens: 8192 }, // stepfun-3.7-flash — confirmed 256,000 ctx, with margin
  "tabby-auto": { contextWindow: 131072, maxTokens: 8192 }, // auto router → smallest routable window (unconfirmed — conservative placeholder)
};

/** Look up known model capabilities by ID (case-insensitive, stripped of provider prefix). */
function lookupModelCapabilities(modelId: string): {
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
} {
  // Try exact match first
  const lower = modelId.toLowerCase();
  const exact = MODEL_CAPABILITIES[lower];
  if (exact) return exact;

  // Try matching the tail after the last slash (e.g. "deepseek/deepseek-v4-pro" → "deepseek-v4-pro")
  const tail = lower.split("/").pop() ?? lower;
  if (tail !== lower) {
    const match = MODEL_CAPABILITIES[tail];
    if (match) return match;
  }

  return {};
}

export type { OAuthConnectionState };

const LINK_PROVIDER_HEADERS = {
  "User-Agent": "Mozilla/5.0",
};

const EMPTY_OAUTH_CONNECTION_STATE: OAuthConnectionState = {
  connectedProviderIds: [],
};

const OAUTH_PROVIDER_MAP: Record<string, string> = {
  openai: "openai-codex",
};

/**
 * Derive the OpenClaw control-UI asset root from OPENCLAW_EXTENSIONS_DIR.
 *
 * The real OpenClaw package layout keeps both directories under dist/
 * (`<pkg>/dist/extensions`, `<pkg>/dist/control-ui`), which is what the
 * packaged launchd path passes. Some launchers still pass the legacy
 * `<pkg>/extensions` form, so handle both instead of blindly appending
 * "dist" (which produced a broken `<pkg>/dist/dist/control-ui` and a 503
 * from the control UI in packaged builds).
 */
export function resolveControlUiRoot(builtinExtensionsDir: string): string {
  const parentDir = path.dirname(builtinExtensionsDir);
  return path.basename(parentDir) === "dist"
    ? path.join(parentDir, "control-ui")
    : path.join(parentDir, "dist", "control-ui");
}

function isDesktopCloudConfig(value: unknown): value is {
  linkUrl: string;
  apiKey: string;
  models: Array<{ id: string; name: string; provider?: string }>;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.linkUrl === "string" &&
    typeof candidate.apiKey === "string" &&
    Array.isArray(candidate.models)
  );
}

function getDesktopSelectedModel(config: NexuConfig): string | null {
  const selectedModelId = config.desktop.selectedModelId;
  return typeof selectedModelId === "string" && selectedModelId.length > 0
    ? selectedModelId
    : null;
}

const DEFAULT_CONTEXT_WINDOW = 200000;
const DEFAULT_MAX_TOKENS = 8192;

function buildModelEntry(
  id: string,
  name?: string,
  overrides?: { contextWindow?: number; maxTokens?: number },
) {
  const known = lookupModelCapabilities(id);
  return {
    id,
    name: name ?? id,
    reasoning: known.reasoning ?? false,
    input: ["text", "image"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow:
      (overrides?.contextWindow && overrides.contextWindow > 0
        ? overrides.contextWindow
        : known.contextWindow) ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens:
      (overrides?.maxTokens && overrides.maxTokens > 0
        ? overrides.maxTokens
        : known.maxTokens) ?? DEFAULT_MAX_TOKENS,
    compat: {
      supportsStore: false,
    },
  };
}

function collectLitellmModelIds(config: NexuConfig): string[] {
  const selectedModelId = getDesktopSelectedModel(config);
  const candidateIds = [
    ...config.bots.map((bot) => bot.modelId),
    config.runtime.defaultModelId,
    selectedModelId,
  ];

  return [...new Set(candidateIds)]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .map((value) => value.replace(/^litellm\//, ""))
    .filter(
      (value) => !value.startsWith("link/") && !value.startsWith("debug/"),
    );
}

function compileModelsConfig(
  config: NexuConfig,
  env: ControllerEnv,
): OpenClawConfig["models"] {
  const providers: NonNullable<OpenClawConfig["models"]>["providers"] = {};

  if (env.litellmBaseUrl && env.litellmApiKey) {
    providers.litellm = {
      baseUrl: env.litellmBaseUrl,
      apiKey: env.litellmApiKey,
      api: "openai-completions",
      models: collectLitellmModelIds(config).map((modelId) =>
        buildModelEntry(modelId),
      ),
    };
  }

  for (const descriptor of listModelProviderRuntimeDescriptors(config)) {
    if (!descriptor.provider.enabled) {
      continue;
    }

    const apiKey = resolveModelProviderApiKey(descriptor);
    if (apiKey === null && descriptor.provider.auth !== "oauth") {
      continue;
    }

    // Keep apiKey when it's a non-empty string or a secret-ref object; only
    // drop it when null/undefined or an empty string. Emitting apiKey:""
    // caused OpenClaw to reject the provider (and caused relogin to fail
    // with "Unknown model: link/...").
    const hasUsableApiKey =
      apiKey !== null && !(typeof apiKey === "string" && apiKey.length === 0);
    providers[descriptor.runtimeKey] = {
      baseUrl: descriptor.provider.baseUrl,
      ...(hasUsableApiKey ? { apiKey } : {}),
      api: descriptor.apiKind,
      ...(descriptor.authHeader ? { authHeader: true } : {}),
      ...(descriptor.defaultHeaders
        ? { headers: descriptor.defaultHeaders }
        : {}),
      models: descriptor.provider.models.map((model) =>
        buildModelEntry(
          buildProviderRuntimeModelId(descriptor, model.id),
          model.name,
          { contextWindow: model.contextWindow, maxTokens: model.maxTokens },
        ),
      ),
    };
  }

  const desktopCloud = isDesktopCloudConfig(config.desktop.cloud)
    ? config.desktop.cloud
    : null;
  if (desktopCloud && desktopCloud.models.length > 0) {
    providers.link = {
      baseUrl: `${normalizeProviderBaseUrl(desktopCloud.linkUrl) ?? desktopCloud.linkUrl}/v1`,
      apiKey: desktopCloud.apiKey,
      api: "openai-completions",
      headers: LINK_PROVIDER_HEADERS,
      models: desktopCloud.models.map((model) =>
        buildModelEntry(model.id, model.name),
      ),
    };
  }

  return Object.keys(providers).length > 0
    ? {
        mode: "merge",
        providers,
      }
    : undefined;
}

export function resolveModelId(
  config: NexuConfig,
  env: ControllerEnv,
  rawModelId: string,
  oauthState: OAuthConnectionState = EMPTY_OAUTH_CONNECTION_STATE,
): string {
  if (rawModelId.startsWith("litellm/") || rawModelId.startsWith("link/")) {
    return rawModelId;
  }

  const descriptors = listModelProviderRuntimeDescriptors(config).filter(
    (descriptor) => descriptor.provider.enabled,
  );
  const matchedDescriptor = findProviderDescriptorForModelRef(
    descriptors,
    rawModelId,
  );

  if (matchedDescriptor) {
    const oauthTarget =
      OAUTH_PROVIDER_MAP[matchedDescriptor.descriptor.providerId];
    if (
      oauthTarget &&
      oauthState.connectedProviderIds.includes(
        matchedDescriptor.descriptor.providerId,
      )
    ) {
      return `${oauthTarget}/${matchedDescriptor.modelId}`;
    }

    return buildProviderRuntimeModelRef(
      matchedDescriptor.descriptor,
      matchedDescriptor.modelId,
    );
  }

  if (isDesktopCloudConfig(config.desktop.cloud)) {
    const cloudModels = config.desktop.cloud.models;
    const slashIndex = rawModelId.indexOf("/");
    const modelSuffix =
      slashIndex > 0 ? rawModelId.slice(slashIndex + 1) : null;
    // Only use Link fallback if the model actually exists in Link's model list
    if (cloudModels.some((m) => m.id === rawModelId)) {
      return `link/${rawModelId}`;
    }
    if (
      modelSuffix &&
      cloudModels.some((m) => m.id === modelSuffix || m.name === modelSuffix)
    ) {
      return `link/${modelSuffix}`;
    }
  }

  if (env.litellmBaseUrl && env.litellmApiKey) {
    return `litellm/${rawModelId}`;
  }

  return rawModelId;
}

/**
 * Native sub-agent tools added to delegation-capable chat bots. The default tool
 * profile may not expose these, so we add them explicitly (see OpenClaw
 * docs/tools/subagents.md). Spiked working in the live runtime 2026-06-30.
 */
const SUBAGENT_DELEGATION_TOOLS = [
  "sessions_spawn",
  "sessions_yield",
  "subagents",
];

/**
 * Workboard's worker-completion protocol tools. Without these, a Workboard
 * dispatch worker's LLM turn finishes correctly but has no way to signal it —
 * the card sits in "running" forever even though the model already answered.
 * Verified live 2026-07-01: a worker without these tools replied correctly in
 * plain text instead of calling workboard_complete, per buildWorkerPrompt's
 * "Heartbeat with workboard_heartbeat ... call workboard_complete ... If
 * blocked, call workboard_block" instructions.
 */
const WORKBOARD_WORKER_TOOLS = [
  "workboard_heartbeat",
  "workboard_complete",
  "workboard_block",
];

const BROWSER_TOOLS = ["browser"];
// Exported so tests can assert this stays in sync with the independent
// allowlist inside static/runtime-plugins/nexu-toolcall-guard. The two lists
// are enforced at different layers (MCP tool filter vs. before_tool_call gate)
// and drift between them is either a silent capability gap or a dead entry.
export const CUA_TOOL_FILTER = [
  "check_permissions",
  "get_accessibility_tree",
  "get_cursor_position",
  "get_desktop_state",
  "get_screen_size",
  "get_session_state",
  "get_window_state",
  "list_apps",
  "list_windows",
  "click",
  "double_click",
  "right_click",
  "drag",
  "move_cursor",
  "scroll",
  "type_text",
  "press_key",
  "hotkey",
  "set_value",
  "launch_app",
  "start_session",
  "end_session",
  "escalate_session",
];

function isLocalAutomationPreviewEnabled(env: ControllerEnv): boolean {
  return env.localAutomationPreviewEnabled === true;
}

function compileAgentList(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState,
  installedSkillSlugs?: readonly string[],
  workspaceSkillsByAgent?: ReadonlyMap<string, readonly string[]>,
): OpenClawConfig["agents"]["list"] {
  const browserEnabled =
    isLocalAutomationPreviewEnabled(env) &&
    config.localAutomation?.browser.enabled === true;
  const sharedSlugs = [...(installedSkillSlugs ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );

  // Which agent OpenClaw's unbound entrypoints land on. Resolution order is
  // explicit defaultBotId → system bot → first active bot by slug; the list
  // itself stays slug-sorted for deterministic output.
  const resolvedDefault = resolveDefaultBotFromConfig(config);

  return config.bots
    .filter((bot) => bot.status === "active")
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((bot) => {
      const workspaceSlugs = [
        ...(workspaceSkillsByAgent?.get(bot.id) ?? []),
      ].sort((left, right) => left.localeCompare(right));
      const merged = Array.from(
        new Set([...sharedSlugs, ...workspaceSlugs]),
      ).sort((left, right) => left.localeCompare(right));

      // Chat assistants (not installed experts) can delegate one turn to an
      // expert bot via native sub-agents (in-chat auto-routing). OpenClaw's
      // sub-agent tool policy strips these tools from spawned children, so a
      // delegated expert cannot recurse. See
      // specs/design-docs/2026-06-30-in-chat-expert-auto-route.md.
      return {
        id: bot.id,
        name: bot.name,
        workspace: `${env.openclawStateDir}/agents/${bot.id}`,
        default: bot.id === resolvedDefault?.id,
        model: bot.modelId
          ? { primary: resolveModelId(config, env, bot.modelId, oauthState) }
          : undefined,
        ...(merged.length > 0 ? { skills: merged } : {}),
        tools: {
          alsoAllow: [
            ...SUBAGENT_DELEGATION_TOOLS,
            ...WORKBOARD_WORKER_TOOLS,
            ...(browserEnabled ? BROWSER_TOOLS : []),
          ],
        },
        subagents: { allowAgents: ["*"] },
      };
    });
}

function compilePlugins(
  config: NexuConfig,
  env: ControllerEnv,
  hasTeams: boolean,
): OpenClawConfig["plugins"] {
  const resolvedMiniMaxOauth = listModelProviderRuntimeDescriptors(config).some(
    (descriptor) =>
      descriptor.providerId === "minimax" &&
      descriptor.provider.enabled &&
      descriptor.provider.auth === "oauth" &&
      descriptor.legacyOauthCredential !== null,
  );

  const connectedPluginIds = [
    ...new Set(
      config.channels
        .filter((channel) => channel.status === "connected")
        .map((channel) => resolveManagedChannelPluginId(channel.channelType))
        .filter((pluginId): pluginId is string => pluginId !== null),
    ),
  ];
  // No prewarmed channel plugins. openclaw-lark/openclaw-weixin used to be
  // always allowed (+ enabled) so connecting Feishu/WeChat only mutated
  // channel-level config rather than plugins.allow. But always-loading them
  // together with the empty placeholder channels blocked controller readiness
  // for ~120s when no channel was configured. Allow/enable them only when a
  // matching channel is actually connected (via connectedPluginIds); the first
  // connect triggers a one-time gateway reload that then converges.
  const prewarmedChannelPluginIds: string[] = [];
  const analyticsEnabled = config.desktop.analyticsEnabled !== false;
  const platformPluginIds = [
    "nexu-runtime-model",
    "nexu-credit-guard",
    "nexu-platform-bootstrap",
    // Always allow langfuse-tracer so analytics preference changes only
    // toggle its `enabled` flag (hot-reload) instead of mutating
    // plugins.allow which triggers a full gateway restart (~11s).
    "langfuse-tracer",
    "nexu-a2ui",
    "nexu-toolcall-guard",
    "find-expert",
    "nexu-team",
    "nexu-canvas",
    ...(resolvedMiniMaxOauth ? ["minimax-portal-auth"] : []),
  ];

  const deviceControlEnabled = config.deviceControl.enabled;
  const localAutomationPreviewEnabled = isLocalAutomationPreviewEnabled(env);
  const browserEnabled =
    localAutomationPreviewEnabled &&
    config.localAutomation?.browser.enabled === true;

  // Sort and dedup defensively so `plugins.allow` is fully deterministic.
  // Without this, channel reorderings or brief status flaps change the
  // output order, which OpenClaw treats as a config change and triggers
  // a SIGUSR1 restart + 11s gateway drain per reload.
  const allow = Array.from(
    new Set([
      ...connectedPluginIds,
      ...prewarmedChannelPluginIds,
      ...platformPluginIds,
      ...(deviceControlEnabled ? ["tabby-control"] : []),
      ...(browserEnabled ? ["browser"] : []),
      // Workboard backs the team task board (decompose / dependencies /
      // dispatch). Bundled but disabled by default; enabling it adds a
      // plugin to plugins.allow which triggers a one-time gateway restart.
      ...(hasTeams ? ["workboard"] : []),
    ]),
  ).sort();

  return {
    load: {
      paths: [env.openclawExtensionsDir],
    },
    allow,
    entries: {
      ...(connectedPluginIds.includes("openclaw-lark")
        ? {
            "openclaw-lark": {
              enabled: true,
            },
          }
        : {}),
      ...(connectedPluginIds.includes("openclaw-weixin")
        ? {
            "openclaw-weixin": {
              enabled: true,
            },
          }
        : {}),
      ...(connectedPluginIds.includes("dingtalk-connector")
        ? {
            "dingtalk-connector": {
              enabled: true,
            },
          }
        : {}),
      ...(connectedPluginIds.includes("wecom")
        ? {
            wecom: {
              enabled: true,
            },
          }
        : {}),
      ...(connectedPluginIds.includes("openclaw-qqbot")
        ? {
            "openclaw-qqbot": {
              enabled: true,
            },
          }
        : {}),
      "nexu-runtime-model": {
        enabled: true,
        hooks: {
          allowConversationAccess: true,
        },
      },
      "nexu-platform-bootstrap": {
        enabled: true,
      },
      "langfuse-tracer": {
        enabled: analyticsEnabled,
      },
      "nexu-credit-guard": {
        enabled: true,
        hooks: {
          allowConversationAccess: true,
        },
      },
      "nexu-a2ui": {
        enabled: true,
      },
      "find-expert": {
        enabled: true,
        config: {
          // The plugin runs in the OpenClaw process and reaches the controller
          // on loopback to read the expert catalog + trigger installs.
          controllerUrl: `http://127.0.0.1:${env.port}`,
        },
      },
      "nexu-team": {
        enabled: true,
        config: {
          // Same loopback pattern as find-expert: the plugin resolves the
          // caller's team by leadBotId and drives the team board engine.
          controllerUrl: `http://127.0.0.1:${env.port}`,
        },
      },
      "nexu-canvas": {
        enabled: true,
        config: {
          // Same loopback pattern: canvas_read GETs the canvas mirror the web
          // frontend pushes. canvas_op is a pure courier and needs no URL.
          controllerUrl: `http://127.0.0.1:${env.port}`,
        },
      },
      "nexu-toolcall-guard": {
        enabled: true,
        hooks: {
          allowConversationAccess: true,
        },
      },
      ...(hasTeams
        ? {
            workboard: {
              enabled: true,
            },
          }
        : {}),
      ...(resolvedMiniMaxOauth
        ? {
            "minimax-portal-auth": {
              enabled: true,
            },
          }
        : {}),
      ...(deviceControlEnabled
        ? {
            "tabby-control": {
              enabled: true,
              config: {
                wsPort: config.deviceControl.wsPort,
                rpcPort: config.deviceControl.rpcPort,
              },
            },
          }
        : {}),
      ...(browserEnabled
        ? {
            browser: {
              enabled: true,
            },
          }
        : {}),
    },
  };
}

export function compileOpenClawConfig(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState = EMPTY_OAUTH_CONNECTION_STATE,
  installedSkillSlugs?: readonly string[],
  workspaceSkillsByAgent?: ReadonlyMap<string, readonly string[]>,
  hasTeams = false,
): OpenClawConfig {
  const disableMdnsDiscovery = process.env.CI === "true";
  const activeBots = config.bots.filter((bot) => bot.status === "active");
  const firstBotModel = activeBots[0]?.modelId ?? null;
  const defaultModelId = resolveModelId(
    config,
    env,
    firstBotModel ??
      getDesktopSelectedModel(config) ??
      config.runtime.defaultModelId,
    oauthState,
  );
  const utilityModelId = config.runtime.utilityModelId
    ? resolveModelId(config, env, config.runtime.utilityModelId, oauthState)
    : null;
  const computerUseEnabled =
    isLocalAutomationPreviewEnabled(env) &&
    config.localAutomation?.computerUse.enabled === true &&
    env.computerUseBackend !== null &&
    env.computerUsePlatformSupported !== false &&
    env.computerUseBin !== null &&
    path.isAbsolute(env.computerUseBin) &&
    existsSync(env.computerUseBin);
  const computerUseCuaSocket =
    env.computerUseCuaSocket ??
    path.join(env.nexuHomeDir, "runtime", "cua-driver", "daemon.sock");

  const openClawConfig: OpenClawConfig = {
    ...(disableMdnsDiscovery
      ? {
          discovery: {
            mdns: {
              mode: "off",
            },
          },
        }
      : {}),
    // Bundled, version-pinned OpenClaw must not phone npm for a newer version
    // on boot. `checkOnStart` is the `registry.npmjs.org/openclaw/latest` fetch
    // that times out on restricted networks (e.g. China) and stalls startup.
    // The OpenClaw version is managed by slimclaw + the desktop auto-updater.
    update: { checkOnStart: false },
    ...(isLocalAutomationPreviewEnabled(env) &&
    config.localAutomation?.browser.enabled === true
      ? {
          browser: {
            enabled: true,
            evaluateEnabled: false,
            defaultProfile: "chrome",
            profiles: {
              chrome: {
                driver: "extension",
                color: "#0F766E",
              },
            },
          },
        }
      : {}),
    ...(computerUseEnabled
      ? {
          mcp: {
            servers: {
              "cua-driver": {
                enabled: true,
                transport: "stdio",
                // The MCP process is a thin client of the daemon; the daemon
                // owns the platform grants, so this may run from the plain
                // executable path.
                command: env.computerUseBin,
                args: ["mcp", "--embedded", "--socket", computerUseCuaSocket],
                env: {
                  CUA_DRIVER_EMBEDDED: "1",
                  CUA_DRIVER_HOST_BUNDLE_ID: "io.tabby.desktop",
                  CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
                  CUA_DRIVER_TELEMETRY_HOME: path.join(
                    env.nexuHomeDir,
                    "runtime",
                    "cua-driver",
                  ),
                },
                connectionTimeoutMs: 10_000,
                requestTimeoutMs: 60_000,
                toolFilter: {
                  include: CUA_TOOL_FILTER,
                },
              },
            },
          },
        }
      : {}),
    gateway: {
      port: env.openclawGatewayPort,
      mode: "local",
      bind: config.runtime.gateway.bind,
      auth: {
        mode: config.runtime.gateway.authMode,
        ...(env.openclawGatewayToken
          ? { token: env.openclawGatewayToken }
          : {}),
      },
      reload: {
        mode: "hybrid",
      },
      controlUi: {
        ...(env.openclawBuiltinExtensionsDir
          ? {
              root: resolveControlUiRoot(env.openclawBuiltinExtensionsDir),
            }
          : {}),
        allowedOrigins: [
          env.webUrl,
          `http://127.0.0.1:${env.openclawGatewayPort}`,
          `http://localhost:${env.openclawGatewayPort}`,
        ],
        // Host-header origin fallback lets any page that can reach the port
        // pass the origin check, which defeats the allowlist under DNS
        // rebinding. List the real loopback origins instead.
        dangerouslyAllowHostHeaderOriginFallback: false,
      },
      http: {
        endpoints: {
          chatCompletions: {
            enabled: true,
          },
        },
        // tools.allow intentionally omitted — when absent, OpenClaw allows
        // all plugin-registered tools. An explicit allowlist here would be
        // validated as gateway.http.tools and reject unrecognised names.
      },
      // TEMP: removed to debug device_list visibility
    },
    agents: {
      defaults: {
        model: { primary: defaultModelId },
        // Route short internal tasks (generated session/thread titles) through
        // a cheaper model when configured; OpenClaw falls back to the primary
        // model when absent.
        ...(utilityModelId ? { utilityModel: utilityModelId } : {}),
        compaction: {
          // "safeguard" mode: Pi framework auto-compacts when prompt
          // approaches context window. The safeguard extension (compaction-
          // safeguard.ts) handles LLM summarization with quality guards.
          mode: "safeguard",
          // Max fraction of context window for retained history after
          // compaction. 0.3 = 70% reserved for system prompt + response.
          // Tested: 0.5 was too tight for models with large system prompts.
          maxHistoryShare: 0.3,
          keepRecentTokens: 20000,
          recentTurnsPreserve: 5,
          qualityGuard: { enabled: true },
          memoryFlush: {
            enabled: true,
          },
        },
        // LLM call timeout. OpenClaw default is 600s (10min).
        // 900s (15min) accommodates multi-step device-control workflows
        // (screenshot → describe → tap loops) that routinely exceed 5min
        // on slow Android devices.  Still well under compaction's 900s
        // safety timeout (EMBEDDED_COMPACTION_TIMEOUT_MS defaults to 900).
        timeoutSeconds: 900,
        humanDelay: {
          mode: "off",
        },
        verboseDefault: "off",
      },
      list: compileAgentList(
        config,
        env,
        oauthState,
        installedSkillSlugs,
        workspaceSkillsByAgent,
      ),
    },
    tools: {
      // Host shell execution is only available inside an explicitly enabled
      // sandbox. Outside one it is denied outright rather than left as an
      // implicit, unaudited way to drive the user's machine.
      ...(process.env.SANDBOX_ENABLED === "true"
        ? {}
        : { deny: ["exec", "process"] }),
      exec: {
        security: process.env.SANDBOX_ENABLED === "true" ? "full" : "deny",
        ask: "off",
        host: process.env.SANDBOX_ENABLED === "true" ? "sandbox" : "gateway",
      },
      web: {
        search: {
          enabled: true,
          ...(process.env.BRAVE_API_KEY
            ? { provider: "brave", apiKey: process.env.BRAVE_API_KEY }
            : {}),
        },
        fetch: {
          enabled: true,
        },
      },
      ...(process.env.SANDBOX_ENABLED === "true"
        ? {
            sandbox: {
              tools: {
                allow: [],
                deny: ["gateway"],
              },
            },
          }
        : {}),
    },
    session: {
      dmScope: "per-peer",
      // Disable automatic session reset. OpenClaw defaults to daily reset at
      // 4 AM which silently drops conversation history — unexpected for a
      // desktop chat app where users expect persistent sessions.
      reset: {
        mode: "idle",
        idleMinutes: 525_600, // 1 year
      },
    },
    cron: {
      enabled: true,
    },
    messages: {
      ackReaction: "eyes",
      ackReactionScope: "group-mentions",
      removeAckAfterReply: true,
    },
    models: compileModelsConfig(config, env),
    channels: compileChannelsConfig({
      channels: config.channels,
      secrets: config.secrets,
      gatewayBaseUrl: `http://127.0.0.1:${env.openclawGatewayPort}`,
      gatewayToken: env.openclawGatewayToken,
    }),
    bindings: compileChannelBindings(config.bots, config.channels),
    plugins: compilePlugins(config, env, hasTeams),
    skills: {
      load: {
        watch: true,
        watchDebounceMs: 250,
        extraDirs: [env.openclawSkillsDir, env.userSkillsDir].filter(Boolean),
      },
    },
    commands: {
      native: "auto",
      nativeSkills: "auto",
      restart: false,
      ownerDisplay: "raw",
      // OpenClaw 2026.7.1 treats a wildcard command owner as "every sender is
      // an owner", which exposes the owner-only `nodes`, `gateway`, and `cron`
      // tools to any channel. Do not reintroduce it on the strength of the
      // docs' claim that a wildcard alone is insufficient for ownership.
    },
    diagnostics: {
      enabled: true,
      ...(process.env.DD_API_KEY || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? {
            otel: {
              enabled: true,
              endpoint:
                process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
                `https://otlp.${process.env.DD_SITE ?? "datadoghq.com"}`,
              serviceName: process.env.OTEL_SERVICE_NAME ?? "nexu-openclaw",
              traces: true,
              metrics: true,
              logs: true,
              ...(process.env.DD_API_KEY
                ? {
                    headers: {
                      "dd-api-key": process.env.DD_API_KEY,
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
  };

  return openclawConfigSchema.parse(openClawConfig);
}
