import { readFileSync, statSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import type { OpenClawProcessManager } from "../src/runtime/openclaw-process.js";
import { ModelProviderService } from "../src/services/model-provider-service.js";
import type {
  OpenClawGatewayService,
  OpenClawModelsListResult,
} from "../src/services/openclaw-gateway-service.js";
import type { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import type { NexuConfigStore } from "../src/store/nexu-config-store.js";

const childProcessMocks = vi.hoisted(() => ({ execFile: vi.fn() }));
const fsPromiseMocks = vi.hoisted(() => ({ access: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFile: childProcessMocks.execFile };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, access: fsPromiseMocks.access };
});

type GatewayStub = {
  isConnected: () => boolean;
  listModels: (view: "all" | "configured") => Promise<OpenClawModelsListResult>;
};

type ExecCapture = {
  command?: unknown;
  args?: unknown;
  options?: unknown;
  probeConfig?: string;
  probeConfigs?: string[];
  probeConfigMode?: number;
};

function createService(
  gateway?: GatewayStub,
  storedProvider: Awaited<ReturnType<NexuConfigStore["getProvider"]>> = null,
): ModelProviderService {
  const service = new ModelProviderService(
    {
      getProvider: vi.fn(async () => storedProvider),
    } as unknown as NexuConfigStore,
    {
      manageOpenclawProcess: false,
      openclawBin: "/bundled/openclaw",
      openclawStateDir: "/runtime/openclaw",
      openclawConfigPath: "/runtime/openclaw/openclaw.json",
      openclawExtensionsDir: "/runtime/openclaw/extensions",
    } as ControllerEnv,
    {} as OpenClawSyncService,
    {} as OpenClawProcessManager,
  );
  if (gateway) {
    service.setGatewayService(gateway as OpenClawGatewayService);
  }
  return service;
}

function createGateway(overrides?: Partial<GatewayStub>): GatewayStub {
  return {
    isConnected: () => true,
    listModels: vi.fn(async () => ({
      models: [
        {
          id: "amazon.nova-lite-v1:0",
          name: "Nova Lite",
          provider: "amazon-bedrock",
          available: true,
          contextWindow: 300_000,
          reasoning: false,
          input: ["text"],
        },
        {
          id: "anthropic.claude-sonnet-4",
          name: "Claude Sonnet 4",
          provider: "amazon-bedrock",
          available: true,
          contextWindow: 200_000,
          reasoning: true,
          input: ["text", "image"],
        },
        {
          id: "anthropic.claude-unavailable",
          name: "Claude Unavailable",
          provider: "amazon-bedrock",
          available: false,
        },
        {
          id: "claude-sonnet-4",
          name: "Claude Sonnet 4",
          provider: "anthropic",
          available: true,
        },
      ],
    })),
    ...overrides,
  };
}

function probeJson(
  status: string,
  options?: { provider?: string; error?: string; model?: string },
): string {
  return JSON.stringify({
    auth: {
      probes: {
        totalTargets: 1,
        results: [
          {
            provider: options?.provider ?? "amazon-bedrock",
            model: options?.model ?? "amazon-bedrock/amazon.nova-lite-v1:0",
            status,
            ...(options?.error ? { error: options.error } : {}),
          },
        ],
      },
    },
  });
}

function installExecResult(
  stdout: string | string[],
  capture: ExecCapture = {},
): ExecCapture {
  let callIndex = 0;
  childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
    const [command, commandArgs, options, callback] = args;
    capture.command = command;
    capture.args = commandArgs;
    capture.options = options;

    if (typeof options === "object" && options !== null && "env" in options) {
      const env = (options as { env?: Record<string, string> }).env;
      const configPath = env?.OPENCLAW_CONFIG_PATH;
      if (configPath) {
        capture.probeConfig = readFileSync(configPath, "utf8");
        capture.probeConfigs = [
          ...(capture.probeConfigs ?? []),
          capture.probeConfig,
        ];
        capture.probeConfigMode = statSync(configPath).mode & 0o777;
      }
    }

    if (typeof callback !== "function") {
      throw new Error("execFile callback missing");
    }
    const nextStdout = Array.isArray(stdout)
      ? (stdout[callIndex] ?? stdout.at(-1) ?? "")
      : stdout;
    callIndex += 1;
    (callback as (...callbackArgs: unknown[]) => void)(null, nextStdout, "");
    return undefined;
  });
  return capture;
}

