import { describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import {
  type OAuthConnectionState,
  compileOpenClawConfig,
  resolveControlUiRoot,
} from "../src/lib/openclaw-config-compiler.js";
import type { NexuConfig } from "../src/store/schemas.js";

function createEnv(overrides: Record<string, unknown> = {}): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuHomeDir: "/tmp/nexu-test",
    nexuConfigPath: "/tmp/nexu-test/config.json",
    artifactsIndexPath: "/tmp/nexu-test/artifacts/index.json",
    compiledOpenclawSnapshotPath: "/tmp/nexu-test/compiled-openclaw.json",
    openclawStateDir: "/tmp/openclaw",
    openclawConfigPath: "/tmp/openclaw/openclaw.json",
    openclawSkillsDir: "/tmp/openclaw/skills",
    userSkillsDir: "/tmp/.agents/skills",
    openclawWorkspaceTemplatesDir: "/tmp/openclaw/workspace-templates",
    openclawBin: "openclaw",
    openclawGatewayPort: 18789,
    openclawGatewayToken: "token-123",
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "link/gemini-3-flash-preview",
    localAutomationPreviewEnabled: true,
    ...overrides,
  } as unknown as ControllerEnv;
}

function createConfig(overrides: Partial<NexuConfig> = {}): NexuConfig {
  const now = new Date().toISOString();
  return {
    $schema: "https://nexu.io/config.json",
    schemaVersion: 1,
    app: {},
    bots: [
      {
        id: "bot-1",
        name: "Assistant",
        slug: "assistant",
        poolId: null,
        status: "active",
        modelId: "anthropic/claude-sonnet-4",
        systemPrompt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    runtime: {
      gateway: {
        port: 18789,
        bind: "loopback",
        authMode: "token",
      },
      defaultModelId: "anthropic/claude-sonnet-4",
    },
    models: {
      mode: "merge",
      providers: {},
    },
    providers: [
      {
        id: "provider-1",
        providerId: "openai",
        displayName: "OpenAI",
        enabled: true,
        baseUrl: null,
        apiKey: "sk-test",
        models: ["gpt-4o"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "provider-2",
        providerId: "anthropic",
        displayName: "Anthropic Proxy",
        enabled: true,
        baseUrl: "https://proxy.example.com/v1",
        apiKey: "proxy-key",
        models: ["claude-sonnet-4"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    integrations: [],
    channels: [
      {
        id: "slack-channel-1",
        botId: "bot-1",
        channelType: "slack",
        accountId: "slack-A123-T123",
        status: "connected",
        teamName: "Acme",
        appId: "A123",
        botUserId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "feishu-channel-1",
        botId: "bot-1",
        channelType: "feishu",
        accountId: "cli_a1b2c3",
        status: "connected",
        teamName: null,
        appId: "cli_a1b2c3",
        botUserId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    templates: {},
    skills: {
      version: 1,
      defaults: {
        enabled: true,
        source: "inline",
      },
      items: {},
    },
    desktop: {
      selectedModelId: "gpt-4o",
      cloud: {
        linkUrl: "https://link.example.com",
        apiKey: "link-key",
        models: [
          {
            id: "gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            provider: "google",
          },
        ],
      },
    },
    deviceControl: {
      enabled: true,
      wsPort: 18790,
      rpcPort: 18801,
    },
    secrets: {
      "channel:slack-channel-1:botToken": "xoxb-test",
      "channel:slack-channel-1:signingSecret": "signing-secret",
      "channel:feishu-channel-1:appId": "cli_a1b2c3",
      "channel:feishu-channel-1:appSecret": "feishu-secret",
      "channel:feishu-channel-1:connectionMode": "webhook",
      "channel:feishu-channel-1:verificationToken": "verify-token",
    },
    ...overrides,
  } as unknown as NexuConfig;
}

describe("compileOpenClawConfig", () => {
  it("denies host shell execution outside an explicit sandbox", () => {
    const previousSandboxEnabled = process.env.SANDBOX_ENABLED;
    Reflect.deleteProperty(process.env, "SANDBOX_ENABLED");
    try {
      const result = compileOpenClawConfig(createConfig(), createEnv());
      expect(result.tools?.exec?.security).toBe("deny");
      expect(result.tools?.deny).toEqual(["exec", "process"]);
    } finally {
      if (previousSandboxEnabled === undefined) {
        Reflect.deleteProperty(process.env, "SANDBOX_ENABLED");
      } else {
        process.env.SANDBOX_ENABLED = previousSandboxEnabled;
      }
    }
  });

  it("pins the control UI to explicit loopback origins", () => {
    const result = compileOpenClawConfig(createConfig(), createEnv());
    expect(result.gateway.controlUi?.allowedOrigins).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:18789",
      "http://localhost:18789",
    ]);
    expect(
      result.gateway.controlUi?.dangerouslyAllowHostHeaderOriginFallback,
    ).toBe(false);
  });

  it("keeps local automation absent when the persisted config predates it", () => {
    const result = compileOpenClawConfig(createConfig(), createEnv());

    expect(result.browser).toBeUndefined();
    expect(result.mcp).toBeUndefined();
    expect(result.tools?.exec?.security).toBe("deny");
    expect(result.tools?.deny).toEqual(["exec", "process"]);
    expect(result.plugins?.allow).not.toContain("browser");
    expect(result.agents.list[0]?.tools?.alsoAllow).not.toContain("browser");
  });

  it("does not grant external command ownership or channel restarts", () => {
    const result = compileOpenClawConfig(createConfig(), createEnv());

    expect(result.commands?.restart).toBe(false);
    expect(result.commands?.ownerAllowFrom).toBeUndefined();
  });

  it("enables extension-backed control of explicitly paired Chrome tabs", () => {
    const result = compileOpenClawConfig(
      createConfig({
        localAutomation: {
          browser: { enabled: true },
          computerUse: { enabled: false },
        },
      }),
      createEnv(),
    );

    expect(result.browser).toEqual({
      enabled: true,
      evaluateEnabled: false,
      defaultProfile: "chrome",
      profiles: {
        chrome: { driver: "extension", color: "#0F766E" },
      },
    });
    expect(result.plugins?.allow).toContain("browser");
    expect(result.plugins?.entries?.browser).toEqual({ enabled: true });
    expect(result.agents.list[0]?.tools?.alsoAllow).toContain("browser");
    expect(result.tools?.exec?.security).toBe("deny");
    expect(result.tools?.deny).toEqual(["exec", "process"]);
  });

  it("fails closed when local automation preview is disabled", () => {
    const result = compileOpenClawConfig(
      createConfig({
        localAutomation: {
          browser: { enabled: true },
          computerUse: { enabled: true },
        },
      }),
      createEnv({
        localAutomationPreviewEnabled: false,
        computerUseBackend: "cua-driver",
        computerUseBin: process.execPath,
      }),
    );

    expect(result.browser).toBeUndefined();
    expect(result.mcp).toBeUndefined();
    expect(result.plugins?.allow).not.toContain("browser");
    expect(result.plugins?.entries?.browser).toBeUndefined();
    expect(result.agents.list[0]?.tools?.alsoAllow).not.toContain("browser");
    expect(result.agents.list[0]?.tools?.alsoAllow).not.toContain(
      "cua-driver__click",
    );
    expect(result.tools?.exec?.security).toBe("deny");
  });

  it("fails closed when the local automation preview flag is missing", () => {
    const result = compileOpenClawConfig(
      createConfig({
        localAutomation: {
          browser: { enabled: true },
          computerUse: { enabled: true },
        },
      }),
      createEnv({
        localAutomationPreviewEnabled: undefined,
        computerUseBackend: "cua-driver",
        computerUseBin: process.execPath,
      }),
    );

    expect(result.browser).toBeUndefined();
    expect(result.mcp).toBeUndefined();
  });

  it("registers the notarized CuaDriver bundle as the macOS MCP backend", () => {
    const result = compileOpenClawConfig(
      createConfig({
        localAutomation: {
          browser: { enabled: false },
          computerUse: { enabled: true },
        },
      }),
      createEnv({
        computerUseBackend: "cua-driver",
        computerUseBin: process.execPath,
      }),
    );
    const server = result.mcp?.servers["cua-driver"] as
      | Record<string, unknown>
      | undefined;

    expect(server).toMatchObject({
      command: process.execPath,
      transport: "stdio",
    });
    // The MCP process is a thin client of the daemon that owns the grants.
    expect(server?.args).toEqual(["mcp", "--embedded"]);
    expect(server?.toolFilter).toMatchObject({
      include: expect.arrayContaining([
        "click",
        "type_text",
        "set_value",
        "get_window_state",
      ]),
    });
    // Peekaboo's nested agent loop and remote-debugging browser are not part
    // of the reviewed surface on any platform.
    expect(server?.toolFilter).not.toMatchObject({
      include: expect.arrayContaining(["agent"]),
    });
    expect(result.tools?.exec?.security).toBe("deny");
  });

  it("registers cua-driver on Windows and omits a missing sidecar", () => {
    const enabledConfig = createConfig({
      localAutomation: {
        browser: { enabled: false },
        computerUse: { enabled: true },
      },
    });
    const available = compileOpenClawConfig(
      enabledConfig,
      createEnv({
        computerUseBackend: "cua-driver",
        computerUseBin: process.execPath,
      }),
    );
    const unavailable = compileOpenClawConfig(
      enabledConfig,
      createEnv({
        computerUseBackend: "cua-driver",
        computerUseBin: "/definitely/missing/cua-driver.exe",
      }),
    );

    expect(available.mcp?.servers["cua-driver"]).toMatchObject({
      command: process.execPath,
      args: ["mcp", "--embedded"],
      env: {
        CUA_DRIVER_EMBEDDED: "1",
        CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
      },
      toolFilter: {
        include: expect.arrayContaining([
          "get_desktop_state",
          "get_window_state",
          "type_text",
          "press_key",
        ]),
      },
    });
    expect(unavailable.mcp).toBeUndefined();
    expect(available.tools?.exec?.security).toBe("deny");
    expect(available.tools?.deny).toEqual(["exec", "process"]);
  });

  it("keeps command execution inside an explicitly enabled sandbox", () => {
    const previousSandboxEnabled = process.env.SANDBOX_ENABLED;
    process.env.SANDBOX_ENABLED = "true";
    try {
      const result = compileOpenClawConfig(createConfig(), createEnv());

      expect(result.tools?.exec).toMatchObject({
        security: "full",
        host: "sandbox",
      });
      expect(result.tools?.deny).toBeUndefined();
    } finally {
      if (previousSandboxEnabled === undefined) {
        Reflect.deleteProperty(process.env, "SANDBOX_ENABLED");
      } else {
        process.env.SANDBOX_ENABLED = previousSandboxEnabled;
      }
    }
  });

  it("does not expose persisted Computer Use on an unsupported platform", () => {
    const result = compileOpenClawConfig(
      createConfig({
        localAutomation: {
          browser: { enabled: false },
          computerUse: { enabled: true },
        },
      }),
      createEnv({
        computerUseBackend: "peekaboo",
        computerUseBin: process.execPath,
        computerUsePlatformSupported: false,
      }),
    );

    expect(result.mcp).toBeUndefined();
  });

  it("marks the desktop defaultBotId agent as the default agent", () => {
    const now = new Date().toISOString();
    const botBase = {
      poolId: null,
      status: "active",
      modelId: "anthropic/claude-sonnet-4",
      systemPrompt: null,
      origin: "user",
      createdAt: now,
      updatedAt: now,
    };
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          { ...botBase, id: "bot-a", name: "A", slug: "aaa" },
          { ...botBase, id: "bot-z", name: "Z", slug: "zzz" },
        ],
        desktop: { defaultBotId: "bot-z" },
      } as unknown as Partial<NexuConfig>),
      createEnv(),
    );

    const defaultFlags = Object.fromEntries(
      result.agents.list.map((agent) => [agent.id, agent.default]),
    );
    expect(defaultFlags).toEqual({ "bot-a": false, "bot-z": true });
  });

  it("marks the system bot as the default agent when no defaultBotId is set", () => {
    const now = new Date().toISOString();
    const botBase = {
      poolId: null,
      status: "active",
      modelId: "anthropic/claude-sonnet-4",
      systemPrompt: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          { ...botBase, id: "bot-a", name: "A", slug: "aaa", origin: "user" },
          {
            ...botBase,
            id: "bot-sys",
            name: "Tabby",
            slug: "zzz-tabby",
            origin: "system",
          },
        ],
        desktop: {},
      } as unknown as Partial<NexuConfig>),
      createEnv(),
    );

    const defaultFlags = Object.fromEntries(
      result.agents.list.map((agent) => [agent.id, agent.default]),
    );
    expect(defaultFlags).toEqual({ "bot-a": false, "bot-sys": true });
  });

  it("emits sub-agent delegation config on every agent (in-chat auto-routing)", () => {
    const result = compileOpenClawConfig(createConfig(), createEnv());
    expect(result.agents.list.length).toBeGreaterThan(0);
    for (const agent of result.agents.list) {
      expect(agent.tools).toMatchObject({
        alsoAllow: expect.arrayContaining(["sessions_spawn", "sessions_yield"]),
      });
      expect(agent.subagents).toEqual({ allowAgents: ["*"] });
    }
  });

  it("builds OpenClaw config with provider and channel parity defaults", () => {
    // Provide canonical models.providers so the compiler can resolve provider
    // descriptors (legacy config.providers is not read by the compiler).
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        models: {
          mode: "merge",
          providers: {
            openai: {
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "sk-test",
              baseUrl: "https://api.openai.com/v1",
              models: [
                {
                  id: "gpt-4o",
                  name: "gpt-4o",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
            // Proxy baseUrl → runtime key becomes byok_anthropic
            anthropic: {
              enabled: true,
              auth: "api-key",
              api: "anthropic-messages",
              apiKey: "proxy-key",
              baseUrl: "https://proxy.example.com/v1",
              models: [
                {
                  id: "claude-sonnet-4",
                  name: "claude-sonnet-4",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          } as unknown as Record<string, unknown>,
        } as unknown as NexuConfig["models"],
        providers: [],
        createdAt: now,
        updatedAt: now,
      } as unknown as Partial<NexuConfig>),
      createEnv(),
    );

    expect(result.gateway.auth.mode).toBe("token");
    expect(result.gateway.auth.token).toBe("token-123");
    expect(result.gateway.controlUi?.allowedOrigins).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:18789",
      "http://localhost:18789",
    ]);
    expect(
      result.gateway.controlUi?.dangerouslyAllowHostHeaderOriginFallback,
    ).toBe(false);
    // bot modelId "anthropic/claude-sonnet-4" matches the proxied anthropic
    // descriptor (byok_anthropic); namespace prefix is stripped from model id.
    expect(result.agents.defaults?.model).toEqual({
      primary: "byok_anthropic/claude-sonnet-4",
    });
    expect(result.agents.list[0]).toMatchObject({
      id: "bot-1",
      workspace: "/tmp/openclaw/agents/bot-1",
      model: { primary: "byok_anthropic/claude-sonnet-4" },
    });
    expect(result.models?.providers.openai?.models[0]?.id).toBe("gpt-4o");
    // BYOK anthropic proxy: model id stored bare (canonical prefix stripped)
    expect(result.models?.providers.byok_anthropic?.models[0]?.id).toBe(
      "claude-sonnet-4",
    );
    expect(result.models?.providers.link?.baseUrl).toBe(
      "https://link.example.com/v1",
    );
    expect(result.channels.slack?.accounts["slack-A123-T123"]).toMatchObject({
      mode: "http",
      webhookPath: "/slack/events/slack-A123-T123",
      botToken: "xoxb-test",
    });
    expect(result.channels.feishu?.accounts.cli_a1b2c3).toMatchObject({
      connectionMode: "webhook",
      webhookPath: "/feishu/events/cli_a1b2c3",
      verificationToken: "verify-token",
    });
    // Feishu Card Kit streaming was added intentionally (commit 626adb7b9)
    expect(result.channels.feishu).toMatchObject({
      streaming: true,
      renderMode: "card",
      requireMention: true,
    });
    // Plugin key is "openclaw-lark" since commit 66ac77e7a
    expect(result.plugins?.entries?.["openclaw-lark"]?.enabled).toBe(true);
    expect(result.skills?.load?.extraDirs).toEqual([
      "/tmp/openclaw/skills",
      "/tmp/.agents/skills",
    ]);
  });

  it("does not allow/enable openclaw-weixin without a connected wechat channel", () => {
    // The empty-config prewarm was removed because always-loading the channel
    // plugins (plus the placeholder channels) blocked controller readiness for
    // ~120s. openclaw-weixin is only allowed/enabled once a real WeChat channel
    // connects; the first connect then triggers a one-time gateway reload.
    const result = compileOpenClawConfig(
      createConfig({
        channels: [],
        secrets: {},
      }),
      createEnv(),
    );

    expect(result.plugins?.allow).not.toContain("openclaw-weixin");
    expect(result.plugins?.entries?.["openclaw-weixin"]).toBeUndefined();
  });

  it("compiles qqbot channels and enables the canonical qq plugin id", () => {
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        channels: [
          {
            id: "qq-channel-1",
            botId: "bot-1",
            channelType: "qqbot",
            accountId: "default",
            status: "connected",
            teamName: null,
            appId: "123456",
            botUserId: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        secrets: {
          "channel:qq-channel-1:appId": "123456",
          "channel:qq-channel-1:clientSecret": "qq-secret",
        },
      }),
      createEnv(),
    );

    expect(result.channels.qqbot).toMatchObject({
      enabled: true,
      appId: "123456",
      clientSecret: "qq-secret",
      dmPolicy: "open",
      groupPolicy: "open",
      historyLimit: 50,
      markdownSupport: true,
    });
    expect(result.bindings).toContainEqual({
      agentId: "bot-1",
      match: {
        channel: "qqbot",
        accountId: "default",
      },
    });
    expect(result.plugins?.allow).toContain("openclaw-qqbot");
    expect(result.plugins?.entries?.["openclaw-qqbot"]?.enabled).toBe(true);
  });

  it("compiles wecom channels and enables the canonical wecom plugin id", () => {
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        channels: [
          {
            id: "wecom-channel-1",
            botId: "bot-1",
            channelType: "wecom",
            accountId: "default",
            status: "connected",
            teamName: null,
            appId: "wecom-bot-123",
            botUserId: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        secrets: {
          "channel:wecom-channel-1:botId": "wecom-bot-123",
          "channel:wecom-channel-1:secret": "wecom-secret",
        },
      }),
      createEnv(),
    );

    expect(result.channels.wecom).toMatchObject({
      enabled: true,
      botId: "wecom-bot-123",
      secret: "wecom-secret",
      dmPolicy: "open",
      groupPolicy: "open",
      sendThinkingMessage: true,
    });
    expect(result.bindings).toContainEqual({
      agentId: "bot-1",
      match: {
        channel: "wecom",
        accountId: "default",
      },
    });
    expect(result.plugins?.allow).toContain("wecom");
    expect(result.plugins?.entries?.wecom?.enabled).toBe(true);
  });

  it("injects env-backed litellm routing for bare local model ids", () => {
    const result = compileOpenClawConfig(
      createConfig({
        providers: [],
        desktop: {},
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "anthropic/claude-sonnet-4",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "anthropic/claude-sonnet-4",
        },
      }),
      createEnv({
        litellmBaseUrl: "https://litellm.powerformer.net",
        litellmApiKey: "litellm-key",
      }),
    );

    expect(result.models?.providers.litellm?.baseUrl).toBe(
      "https://litellm.powerformer.net",
    );
    expect(result.models?.providers.litellm?.models[0]?.id).toBe(
      "anthropic/claude-sonnet-4",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "litellm/anthropic/claude-sonnet-4",
    });
    expect(result.agents.list[0]?.model).toEqual({
      primary: "litellm/anthropic/claude-sonnet-4",
    });
  });

  it("compiles dingtalk channels and enables the canonical dingtalk plugin id", () => {
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        channels: [
          {
            id: "dingtalk-channel-1",
            botId: "bot-1",
            channelType: "dingtalk",
            accountId: "default",
            status: "connected",
            teamName: null,
            appId: "ding-client-id",
            botUserId: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        secrets: {
          "channel:dingtalk-channel-1:clientId": "ding-client-id",
          "channel:dingtalk-channel-1:clientSecret": "ding-client-secret",
        },
      }),
      createEnv(),
    );

    expect(result.plugins?.entries?.["tabby-control"]).toEqual({
      enabled: true,
      config: {
        wsPort: 18790,
        rpcPort: 18801,
      },
    });

    expect(result.channels["dingtalk-connector"]).toMatchObject({
      enabled: true,
      clientId: "ding-client-id",
      clientSecret: "ding-client-secret",
      gatewayBaseUrl: "http://127.0.0.1:18789",
      gatewayToken: "token-123",
      dmPolicy: "open",
      groupPolicy: "open",
    });
    expect(
      (
        result.gateway as {
          http?: { endpoints?: { chatCompletions?: { enabled?: boolean } } };
        }
      ).http?.endpoints?.chatCompletions?.enabled,
    ).toBe(true);
    // dingtalk accountId "default" is mapped to "__default__" at runtime
    // (resolveOpenClawRuntimeAccountId, added in commit e825ac79e)
    expect(result.bindings).toContainEqual({
      agentId: "bot-1",
      match: {
        channel: "dingtalk-connector",
        accountId: "__default__",
      },
    });
    expect(result.plugins?.allow).toContain("dingtalk-connector");
    expect(result.plugins?.entries?.["dingtalk-connector"]?.enabled).toBe(true);
  });

  it("does not remap openai models to OAuth providers without persisted OAuth state", () => {
    const baseConfig = createConfig();
    const baseBot = baseConfig.bots[0];
    const baseProvider = baseConfig.providers?.[0];
    if (!baseBot || !baseProvider) {
      throw new Error("expected base config fixtures");
    }
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...baseBot,
            modelId: "openai/gpt-5.4",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "openai/gpt-5.4",
        },
        providers: [
          {
            ...baseProvider,
            apiKey: null,
            models: ["gpt-5.4"],
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.agents.defaults?.model).toEqual({
      primary: "openai/gpt-5.4",
    });
    expect(result.agents.list[0]?.model).toEqual({
      primary: "openai/gpt-5.4",
    });
  });

  it("uses SiliconFlow's cn API base URL by default", () => {
    // Use canonical models.providers so the compiler can resolve the descriptor.
    // Legacy config.providers is not read by the compiler.
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [],
        models: {
          mode: "merge",
          providers: {
            siliconflow: {
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "sk-test",
              // null baseUrl → compiler picks default: https://api.siliconflow.cn/v1
              baseUrl: "https://api.siliconflow.cn/v1",
              models: [
                {
                  id: "Pro/MiniMaxAI/MiniMax-M2.5",
                  name: "Pro/MiniMaxAI/MiniMax-M2.5",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          } as unknown as Record<string, unknown>,
        } as unknown as NexuConfig["models"],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.siliconflow?.baseUrl).toBe(
      "https://api.siliconflow.cn/v1",
    );
    expect(result.models?.providers.siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("treats the explicit SiliconFlow .cn URL as a direct official endpoint", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [],
        models: {
          mode: "merge",
          providers: {
            siliconflow: {
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "sk-test",
              baseUrl: "https://api.siliconflow.cn/v1",
              models: [
                {
                  id: "Pro/MiniMaxAI/MiniMax-M2.5",
                  name: "Pro/MiniMaxAI/MiniMax-M2.5",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          } as unknown as Record<string, unknown>,
        } as unknown as NexuConfig["models"],
        desktop: {},
      }),
      createEnv(),
    );

    // .cn is a default URL → direct (non-proxy) mode, runtimeKey = "siliconflow"
    expect(result.models?.providers.siliconflow?.baseUrl).toBe(
      "https://api.siliconflow.cn/v1",
    );
    expect(result.models?.providers.byok_siliconflow).toBeUndefined();
    expect(result.models?.providers.siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("treats the legacy SiliconFlow .com URL as a direct default endpoint", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [],
        models: {
          mode: "merge",
          providers: {
            siliconflow: {
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "sk-test",
              // .com is also in defaultBaseUrls → direct (non-proxy) mode
              baseUrl: "https://api.siliconflow.com/v1",
              models: [
                {
                  id: "Pro/MiniMaxAI/MiniMax-M2.5",
                  name: "Pro/MiniMaxAI/MiniMax-M2.5",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          } as unknown as Record<string, unknown>,
        } as unknown as NexuConfig["models"],
        desktop: {},
      }),
      createEnv(),
    );

    // .com is a legacy default URL (in defaultBaseUrls) → direct mode, not proxied
    expect(result.models?.providers.siliconflow?.baseUrl).toBe(
      "https://api.siliconflow.com/v1",
    );
    expect(result.models?.providers.byok_siliconflow).toBeUndefined();
    expect(result.models?.providers.siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("treats custom SiliconFlow gateway URLs as proxied endpoints", () => {
    // Use the canonical persisted modelId form: "siliconflow/Pro/..." (not
    // "byok_siliconflow/siliconflow/..." which was the pre-normalisation legacy form).
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [],
        models: {
          mode: "merge",
          providers: {
            siliconflow: {
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "sk-test",
              // Custom (non-default) baseUrl → proxy mode, runtimeKey = byok_siliconflow
              baseUrl: "https://models.example.com/v1",
              models: [
                {
                  id: "Pro/MiniMaxAI/MiniMax-M2.5",
                  name: "Pro/MiniMaxAI/MiniMax-M2.5",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          } as unknown as Record<string, unknown>,
        } as unknown as NexuConfig["models"],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.byok_siliconflow?.baseUrl).toBe(
      "https://models.example.com/v1",
    );
    expect(result.models?.providers.siliconflow).toBeUndefined();
    // BYOK proxy: canonical namespace prefix ("siliconflow/") is stripped from model id
    expect(result.models?.providers.byok_siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    // resolveModelId: "siliconflow/Pro/..." matched by "siliconflow" prefix on
    // byok descriptor → produces "byok_siliconflow/Pro/MiniMaxAI/MiniMax-M2.5"
    expect(result.agents.defaults?.model).toEqual({
      primary: "byok_siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("ignores unsupported custom providers in compiled model config", () => {
    const baseConfig = createConfig();
    const baseProviders = baseConfig.providers ?? [];
    const baseProvider = baseProviders[0];
    if (!baseProvider) {
      throw new Error("expected base config providers");
    }
    const result = compileOpenClawConfig(
      createConfig({
        providers: [
          ...baseProviders,
          {
            ...baseProvider,
            id: "provider-3",
            providerId: "custom",
            displayName: "Custom",
            baseUrl: "https://models.example.com/v1",
            apiKey: "custom-key",
            models: ["anthropic/claude-sonnet-4"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
      createEnv(),
    );

    expect(Object.keys(result.models?.providers ?? {})).not.toContain("custom");
    expect(
      Object.keys(result.models?.providers ?? {}).some((key) =>
        key.startsWith("custom_"),
      ),
    ).toBe(false);
  });

  it("uses the CN MiniMax endpoint for CN OAuth providers", () => {
    // Use canonical models.providers format; legacy config.providers is not
    // read by the compiler. CN region → resolveDefaultBaseUrls returns the
    // CN endpoint first: https://api.minimaxi.com/anthropic
    const result = compileOpenClawConfig(
      createConfig({
        providers: [],
        models: {
          mode: "merge",
          providers: {
            minimax: {
              enabled: true,
              auth: "oauth",
              api: "anthropic-messages",
              oauthRegion: "cn",
              oauthProfileRef: "minimax-portal",
              // null baseUrl → resolveDefaultBaseUrls("minimax","cn") picks CN first
              baseUrl: "https://api.minimaxi.com/anthropic",
              models: [
                {
                  id: "MiniMax-M2.7",
                  name: "MiniMax-M2.7",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          } as unknown as Record<string, unknown>,
        } as unknown as NexuConfig["models"],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.minimax?.baseUrl).toBe(
      "https://api.minimaxi.com/anthropic",
    );
  });

  it("compiles canonical custom provider instances with deterministic runtime keys", () => {
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "custom-openai/team-gateway/anthropic/claude-haiku-4.5",
            createdAt: now,
            updatedAt: now,
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId:
            "custom-openai/team-gateway/anthropic/claude-haiku-4.5",
        },
        providers: [],
        models: {
          mode: "merge",
          providers: {
            "custom-openai/team-gateway": {
              providerTemplateId: "custom-openai",
              instanceId: "team-gateway",
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "custom-key",
              baseUrl: "https://gateway.example.com/v1",
              displayName: "Team Gateway",
              headers: {
                "x-team-id": "team-gateway",
              },
              models: [
                {
                  id: "anthropic/claude-haiku-4.5",
                  name: "Claude Haiku 4.5",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          },
        },
        desktop: {},
      }),
      createEnv(),
    );

    expect(
      result.models?.providers["custom-openai__team-gateway"],
    ).toMatchObject({
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "custom-key",
      api: "openai-completions",
      headers: {
        "x-team-id": "team-gateway",
      },
    });
    expect(
      result.models?.providers["custom-openai__team-gateway"]?.models[0]?.id,
    ).toBe("anthropic/claude-haiku-4.5");
    expect(result.agents.defaults?.model).toEqual({
      primary: "custom-openai__team-gateway/anthropic/claude-haiku-4.5",
    });
  });

  it("preserves secret-ref provider API keys in compiled models config", () => {
    const result = compileOpenClawConfig(
      createConfig({
        providers: [],
        models: {
          mode: "merge",
          providers: {
            openai: {
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: {
                source: "env",
                provider: "nexu",
                id: "openai-api-key",
              },
              baseUrl: "https://api.openai.com/v1",
              models: [
                {
                  id: "gpt-4.1",
                  name: "GPT-4.1",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          },
        },
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.openai?.apiKey).toEqual({
      source: "env",
      provider: "nexu",
      id: "openai-api-key",
    });
    expect(result.models?.providers.openai?.models[0]?.id).toBe("gpt-4.1");
  });

  it("normalizes legacy byok model refs against canonical provider config", () => {
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "byok_openai/openai/gpt-4.1",
            createdAt: now,
            updatedAt: now,
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "byok_openai/openai/gpt-4.1",
        },
        providers: [],
        models: {
          mode: "merge",
          providers: {
            openai: {
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "sk-test",
              baseUrl: "https://api.openai.com/v1",
              models: [
                {
                  id: "gpt-4.1",
                  name: "GPT-4.1",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          },
        },
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.agents.defaults?.model).toEqual({
      primary: "openai/gpt-4.1",
    });
  });

  describe("agent skill assignment", () => {
    it("includes skills on agents when installedSlugs is provided", () => {
      const config = createConfig();
      const env = createEnv();
      const compiled = compileOpenClawConfig(config, env, undefined, [
        "git",
        "npm",
      ]);
      expect(compiled.agents.list[0].skills).toEqual(["git", "npm"]);
    });

    it("omits skills field when installedSlugs is empty (legacy fallback)", () => {
      const config = createConfig();
      const env = createEnv();
      const compiled = compileOpenClawConfig(config, env, undefined, []);
      expect(compiled.agents.list[0]).not.toHaveProperty("skills");
    });

    it("omits skills field when installedSlugs is undefined", () => {
      const config = createConfig();
      const env = createEnv();
      const compiled = compileOpenClawConfig(config, env);
      expect(compiled.agents.list[0]).not.toHaveProperty("skills");
    });

    it("assigns same skills to all active agents", () => {
      const now = new Date().toISOString();
      const config = createConfig({
        bots: [
          {
            id: "bot-1",
            name: "Bot A",
            slug: "bot-a",
            poolId: null,
            status: "active",
            modelId: "anthropic/claude-sonnet-4",
            systemPrompt: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "bot-2",
            name: "Bot B",
            slug: "bot-b",
            poolId: null,
            status: "active",
            modelId: "anthropic/claude-sonnet-4",
            systemPrompt: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      const env = createEnv();
      const compiled = compileOpenClawConfig(config, env, undefined, [
        "calendar",
      ]);
      expect(compiled.agents.list).toHaveLength(2);
      expect(compiled.agents.list[0].skills).toEqual(["calendar"]);
      expect(compiled.agents.list[1].skills).toEqual(["calendar"]);
    });
  });

  describe("per-agent workspace skill merge", () => {
    it("merges shared and workspace skills for each agent", () => {
      const now = new Date().toISOString();
      const config = createConfig({
        bots: [
          {
            id: "bot-1",
            name: "Bot A",
            slug: "bot-a",
            poolId: null,
            status: "active",
            modelId: "anthropic/claude-sonnet-4",
            systemPrompt: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "bot-2",
            name: "Bot B",
            slug: "bot-b",
            poolId: null,
            status: "active",
            modelId: "anthropic/claude-sonnet-4",
            systemPrompt: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      const wsMap = new Map<string, readonly string[]>([
        ["bot-1", ["agent-tool"]],
      ]);
      const compiled = compileOpenClawConfig(
        config,
        createEnv(),
        undefined,
        ["shared-skill"],
        wsMap,
      );

      const botA = compiled.agents.list.find((a) => a.id === "bot-1");
      expect(botA?.skills).toEqual(
        expect.arrayContaining(["shared-skill", "agent-tool"]),
      );
      expect(botA?.skills).toHaveLength(2);

      const botB = compiled.agents.list.find((a) => a.id === "bot-2");
      expect(botB?.skills).toEqual(["shared-skill"]);
    });

    it("sorts merged skills deterministically regardless of input order", () => {
      const baseConfig = createConfig();
      const baseBot = baseConfig.bots[0];
      if (!baseBot) {
        throw new Error("expected base config bot");
      }
      const config = createConfig({
        bots: [
          {
            ...baseBot,
            id: "bot-a",
            slug: "bot-a",
          },
        ],
        channels: [],
      });

      const compiled = compileOpenClawConfig(
        config,
        createEnv(),
        undefined,
        ["zeta", "alpha", "shared-skill"],
        new Map([["bot-a", ["workspace-z", "alpha", "workspace-a"]]]),
      );

      expect(compiled.agents.list[0]?.skills).toEqual([
        "alpha",
        "shared-skill",
        "workspace-a",
        "workspace-z",
        "zeta",
      ]);
    });

    it("deduplicates when same slug in shared and workspace", () => {
      const config = createConfig();
      const wsMap = new Map<string, readonly string[]>([
        ["bot-1", ["shared-skill"]],
      ]);
      const compiled = compileOpenClawConfig(
        config,
        createEnv(),
        undefined,
        ["shared-skill"],
        wsMap,
      );
      const agent = compiled.agents.list[0];
      expect(agent.skills).toEqual(["shared-skill"]);
    });

    it("workspace-only skills still activate allowlist", () => {
      const config = createConfig();
      const wsMap = new Map<string, readonly string[]>([
        ["bot-1", ["ws-only"]],
      ]);
      const compiled = compileOpenClawConfig(
        config,
        createEnv(),
        undefined,
        [],
        wsMap,
      );
      expect(compiled.agents.list[0].skills).toEqual(["ws-only"]);
    });

    it("omits skills when both shared and workspace are empty", () => {
      const config = createConfig();
      const wsMap = new Map<string, readonly string[]>();
      const compiled = compileOpenClawConfig(
        config,
        createEnv(),
        undefined,
        [],
        wsMap,
      );
      expect(compiled.agents.list[0]).not.toHaveProperty("skills");
    });
  });

  it("remaps openai models to OAuth provider ids when persisted OAuth state is connected", () => {
    const baseConfig = createConfig();
    const baseBot = baseConfig.bots[0];
    if (!baseBot) {
      throw new Error("expected base config fixtures");
    }
    const oauthState: OAuthConnectionState = {
      connectedProviderIds: ["openai"],
    };
    // Use canonical models.providers so resolveModelId can find the "openai"
    // descriptor and apply the OAUTH_PROVIDER_MAP remap (openai → openai-codex).
    // Legacy config.providers is not read by the compiler.
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...baseBot,
            modelId: "openai/gpt-5.4",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "openai/gpt-5.4",
        },
        providers: [],
        models: {
          mode: "merge",
          providers: {
            openai: {
              enabled: true,
              // No apiKey (OAuth flow) — auth left unset so schema doesn't
              // require apiKey; provider still appears in descriptor list.
              baseUrl: "https://api.openai.com/v1",
              models: [
                {
                  id: "gpt-5.4",
                  name: "gpt-5.4",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          } as unknown as Record<string, unknown>,
        } as unknown as NexuConfig["models"],
        desktop: {},
      }),
      createEnv(),
      oauthState,
    );

    expect(result.agents.defaults?.model).toEqual({
      primary: "openai-codex/gpt-5.4",
    });
    expect(result.agents.list[0]?.model).toEqual({
      primary: "openai-codex/gpt-5.4",
    });
  });

  it("omits empty apiKey fields for oauth-backed providers in compiled models config", () => {
    const result = compileOpenClawConfig(
      createConfig({
        providers: [],
        models: {
          mode: "merge",
          providers: {
            openai: {
              enabled: true,
              auth: "oauth",
              api: "openai-completions",
              apiKey: null,
              oauthProfileRef: "openai-codex",
              baseUrl: "https://api.openai.com/v1",
              models: [
                {
                  id: "gpt-5.4",
                  name: "GPT-5.4",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          },
        },
        desktop: {
          selectedModelId: null,
        },
      }),
      createEnv(),
    );

    expect(result.models?.providers.openai).toBeDefined();
    expect(result.models?.providers.openai).not.toHaveProperty("apiKey");
    expect(result.models?.providers.openai?.models[0]?.id).toBe("gpt-5.4");
  });
});

/**
 * Regression guard for the packaged-app control UI 503: the launchd path
 * passes the real `<pkg>/dist/extensions` layout, and the old derivation
 * appended another "dist", producing `<pkg>/dist/dist/control-ui`.
 */
describe("resolveControlUiRoot", () => {
  it("maps the packaged dist/extensions layout to dist/control-ui", () => {
    expect(
      resolveControlUiRoot("/app/node_modules/openclaw/dist/extensions"),
    ).toBe("/app/node_modules/openclaw/dist/control-ui");
  });

  it("maps the legacy package-root extensions layout to dist/control-ui", () => {
    expect(resolveControlUiRoot("/app/node_modules/openclaw/extensions")).toBe(
      "/app/node_modules/openclaw/dist/control-ui",
    );
  });

  it("is wired into the compiled gateway config", () => {
    const result = compileOpenClawConfig(
      createConfig(),
      createEnv({
        openclawBuiltinExtensionsDir:
          "/app/node_modules/openclaw/dist/extensions",
      }),
    );

    expect(result.gateway.controlUi?.root).toBe(
      "/app/node_modules/openclaw/dist/control-ui",
    );
  });
});

describe("compileOpenClawConfig > workboard (teams) gating", () => {
  it("omits the workboard plugin when no teams exist (hasTeams unset)", () => {
    const result = compileOpenClawConfig(createConfig(), createEnv());
    expect(result.plugins?.allow).not.toContain("workboard");
    expect(result.plugins?.entries?.workboard).toBeUndefined();
  });

  it("enables the workboard plugin when hasTeams is true", () => {
    const result = compileOpenClawConfig(
      createConfig(),
      createEnv(),
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(result.plugins?.allow).toContain("workboard");
    expect(result.plugins?.entries?.workboard).toEqual({ enabled: true });
  });
});
