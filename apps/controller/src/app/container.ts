import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { logger } from "../lib/logger.js";
import { startChannelHealthWatchdog } from "../runtime/channel-health-watchdog.js";
import { ControlPlaneHealthService } from "../runtime/control-plane-health.js";
import { CreditGuardStateWriter } from "../runtime/credit-guard-state-writer.js";
import { GatewayClient } from "../runtime/gateway-client.js";
import { startHealthLoop } from "../runtime/loops.js";
import { startAnalyticsLoop } from "../runtime/loops.js";
import { OpenClawAuthProfilesStore } from "../runtime/openclaw-auth-profiles-store.js";
import { OpenClawAuthProfilesWriter } from "../runtime/openclaw-auth-profiles-writer.js";
import { OpenClawConfigWriter } from "../runtime/openclaw-config-writer.js";
import { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import { OpenClawWatchTrigger } from "../runtime/openclaw-watch-trigger.js";
import { OpenClawWsClient } from "../runtime/openclaw-ws-client.js";
import { SessionsRuntime } from "../runtime/sessions-runtime.js";
import { OpenClawRuntimeModelWriter } from "../runtime/slimclaw-runtime-model-writer.js";
import { OpenClawRuntimePluginWriter } from "../runtime/slimclaw-runtime-plugin-writer.js";
import {
  type ControllerRuntimeState,
  createRuntimeState,
} from "../runtime/state.js";
import { WorkspaceTemplateWriter } from "../runtime/workspace-template-writer.js";
import { AgentService } from "../services/agent-service.js";
import { AnalyticsService } from "../services/analytics-service.js";
import { ArtifactService } from "../services/artifact-service.js";
import { AttachmentStore } from "../services/attachment-store.js";
import { ChannelFallbackService } from "../services/channel-fallback-service.js";
import { ChannelService } from "../services/channel-service.js";
import { DesktopLocalService } from "../services/desktop-local-service.js";
import { DeviceControlService } from "../services/device-control-service.js";
import { DeviceMirrorProxy } from "../services/device-mirror-proxy.js";
import { DevicePollingService } from "../services/device-polling-service.js";
import { ExperthubCatalogManager } from "../services/experthub/catalog-manager.js";
import {
  DEFAULT_EXPERT_SLUGS,
  type InstallExpertResult,
  createCustomExpert,
  installDefaultExperts,
  installExpert,
  updateExpertSkills,
} from "../services/experthub/install-flow.js";
import { GithubStarVerificationService } from "../services/github-star-verification-service.js";
import { IntegrationService } from "../services/integration-service.js";
import { LocalUserService } from "../services/local-user-service.js";
import { ModelProviderService } from "../services/model-provider-service.js";
import { OpenClawAuthService } from "../services/openclaw-auth-service.js";
import { OpenClawCronGateway } from "../services/openclaw-cron-gateway.js";
import { OpenClawGatewayService } from "../services/openclaw-gateway-service.js";
import { OpenClawSyncService } from "../services/openclaw-sync-service.js";
import { QuotaFallbackService } from "../services/quota-fallback-service.js";
import { RuntimeConfigService } from "../services/runtime-config-service.js";
import { RuntimeModelStateService } from "../services/runtime-model-state-service.js";
import { ScheduleService } from "../services/schedule-service.js";
import { ScheduleWorkspaceWriter } from "../services/schedule-workspace-writer.js";
import { SessionService } from "../services/session-service.js";
import { SkillhubService } from "../services/skillhub-service.js";
import { TemplateService } from "../services/template-service.js";
import { ArtifactsStore } from "../store/artifacts-store.js";
import { CompiledOpenClawStore } from "../store/compiled-openclaw-store.js";
import { DeviceNameStore } from "../store/device-name-store.js";
import { DeviceTaskHistoryStore } from "../store/device-task-history-store.js";
import { NexuConfigStore } from "../store/nexu-config-store.js";
import { type ControllerEnv, env } from "./env.js";

export interface ControllerContainer {
  env: ControllerEnv;
  configStore: NexuConfigStore;
  gatewayClient: GatewayClient;
  controlPlaneHealth: ControlPlaneHealthService;
  openclawProcess: OpenClawProcessManager;
  agentService: AgentService;
  channelService: ChannelService;
  channelFallbackService: ChannelFallbackService;
  sessionService: SessionService;
  runtimeConfigService: RuntimeConfigService;
  runtimeModelStateService: RuntimeModelStateService;
  modelProviderService: ModelProviderService;
  integrationService: IntegrationService;
  localUserService: LocalUserService;
  desktopLocalService: DesktopLocalService;
  analyticsService: AnalyticsService;
  artifactService: ArtifactService;
  attachmentStore: AttachmentStore;
  templateService: TemplateService;
  skillhubService: SkillhubService;
  experthubCatalogManager: ExperthubCatalogManager;
  installExpertFn: (args: { slug: string }) => Promise<InstallExpertResult>;
  installDefaultExpertsFn: () => Promise<{
    installed: string[];
    skipped: string[];
  }>;
  createCustomExpertFn: (args: {
    name: string;
    avatarDataUrl?: string;
    modelId: string;
    description?: string;
    skills: string[];
    existingSlug?: string;
    workspaceFiles: Record<string, string>;
  }) => Promise<{ ok: true; botId: string; slug: string }>;
  updateExpertSkillsFn: (args: {
    slug: string;
    skills: string[];
  }) => Promise<{ ok: true; configuredSkills: string[] }>;
  openclawSyncService: OpenClawSyncService;
  openclawAuthService: OpenClawAuthService;
  quotaFallbackService: QuotaFallbackService;
  githubStarVerificationService: GithubStarVerificationService;
  deviceControlService: DeviceControlService;
  deviceMirrorProxy: DeviceMirrorProxy;
  devicePollingService: DevicePollingService;
  deviceTaskHistoryStore: DeviceTaskHistoryStore;
  deviceNameStore: DeviceNameStore;
  wsClient: OpenClawWsClient;
  gatewayService: OpenClawGatewayService;
  scheduleService: ScheduleService;
  runtimeState: ControllerRuntimeState;
  startBackgroundLoops: () => () => void;
}

const NEXU_OFFICIAL_MODEL_REFRESH_INTERVAL_MS = 60 * 1000;

export async function createContainer(): Promise<ControllerContainer> {
  const configStore = new NexuConfigStore(env);
  await configStore.reconcileConfiguredDesktopCloudState();
  await configStore.syncManagedRuntimeGateway({
    port: env.openclawGatewayPort,
    authMode: env.openclawGatewayToken ? "token" : "none",
  });
  const artifactsStore = new ArtifactsStore(env);
  const deviceTaskHistoryStore = new DeviceTaskHistoryStore(
    env.deviceTaskHistoryPath,
    env.screenshotsDir,
  );
  const compiledStore = new CompiledOpenClawStore(env);
  const configWriter = new OpenClawConfigWriter(env);
  const authProfilesStore = new OpenClawAuthProfilesStore(env);
  const authProfilesWriter = new OpenClawAuthProfilesWriter(authProfilesStore);
  const runtimePluginWriter = new OpenClawRuntimePluginWriter(env);
  const runtimeModelWriter = new OpenClawRuntimeModelWriter(env);
  const creditGuardStateWriter = new CreditGuardStateWriter(env);
  const templateWriter = new WorkspaceTemplateWriter(env);
  const scheduleWorkspaceWriter = new ScheduleWorkspaceWriter(env);
  const gatewayClient = new GatewayClient(env);
  const sessionsRuntime = new SessionsRuntime(env);
  const runtimeState = createRuntimeState();
  // Construct openclawProcess before watchTrigger so the watch trigger can
  // delegate gateway restarts to OpenClawProcessManager.restart() instead of
  // re-implementing the dev-vs-launchd branching inline.
  const openclawProcess = new OpenClawProcessManager(env);
  const watchTrigger = new OpenClawWatchTrigger(env, openclawProcess);
  const wsClient = new OpenClawWsClient(env);
  const gatewayService = new OpenClawGatewayService(wsClient);
  const controlPlaneHealth = new ControlPlaneHealthService(
    gatewayService,
    wsClient,
    runtimeState,
    openclawProcess,
  );
  const channelFallbackService = new ChannelFallbackService(
    openclawProcess,
    gatewayService,
    {
      getLocale: () => configStore.getDesktopLocale(),
    },
  );
  let syncService: OpenClawSyncService | null = null;
  const skillhubService = await SkillhubService.create(env, {
    onSyncNeeded: () => {
      void syncService?.syncAll().catch(() => {});
    },
    getBotIds: async () => {
      const config = await configStore.getConfig();
      return config.bots.map((b) => b.id);
    },
  });
  const openclawSyncService = new OpenClawSyncService(
    env,
    configStore,
    compiledStore,
    configWriter,
    authProfilesWriter,
    authProfilesStore,
    runtimePluginWriter,
    runtimeModelWriter,
    creditGuardStateWriter,
    templateWriter,
    scheduleWorkspaceWriter,
    watchTrigger,
    gatewayService,
    skillhubService.skillDb,
    skillhubService.workspaceSkillScanner,
  );
  syncService = openclawSyncService;
  const cronGateway = new OpenClawCronGateway(wsClient, env);
  const scheduleService = new ScheduleService(
    configStore,
    cronGateway,
    openclawSyncService,
    sessionsRuntime,
  );
  const openclawAuthService = new OpenClawAuthService(env, authProfilesStore);
  const analyticsService = new AnalyticsService(
    env,
    configStore,
    sessionsRuntime,
  );
  const modelProviderService = new ModelProviderService(
    configStore,
    env,
    openclawSyncService,
    openclawProcess,
  );
  modelProviderService.setAuthService(openclawAuthService);
  const runtimeModelStateService = new RuntimeModelStateService(env);
  const quotaFallbackService = new QuotaFallbackService(
    configStore,
    openclawSyncService,
  );
  const githubStarVerificationService = new GithubStarVerificationService();
  const deviceControlService = new DeviceControlService(
    configStore,
    deviceTaskHistoryStore,
  );
  const deviceMirrorProxy = new DeviceMirrorProxy(configStore);
  const devicePollingService = new DevicePollingService(deviceControlService);
  const attachmentStore = new AttachmentStore({
    openclawStateDir: env.openclawStateDir,
  });
  // Sweep expired webchat attachments on boot.  Fire-and-forget so controller
  // startup isn't blocked by disk I/O, and errors are swallowed-with-log by
  // the store itself.
  void attachmentStore.cleanupExpired().catch((err) => {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "attachment-store: startup cleanup failed",
    );
  });

  // Experts (ExpertHub): catalog manager + install flow.
  // The catalog manager reads bundled manifests from the static dir and
  // managed manifests from the cache dir; if staticExpertsDir is undefined
  // (e.g. when SKILLHUB_STATIC_SKILLS_DIR is unset and no workspaceRoot was
  // detected), we pass an empty string which the manager treats as "no
  // bundled entries" via its existsSync guard.
  const experthubCatalogManager = new ExperthubCatalogManager({
    cacheDir: env.experthubCacheDir,
    ledgerPath: env.expertDbPath,
    staticDir: env.staticExpertsDir ?? "",
    versionUrl: env.experthubVersionUrl,
    downloadUrl: env.experthubDownloadUrl,
    log: (level, message) => {
      logger[level === "error" ? "error" : level === "warn" ? "warn" : "info"](
        { subsystem: "experthub" },
        message,
      );
    },
  });

  // AgentService is used by both the return block and the experthub install
  // flow. Construct it once so both paths share the same cache/syncAll semantics.
  const agentService = new AgentService(configStore, openclawSyncService);

  const installExpertFn = (args: { slug: string }) =>
    installExpert({
      slug: args.slug,
      deps: {
        catalog: {
          resolveExpert: (slug) => experthubCatalogManager.resolveExpert(slug),
          readLedger: () => experthubCatalogManager.readLedger(),
          writeLedger: (ledger) => experthubCatalogManager.writeLedger(ledger),
        },
        botService: {
          createBot: async (input) => {
            const bot = await agentService.createBot({
              name: input.name,
              slug: input.slug,
              systemPrompt: input.systemPrompt,
              modelId: input.modelId,
              expertSlug: input.expertSlug,
            });
            return { id: bot.id, slug: bot.slug };
          },
        },
        skillhub: {
          install: async (input) => {
            return skillhubService.installWorkspaceSkill(
              input.slug,
              input.agentId,
            );
          },
        },
        sync: openclawSyncService,
        fs: {
          writeFile: (p, data) => fsp.writeFile(p, data),
          mkdir: async (p, opts) => {
            await fsp.mkdir(p, opts);
          },
          rm: (p) => fsp.rm(p, { force: true }),
        },
        agentsDir: path.join(env.openclawStateDir, "agents"),
        genBotSlug: (expertSlug) =>
          `${expertSlug}-${randomUUID().replace(/-/g, "").slice(0, 8)}`,
        defaultModelId: env.defaultModelId,
      },
    });

  const installDefaultExpertsDeps = {
    catalog: {
      resolveExpert: (slug: string) =>
        experthubCatalogManager.resolveExpert(slug),
      readLedger: () => experthubCatalogManager.readLedger(),
      writeLedger: (
        ledger: Parameters<typeof experthubCatalogManager.writeLedger>[0],
      ) => experthubCatalogManager.writeLedger(ledger),
    },
    botService: {
      createBot: async (input: {
        name: string;
        slug: string;
        systemPrompt: string;
        modelId: string;
        expertSlug: string;
      }) => {
        const bot = await agentService.createBot({
          name: input.name,
          slug: input.slug,
          systemPrompt: input.systemPrompt,
          modelId: input.modelId,
          expertSlug: input.expertSlug,
        });
        return { id: bot.id, slug: bot.slug };
      },
    },
    skillhub: {
      install: async (input: {
        slug: string;
        agentId: string;
        source: "workspace";
      }) => {
        return skillhubService.installWorkspaceSkill(input.slug, input.agentId);
      },
    },
    sync: openclawSyncService,
    fs: {
      writeFile: (p: string, data: string) => fsp.writeFile(p, data),
      mkdir: async (p: string, opts?: { recursive: boolean }) => {
        await fsp.mkdir(p, opts);
      },
      rm: (p: string) => fsp.rm(p, { force: true }),
    },
    agentsDir: path.join(env.openclawStateDir, "agents"),
    genBotSlug: (expertSlug: string) =>
      `${expertSlug}-${randomUUID().replace(/-/g, "").slice(0, 8)}`,
    defaultModelId: env.defaultModelId,
  };

  const installDefaultExpertsFn = () =>
    installDefaultExperts({
      slugs: DEFAULT_EXPERT_SLUGS,
      deps: installDefaultExpertsDeps,
    });

  const createCustomExpertFn = (args: {
    name: string;
    avatarDataUrl?: string;
    modelId: string;
    description?: string;
    skills: string[];
    existingSlug?: string;
    workspaceFiles: Record<string, string>;
  }) =>
    createCustomExpert({
      ...args,
      deps: {
        catalog: {
          readLedger: () => experthubCatalogManager.readLedger(),
          writeLedger: (ledger) => experthubCatalogManager.writeLedger(ledger),
        },
        botService: {
          createBot: async (input) => {
            const bot = await agentService.createBot({
              name: input.name,
              slug: input.slug,
              systemPrompt: input.systemPrompt,
              modelId: input.modelId,
              expertSlug: input.expertSlug,
            });
            return { id: bot.id, slug: bot.slug };
          },
          getBotByExpertSlug: async (slug) => {
            const bots = await agentService.listBots();
            const match = (
              bots as Array<{ id: string; expertSlug: string }>
            ).find((b) => b.expertSlug === slug);
            return match ? { id: match.id } : null;
          },
          deleteBot: async (id) => {
            await agentService.deleteBot(id);
          },
        },
        skillhub: {
          install: async (input) => {
            return skillhubService.installWorkspaceSkill(
              input.slug,
              input.agentId,
            );
          },
        },
        sync: openclawSyncService,
        fs: {
          writeFile: (p, data) => fsp.writeFile(p, data),
          mkdir: async (p, opts) => {
            await fsp.mkdir(p, opts);
          },
          rm: async (p, opts) => {
            await fsp.rm(p, opts ?? { recursive: true });
          },
        },
        agentsDir: path.join(env.openclawStateDir, "agents"),
      },
    });

  const updateExpertSkillsFn = (args: { slug: string; skills: string[] }) =>
    updateExpertSkills({
      slug: args.slug,
      skills: args.skills,
      deps: {
        catalog: {
          resolveExpert: (slug) => experthubCatalogManager.resolveExpert(slug),
          readLedger: () => experthubCatalogManager.readLedger(),
          writeLedger: (ledger) => experthubCatalogManager.writeLedger(ledger),
        },
        skillhub: {
          install: async (input) => {
            return skillhubService.installWorkspaceSkill(
              input.slug,
              input.agentId,
            );
          },
          uninstall: async (input) => {
            const result = await skillhubService.uninstallSkill({
              slug: input.slug,
              agentId: input.agentId,
              source: "workspace",
            });
            return result;
          },
        },
        sync: openclawSyncService,
      },
    });

  // Wire cloud state change callback to sync refreshed cloud inventory without
  // auto-switching the default model during startup or first-channel connect.
  configStore.onCloudStateChanged = async (_change) => {
    // Auto-select a valid default model: on login, pick a managed model;
    // on logout, fall back to any remaining BYOK/OAuth model (or leave
    // cleared, which surfaces the explicit no-model guidance).
    await modelProviderService.ensureValidDefaultModel();
    await openclawSyncService.syncAll();
    // Restart the gateway on every login/logout.  Provider-level changes
    // are not hot-reload-safe: OpenClaw builds its provider/model registry
    // once at boot, so without a restart the old providers map stays
    // resident in memory and the runtime keeps resolving to stale entries
    // (e.g. link/*) after disconnect, or reports "Unknown model" after a
    // fresh login because the registry never saw the new providers map.
    // `restart()` handles both dev-managed and launchd-managed modes.
    await openclawProcess.restart("cloud_state_changed");
  };

  // Hoisted so both the container surface and the channel-health watchdog
  // (started in startBackgroundLoops) share one instance.
  const channelService = new ChannelService(
    env,
    configStore,
    openclawSyncService,
    gatewayService,
    openclawProcess,
    controlPlaneHealth,
    wsClient,
    quotaFallbackService,
  );

  return {
    env,
    gatewayClient,
    controlPlaneHealth,
    openclawProcess,
    agentService,
    channelService,
    channelFallbackService,
    sessionService: new SessionService(sessionsRuntime),
    runtimeConfigService: new RuntimeConfigService(
      configStore,
      openclawSyncService,
    ),
    runtimeModelStateService,
    modelProviderService,
    integrationService: new IntegrationService(configStore),
    localUserService: new LocalUserService(configStore),
    desktopLocalService: new DesktopLocalService(
      configStore,
      modelProviderService,
      openclawProcess,
    ),
    analyticsService,
    artifactService: new ArtifactService(artifactsStore),
    attachmentStore,
    templateService: new TemplateService(configStore, openclawSyncService),
    skillhubService,
    experthubCatalogManager,
    installExpertFn,
    installDefaultExpertsFn,
    createCustomExpertFn,
    updateExpertSkillsFn,
    openclawSyncService,
    openclawAuthService,
    quotaFallbackService,
    githubStarVerificationService,
    deviceControlService,
    deviceMirrorProxy,
    devicePollingService,
    deviceTaskHistoryStore,
    deviceNameStore: new DeviceNameStore(env.deviceNamesPath),
    wsClient,
    gatewayService,
    configStore,
    scheduleService,
    runtimeState,
    startBackgroundLoops: () => {
      let isRefreshingNexuOfficialModels = false;
      const stopHealthLoop = startHealthLoop({
        env,
        state: runtimeState,
        controlPlaneHealth,
        processManager: openclawProcess,
        wsClient,
      });
      const stopAnalyticsLoop = startAnalyticsLoop({
        env,
        analyticsService,
      });
      const stopChannelHealthWatchdog = startChannelHealthWatchdog({
        env,
        channelService,
        gatewayService,
        openclawProcess,
      });
      const nexuOfficialModelRefreshInterval = setInterval(() => {
        if (isRefreshingNexuOfficialModels) {
          return;
        }

        isRefreshingNexuOfficialModels = true;
        void modelProviderService
          .refreshNexuOfficialModels()
          .catch((error) => {
            logger.warn(
              {
                error: error instanceof Error ? error.message : String(error),
              },
              "nexu_official_model_refresh_failed",
            );
          })
          .finally(() => {
            isRefreshingNexuOfficialModels = false;
          });
      }, NEXU_OFFICIAL_MODEL_REFRESH_INTERVAL_MS);
      nexuOfficialModelRefreshInterval.unref?.();
      skillhubService.start();
      devicePollingService.start();

      return () => {
        stopHealthLoop();
        stopAnalyticsLoop();
        stopChannelHealthWatchdog();
        clearInterval(nexuOfficialModelRefreshInterval);
        skillhubService.dispose();
        devicePollingService.dispose();
        deviceMirrorProxy.close();
        openclawAuthService.dispose();
        channelFallbackService.stop();
        wsClient.stop();
      };
    },
  };
}