function installExecError(message: string): void {
  childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback !== "function") {
      throw new Error("execFile callback missing");
    }
    (callback as (...callbackArgs: unknown[]) => void)(
      new Error(message),
      "",
      message,
    );
    return undefined;
  });
}

describe("ModelProviderService Amazon Bedrock validation", () => {
  beforeEach(() => {
    childProcessMocks.execFile.mockReset();
    fsPromiseMocks.access.mockReset();
    fsPromiseMocks.access.mockResolvedValue(undefined);
  });

  it("requires a successful bundled OpenClaw live probe before accepting Bedrock", async () => {
    const capture = installExecResult(probeJson("ok"));
    const gateway = createGateway();
    const service = createService(gateway);

    await expect(
      service.verifyProvider("amazon-bedrock", {
        baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com",
      }),
    ).resolves.toEqual({
      valid: true,
      models: ["amazon.nova-lite-v1:0"],
      modelDetails: [
        {
          id: "amazon.nova-lite-v1:0",
          contextWindow: 300_000,
        },
      ],
    });

    expect(gateway.listModels).toHaveBeenCalledWith("all");
    expect(capture.command).toBe("/bundled/openclaw");
    expect(capture.args).toEqual([
      "models",
      "status",
      "--probe",
      "--probe-provider",
      "amazon-bedrock",
      "--json",
      "--probe-max-tokens",
      "1",
      "--probe-timeout",
      "15000",
    ]);
    expect(capture.probeConfigMode).toBe(0o600);
    expect(capture.probeConfig).toContain(
      '"baseUrl":"https://bedrock-runtime.us-west-2.amazonaws.com"',
    );
    expect(capture.probeConfig).toContain('"auth":"aws-sdk"');
    expect(capture.probeConfig).toContain(
      '"apiKey":"nexu-bedrock-live-probe-target"',
    );
    expect(capture.probeConfig).not.toContain("bedrockDiscovery");
    expect(capture.probeConfig).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(capture.probeConfig).toContain(
      '"paths":["/runtime/openclaw/extensions"]',
    );
    expect(capture.probeConfig).toContain('"allow":["amazon-bedrock"]');
  });

  it("probes an explicit model without depending on gateway discovery", async () => {
    const capture = installExecResult(probeJson("ok"));
    const gateway = createGateway({
      listModels: vi.fn(async () => {
        throw new Error("gateway catalog unavailable");
      }),
    });
    const service = createService(gateway);

    await expect(
      service.verifyProvider("amazon-bedrock", {
        baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com",
        modelId: "amazon-bedrock/amazon.nova-lite-v1:0",
      }),
    ).resolves.toEqual({
      valid: true,
      models: ["amazon.nova-lite-v1:0"],
      modelDetails: [{ id: "amazon.nova-lite-v1:0" }],
    });

    expect(capture.probeConfig).toContain('"id":"amazon.nova-lite-v1:0"');
    expect(gateway.listModels).not.toHaveBeenCalled();
  });

  it("rejects a provider-only model reference", async () => {
    const service = createService(createGateway());

    await expect(
      service.verifyProvider("amazon-bedrock", {
        modelId: "amazon-bedrock/ ",
      }),
    ).resolves.toEqual({
      valid: false,
      error: "AWS Bedrock model ID required",
    });
    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
  });

  it("continues to the next available model and returns only the model that passed", async () => {
    const capture = installExecResult([
      probeJson("format", {
        model: "amazon-bedrock/amazon.nova-lite-v1:0",
      }),
      probeJson("ok", {
        model: "amazon-bedrock/anthropic.claude-sonnet-4",
      }),
    ]);
    const service = createService(createGateway());

    await expect(
      service.verifyProvider("amazon-bedrock", {
        baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com",
      }),
    ).resolves.toEqual({
      valid: true,
      models: ["anthropic.claude-sonnet-4"],
      modelDetails: [
        {
          id: "anthropic.claude-sonnet-4",
          contextWindow: 200_000,
        },
      ],
    });

    expect(childProcessMocks.execFile).toHaveBeenCalledTimes(2);
    expect(capture.probeConfigs).toHaveLength(2);
    expect(capture.probeConfigs?.[0]).toContain('"id":"amazon.nova-lite-v1:0"');
    expect(capture.probeConfigs?.[1]).toContain(
      '"id":"anthropic.claude-sonnet-4"',
    );
  });

  it("does not accept a successful result for a different Bedrock model", async () => {
    installExecResult([
      probeJson("ok", {
        model: "amazon-bedrock/unrelated-model",
      }),
      probeJson("ok", {
        model: "amazon-bedrock/anthropic.claude-sonnet-4",
      }),
    ]);
    const service = createService(createGateway());

    await expect(
      service.verifyProvider("amazon-bedrock", {
        baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com",
      }),
    ).resolves.toMatchObject({
      valid: true,
      models: ["anthropic.claude-sonnet-4"],
    });

    expect(childProcessMocks.execFile).toHaveBeenCalledTimes(2);
  });

  it("does not accept a successful result without the probed model", async () => {
    installExecResult(
      JSON.stringify({
        auth: {
          probes: {
            totalTargets: 1,
            results: [{ provider: "amazon-bedrock", status: "ok" }],
          },
        },
      }),
    );
    const service = createService(createGateway());

    await expect(
      service.verifyProvider("amazon-bedrock", {
        modelId: "amazon.nova-lite-v1:0",
      }),
    ).resolves.toMatchObject({
      valid: false,
      error: expect.stringContaining("did not return a Bedrock live-probe"),
    });
  });

  it.each([
    ["auth", "rejected the configured credentials"],
    ["billing", "billing is unavailable"],
    ["format", "incompatible response"],
    ["timeout", "connection timed out"],
    ["rate_limit", "rate limited"],
    ["no_model", "No Bedrock model"],
    ["unknown", "live probe failed"],
  ])(
    "maps %s probe failures to an actionable safe error",
    async (status, message) => {
      installExecResult(
        probeJson(status, { error: "credential AKIA_TEST_SECRET rejected" }),
      );
      const service = createService(createGateway());

      const result = await service.verifyProvider("amazon-bedrock", {});

      expect(result).toMatchObject({ valid: false });
      expect(result.error).toContain(message);
      expect(result.error).not.toContain("AKIA_TEST_SECRET");
    },
  );

  it("does not accept a successful probe for another provider", async () => {
    installExecResult(probeJson("ok", { provider: "anthropic" }));
    const service = createService(createGateway());

    await expect(
      service.verifyProvider("amazon-bedrock", {}),
    ).resolves.toMatchObject({
      valid: false,
      error: expect.stringContaining("did not return a Bedrock live-probe"),
    });
  });

  it("does not expose command stderr when the probe process fails", async () => {
    installExecError("Command failed with AWS_SECRET_ACCESS_KEY=top-secret");
    const service = createService(createGateway());

    const result = await service.verifyProvider("amazon-bedrock", {});

    expect(result).toMatchObject({
      valid: false,
      error: expect.stringContaining("could not run"),
    });
    expect(result.error).not.toContain("top-secret");
  });

  it("rejects Bedrock when no model is available for a live probe", async () => {
    const service = createService(
      createGateway({
        listModels: vi.fn(async () => ({
          models: [
            {
              id: "claude-sonnet-4",
              name: "Claude Sonnet 4",
              provider: "anthropic",
              available: true,
            },
          ],
        })),
      }),
    );

    await expect(
      service.verifyProvider("amazon-bedrock", {}),
    ).resolves.toMatchObject({
      valid: false,
      error: expect.stringContaining("No Bedrock model"),
    });
    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
  });

  it("uses an explicit model while the OpenClaw gateway is disconnected", async () => {
    installExecResult(probeJson("ok"));
    const gateway = createGateway({ isConnected: () => false });
    const service = createService(gateway);

    await expect(
      service.verifyProvider("amazon-bedrock", {
        modelId: "amazon.nova-lite-v1:0",
      }),
    ).resolves.toMatchObject({
      valid: true,
      models: ["amazon.nova-lite-v1:0"],
    });
    expect(gateway.listModels).not.toHaveBeenCalled();
    expect(childProcessMocks.execFile).toHaveBeenCalledOnce();
  });

  it("reports the missing provider plugin before starting a probe", async () => {
    fsPromiseMocks.access.mockRejectedValue(new Error("missing"));
    const service = createService();

    await expect(
      service.verifyProvider("amazon-bedrock", {
        modelId: "amazon.nova-lite-v1:0",
      }),
    ).resolves.toEqual({
      valid: false,
      error:
        "The Amazon Bedrock provider plugin is not installed in this OpenClaw runtime.",
    });
    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
  });
});
