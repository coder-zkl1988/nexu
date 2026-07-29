import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { isSkillUpdateAvailable } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import {
  CatalogManager,
  type SkillInstallRequest,
} from "./skillhub/catalog-manager.js";
import {
  copyStaticSkills,
  replaceLibtvVideoFromBundle,
} from "./skillhub/curated-skills.js";
import { InstallQueue } from "./skillhub/install-queue.js";
import { ensureNpmAvailable, runNpmInstall } from "./skillhub/npm-runner.js";
import { SkillDb } from "./skillhub/skill-db.js";
import { SkillDirWatcher } from "./skillhub/skill-dir-watcher.js";
import type { QueueItem, SkillSource } from "./skillhub/types.js";
import { WorkspaceSkillScanner } from "./skillhub/workspace-skill-scanner.js";

export interface SkillhubServiceOptions {
  onSyncNeeded?: () => void;
  getBotIds?: () => Promise<readonly string[]>;
}

export type SkillUninstallRequest = {
  slug: string;
  source?: SkillSource;
  agentId?: string | null;
};

export type SkillhubInstallRequest = SkillInstallRequest & {
  update?: boolean;
};

const SKILL_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;
const OWNER_HANDLE_REGEX = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SKILL_VERSION_REGEX = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,99}$/;

function readInstalledOriginMetadata(
  skillsDir: string,
  expectedSlug: string,
): { ownerHandle?: string; version?: string } | null {
  if (!SKILL_SLUG_REGEX.test(expectedSlug)) return null;
  const skillDir = path.join(skillsDir, expectedSlug);
  if (!existsSync(path.join(skillDir, "SKILL.md"))) return null;

  try {
    const parsed = JSON.parse(
      readFileSync(path.join(skillDir, ".clawhub", "origin.json"), "utf8"),
    ) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const origin = parsed as Record<string, unknown>;
    if (origin.slug !== expectedSlug) return null;

    let ownerHandle: string | undefined;
    if (origin.ownerHandle !== undefined) {
      if (typeof origin.ownerHandle !== "string") return null;
      const normalizedOwner = origin.ownerHandle
        .replace(/^@+/, "")
        .toLowerCase();
      if (!OWNER_HANDLE_REGEX.test(normalizedOwner)) return null;
      ownerHandle = normalizedOwner;
    }

    let version: string | undefined;
    if (origin.installedVersion !== undefined) {
      if (
        typeof origin.installedVersion !== "string" ||
        !SKILL_VERSION_REGEX.test(origin.installedVersion)
      ) {
        return null;
      }
      version = origin.installedVersion;
    }

    if (!ownerHandle && !version) return null;
    return {
      ...(ownerHandle ? { ownerHandle } : {}),
      ...(version ? { version } : {}),
    };
  } catch {
    return null;
  }
}

export class SkillInstallConflictError extends Error {
  constructor(slug: string, state: "installing" | "installed" = "installing") {
    super(
      state === "installing"
        ? `A different publisher is already installing ${slug}`
        : `A different or unknown skill identity already occupies ${slug}`,
    );
    this.name = "SkillInstallConflictError";
  }
}

export class SkillUpdateNotAllowedError extends Error {
  constructor(slug: string) {
    super(`Skill update is not allowed for ${slug}`);
    this.name = "SkillUpdateNotAllowedError";
  }
}

export class SkillhubService {
  private readonly catalogManager: CatalogManager;
  private readonly installQueue: InstallQueue;
  private readonly dirWatcher: SkillDirWatcher;
  private readonly db: SkillDb;
  private readonly env: ControllerEnv;
  private readonly scanner: WorkspaceSkillScanner;
  private readonly getBotIds: (() => Promise<readonly string[]>) | null;
  private readonly onSyncNeeded: (() => void) | null;

  private constructor(
    env: ControllerEnv,
    catalogManager: CatalogManager,
    installQueue: InstallQueue,
    dirWatcher: SkillDirWatcher,
    db: SkillDb,
    scanner: WorkspaceSkillScanner,
    getBotIds: (() => Promise<readonly string[]>) | null,
    onSyncNeeded: (() => void) | null,
  ) {
    this.env = env;
    this.catalogManager = catalogManager;
    this.installQueue = installQueue;
    this.dirWatcher = dirWatcher;
    this.db = db;
    this.scanner = scanner;
    this.getBotIds = getBotIds;
    this.onSyncNeeded = onSyncNeeded;
  }

  static async create(
    env: ControllerEnv,
    options?: SkillhubServiceOptions,
  ): Promise<SkillhubService> {
    const skillDb = await SkillDb.create(env.skillDbPath);
    const log = (level: "info" | "error" | "warn", message: string) => {
      console[level === "error" ? "error" : "log"](`[skillhub] ${message}`);
    };

    const catalogManager = new CatalogManager(env.skillhubCacheDir, {
      skillsDir: env.openclawSkillsDir,
      userSkillsDir: env.userSkillsDir,
      staticSkillsDir: env.staticSkillsDir,
      skillDb,
      log,
    });

    const installQueue = new InstallQueue({
      executor: async (slug) => catalogManager.executeInstall(slug),
      onComplete: (slug, source) => {
        const metadata = catalogManager.consumeInstalledMetadata(slug);
        try {
          skillDb.recordInstall(
            slug,
            source,
            metadata?.version,
            undefined,
            metadata?.ownerHandle,
          );
        } catch (error) {
          catalogManager.rollbackInstall(slug);
          throw error;
        }
        catalogManager.commitInstall(slug);
      },
      onIdle: () => {
        options?.onSyncNeeded?.();
      },
      onCancelled: async (slug) => {
        catalogManager.rollbackInstall(slug);
        catalogManager.clearPreparedInstall(slug);
        options?.onSyncNeeded?.();
      },
      log,
    });

    const dirWatcher = new SkillDirWatcher({
      skillsDir: env.openclawSkillsDir,
      userSkillsDir: env.userSkillsDir,
      isSlugInFlight: (slug) =>
        installQueue.isInFlight(slug) ||
        catalogManager.isInstallTransactionActive(slug),
      skillDb,
      log,
      openclawStateDir: env.openclawStateDir,
      onChange: () => {
        options?.onSyncNeeded?.();
      },
    });

    const workspaceScanner = new WorkspaceSkillScanner(env.openclawStateDir);

    return new SkillhubService(
      env,
      catalogManager,
      installQueue,
      dirWatcher,
      skillDb,
      workspaceScanner,
      options?.getBotIds ?? null,
      options?.onSyncNeeded ?? null,
    );
  }

  /**
   * Synchronise disk state with the ledger and copy bundled skills into the
   * skills directory.  Must run BEFORE the first OpenClaw config push so that
   * the compiled agent allowlist already contains every installed skill.
   *
   * Safe to call multiple times — every operation is idempotent.
   */
  bootstrap(): void {
    if (process.env.CI) return;
    this.dirWatcher.syncNow();
    this.initialize();
  }

  start(): void {
    this.catalogManager.start();
    if (process.env.CI) return;

    // Resolve bot IDs asynchronously and feed them to the dir watcher
    // so it can reconcile workspace skill directories on startup.
    if (this.getBotIds) {
      void this.getBotIds().then((ids) => {
        this.dirWatcher.setBotIds(ids);
        this.dirWatcher.syncNow();
      });
    }

    // bootstrap() already ran syncNow + initialize before the first config
    // push, but re-running here is harmless (idempotent) and catches any
    // skills that appeared between bootstrap() and start().
    this.dirWatcher.syncNow();
    this.backfillManagedInstallMetadata();
    this.initialize();

    // Always start watching for external skill changes (agent installs)
    this.dirWatcher.start();
    void this.enqueueMissingCuratedSkills().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[skillhub] curated startup install failed: ${message}`);
    });
  }

  /**
   * Copy static bundled skills into the shared skill directory.
   * Runs on every non-CI startup. Both operations are idempotent:
   * - copyStaticSkills skips when SKILL.md exists on disk OR slug is known in ledger
   */
  private initialize(): void {
    // Step 1: Copy static bundled skills to skills dir + record in DB
    if (this.env.staticSkillsDir && existsSync(this.env.staticSkillsDir)) {
      const { copied } = copyStaticSkills({
        staticDir: this.env.staticSkillsDir,
        targetDir: this.env.openclawSkillsDir,
        skillDb: this.db,
      });
      if (copied.length > 0) {
        this.db.recordBulkInstall(copied, "managed");
      }

      // Step 1b: Force-refresh libtv-video on every boot so bundled
      // libtv-video updates (detached background waiter + direct
      // Feishu delivery) reach existing users on their next app boot.
      // copyStaticSkills' first-install-only semantics would otherwise
      // never refresh it. See replaceLibtvVideoFromBundle for rationale.
      replaceLibtvVideoFromBundle({
        staticDir: this.env.staticSkillsDir,
        targetDir: this.env.openclawSkillsDir,
        skillDb: this.db,
      });
    }
  }

  private async enqueueMissingCuratedSkills(): Promise<void> {
    const requests = await this.catalogManager.getCuratedInstallRequests();
    for (const request of requests) {
      try {
        this.enqueueInstall(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[skillhub] curated startup install skipped @${request.ownerHandle ?? "unknown"}/${request.slug}: ${message}`,
        );
      }
    }
  }

  private backfillManagedInstallMetadata(): void {
    for (const record of this.db.getAllInstalled()) {
      if (
        record.source !== "managed" ||
        (record.ownerHandle !== null && record.version !== null)
      ) {
        continue;
      }
      const metadata = readInstalledOriginMetadata(
        this.env.openclawSkillsDir,
        record.slug,
      );
      if (metadata) {
        this.db.backfillInstalledManagedMetadata(record.slug, metadata);
      }
    }
  }

  get skillDb(): SkillDb {
    return this.db;
  }

  get workspaceSkillScanner(): WorkspaceSkillScanner {
    return this.scanner;
  }

  get catalog(): CatalogManager {
    return this.catalogManager;
  }

  get queue(): InstallQueue {
    return this.installQueue;
  }

  enqueueInstall(request: string | SkillhubInstallRequest): QueueItem {
    const payload: SkillhubInstallRequest =
      typeof request === "string" ? { slug: request } : request;
    const ownerHandle = payload.ownerHandle?.replace(/^@+/, "").toLowerCase();
    const canonicalSlug = ownerHandle
      ? payload.slug
      : this.catalogManager.canonicalizeSlug(payload.slug);
    const existingQueueItem = this.installQueue
      .getQueue()
      .find((item) => item.slug === canonicalSlug && item.status !== "failed");
    if (existingQueueItem && existingQueueItem.status !== "done") {
      const sameOwner =
        (existingQueueItem.ownerHandle ?? null) === (ownerHandle ?? null);
      if (!sameOwner) {
        throw new SkillInstallConflictError(canonicalSlug);
      }
      return existingQueueItem;
    }

    const occupiedRecords = this.db
      .getInstalledRecordsBySlug(canonicalSlug)
      .filter((record) => record.source !== "workspace");
    const matchingManagedRecord = ownerHandle
      ? occupiedRecords.find(
          (record) =>
            record.source === "managed" &&
            record.ownerHandle?.replace(/^@+/, "").toLowerCase() ===
              ownerHandle,
        )
      : undefined;
    const occupiedOnDisk = existsSync(
      path.join(this.env.openclawSkillsDir, canonicalSlug, "SKILL.md"),
    );
    const hasConflictingRecord = occupiedRecords.some(
      (record) => record !== matchingManagedRecord,
    );

    if (payload.update) {
      if (
        !ownerHandle ||
        !payload.version ||
        !matchingManagedRecord?.version ||
        hasConflictingRecord ||
        !isSkillUpdateAvailable(payload.version, matchingManagedRecord.version)
      ) {
        throw new SkillUpdateNotAllowedError(canonicalSlug);
      }
    } else {
      if (hasConflictingRecord || (occupiedOnDisk && !matchingManagedRecord)) {
        throw new SkillInstallConflictError(canonicalSlug, "installed");
      }
      if (matchingManagedRecord && occupiedOnDisk) {
        if (
          existingQueueItem?.status === "done" &&
          existingQueueItem.ownerHandle === ownerHandle
        ) {
          return existingQueueItem;
        }
        return {
          slug: canonicalSlug,
          ownerHandle: ownerHandle ?? null,
          source: "managed",
          status: "done",
          position: 0,
          error: null,
          errorCode: null,
          retries: 0,
          enqueuedAt:
            matchingManagedRecord.installedAt ?? new Date().toISOString(),
        };
      }
      if (
        existingQueueItem?.status === "done" &&
        existingQueueItem.ownerHandle !== (ownerHandle ?? null)
      ) {
        throw new SkillInstallConflictError(canonicalSlug, "installed");
      }
    }
    const canonical = this.catalogManager.prepareInstall({
      slug: payload.slug,
      ...(ownerHandle ? { ownerHandle } : {}),
      ...(payload.version ? { version: payload.version } : {}),
    });
    if (payload.update) {
      return this.installQueue.enqueue(canonical, "managed", ownerHandle, {
        replaceCompleted: true,
        operation: "update",
      });
    }
    if (
      existingQueueItem?.status === "done" &&
      existingQueueItem.ownerHandle === (ownerHandle ?? null)
    ) {
      return this.installQueue.enqueue(canonical, "managed", ownerHandle, {
        replaceCompleted: true,
      });
    }
    return this.installQueue.enqueue(canonical, "managed", ownerHandle);
  }

  cancelInstall(slug: string): boolean {
    const canonical = this.catalogManager.canonicalizeSlug(slug);
    const cancelled = this.installQueue.cancel(canonical);
    if (cancelled) this.catalogManager.clearPreparedInstall(canonical);
    return cancelled;
  }

  /**
   * Install a skill into a bot's workspace directory.
   *
   * Copies the skill from the shared skillsDir to
   * `{stateDir}/agents/{agentId}/skills/{slug}/`, then records the
   * workspace-scoped install in the ledger.
   *
   * If the skill is not yet available in the shared directory it is
   * downloaded first via the catalog manager.
   */
  async installWorkspaceSkill(
    request: string | SkillInstallRequest,
    agentId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const payload: SkillInstallRequest =
      typeof request === "string" ? { slug: request } : request;
    const requestedOwner = payload.ownerHandle
      ?.replace(/^@+/, "")
      .toLowerCase();
    let canonical = payload.slug;
    let downloadedSharedSkill = false;
    let catalogSkill: Awaited<ReturnType<CatalogManager["getCatalogSkill"]>> =
      undefined;

    // Ensure the skill exists in the shared skills directory first.
    let sharedDir = path.join(this.env.openclawSkillsDir, canonical);
    let sharedExists = existsSync(path.join(sharedDir, "SKILL.md"));
    let sharedRecord = this.db
      .getInstalledRecordsBySlug(canonical)
      .find((record) => record.source !== "workspace");
    let originMetadata = readInstalledOriginMetadata(
      this.env.openclawSkillsDir,
      canonical,
    );
    let sharedOwner = (sharedRecord?.ownerHandle ?? originMetadata?.ownerHandle)
      ?.replace(/^@+/, "")
      .toLowerCase();
    let sharedVersion = sharedRecord?.version ?? originMetadata?.version;
    if (sharedExists && requestedOwner && sharedOwner !== requestedOwner) {
      return {
        ok: false,
        error: `A different or unknown skill identity already occupies ${canonical}`,
      };
    }

    let shouldInstallShared =
      !sharedExists ||
      Boolean(payload.version && sharedVersion !== payload.version);
    if (shouldInstallShared) {
      try {
        catalogSkill = await this.catalogManager.getCatalogSkill(
          payload.slug,
          requestedOwner,
        );
        if (!catalogSkill) {
          if (requestedOwner) {
            throw new Error(
              `catalog did not return @${requestedOwner}/${payload.slug}`,
            );
          }
          canonical = this.catalogManager.canonicalizeSlug(payload.slug);
          sharedDir = path.join(this.env.openclawSkillsDir, canonical);
          sharedExists = existsSync(path.join(sharedDir, "SKILL.md"));
          sharedRecord = this.db
            .getInstalledRecordsBySlug(canonical)
            .find((record) => record.source !== "workspace");
          originMetadata = readInstalledOriginMetadata(
            this.env.openclawSkillsDir,
            canonical,
          );
          sharedOwner = (
            sharedRecord?.ownerHandle ?? originMetadata?.ownerHandle
          )
            ?.replace(/^@+/, "")
            .toLowerCase();
          sharedVersion = sharedRecord?.version ?? originMetadata?.version;
          if (
            sharedExists &&
            (!payload.version || sharedVersion === payload.version)
          ) {
            shouldInstallShared = false;
          } else if (canonical !== payload.slug && !sharedExists) {
            catalogSkill = await this.catalogManager.getCatalogSkill(canonical);
          }
        }
        if (shouldInstallShared) {
          const catalogOwner = catalogSkill?.ownerHandle
            ?.replace(/^@+/, "")
            .toLowerCase();
          if (
            requestedOwner &&
            (!catalogSkill || catalogOwner !== requestedOwner)
          ) {
            throw new Error(
              `catalog did not return @${requestedOwner}/${payload.slug}`,
            );
          }
          canonical = this.catalogManager.prepareInstall({
            slug: catalogSkill?.slug ?? canonical,
            ...((requestedOwner ?? catalogOwner ?? sharedOwner)
              ? {
                  ownerHandle: requestedOwner ?? catalogOwner ?? sharedOwner,
                }
              : {}),
            ...(payload.version || catalogSkill?.version
              ? { version: payload.version ?? catalogSkill?.version }
              : {}),
          });
          sharedDir = path.join(this.env.openclawSkillsDir, canonical);
          await this.catalogManager.executeInstall(canonical);
          downloadedSharedSkill = true;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Failed to download skill: ${message}` };
      }
    }

    // Copy to workspace directory.
    const workspaceDir = path.join(
      this.env.openclawStateDir,
      "agents",
      agentId,
      "skills",
      canonical,
    );
    const workspaceParent = path.dirname(workspaceDir);
    mkdirSync(workspaceParent, { recursive: true });
    const workspaceTransactionDir = mkdtempSync(
      path.join(workspaceParent, `.${canonical}-install-`),
    );
    const stagedWorkspaceDir = path.join(workspaceTransactionDir, "next");
    const previousWorkspaceDir = path.join(workspaceTransactionDir, "previous");
    try {
      cpSync(sharedDir, stagedWorkspaceDir, { recursive: true });
    } catch (err) {
      rmSync(workspaceTransactionDir, { recursive: true, force: true });
      if (downloadedSharedSkill) this.catalogManager.rollbackInstall(canonical);
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Failed to copy skill: ${message}` };
    }

    // Install npm dependencies if the skill has a package.json.
    if (existsSync(path.join(stagedWorkspaceDir, "package.json"))) {
      try {
        await ensureNpmAvailable();
        await runNpmInstall(stagedWorkspaceDir);
      } catch (err) {
        rmSync(workspaceTransactionDir, { recursive: true, force: true });
        if (downloadedSharedSkill) {
          this.catalogManager.rollbackInstall(canonical);
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `Failed to install dependencies: ${message}`,
        };
      }
    }

    let previousWorkspaceMoved = false;
    let stagedWorkspaceMoved = false;
    try {
      if (existsSync(workspaceDir)) {
        renameSync(workspaceDir, previousWorkspaceDir);
        previousWorkspaceMoved = true;
      }
      renameSync(stagedWorkspaceDir, workspaceDir);
      stagedWorkspaceMoved = true;
    } catch (err) {
      if (stagedWorkspaceMoved) {
        rmSync(workspaceDir, { recursive: true, force: true });
      }
      if (previousWorkspaceMoved && existsSync(previousWorkspaceDir)) {
        renameSync(previousWorkspaceDir, workspaceDir);
      }
      rmSync(workspaceTransactionDir, { recursive: true, force: true });
      if (downloadedSharedSkill) this.catalogManager.rollbackInstall(canonical);
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Failed to copy skill: ${message}` };
    }

    // Record install in ledger and trigger sync.
    const metadata = this.catalogManager.consumeInstalledMetadata(canonical);
    const installedVersion =
      metadata?.version ??
      payload.version ??
      catalogSkill?.version ??
      sharedRecord?.version ??
      undefined;
    const resolvedOwner =
      metadata?.ownerHandle ??
      catalogSkill?.ownerHandle ??
      sharedRecord?.ownerHandle ??
      undefined;
    try {
      if (downloadedSharedSkill) {
        this.db.recordInstalls([
          {
            slug: canonical,
            source: "managed",
            version: installedVersion,
            ownerHandle: resolvedOwner,
          },
          {
            slug: canonical,
            source: "workspace",
            version: installedVersion,
            agentId,
            ownerHandle: resolvedOwner,
          },
        ]);
      } else {
        this.db.recordInstall(
          canonical,
          "workspace",
          installedVersion,
          agentId,
          resolvedOwner,
        );
      }
    } catch (error) {
      rmSync(workspaceDir, { recursive: true, force: true });
      if (previousWorkspaceMoved && existsSync(previousWorkspaceDir)) {
        renameSync(previousWorkspaceDir, workspaceDir);
      }
      rmSync(workspaceTransactionDir, { recursive: true, force: true });
      if (downloadedSharedSkill) {
        this.catalogManager.rollbackInstall(canonical);
      }
      throw error;
    }
    if (downloadedSharedSkill) this.catalogManager.commitInstall(canonical);
    rmSync(workspaceTransactionDir, { recursive: true, force: true });
    this.dirWatcher.syncNow();
    this.onSyncNeeded?.();

    return { ok: true };
  }

  async uninstallSkill(
    request: SkillUninstallRequest,
  ): Promise<{ ok: boolean; error?: string }> {
    const canonical = this.catalogManager.canonicalizeSlug(request.slug);
    if (this.installQueue.hasActiveUpdate(canonical)) {
      return {
        ok: false,
        error: `Cannot uninstall ${canonical} while an update is in progress`,
      };
    }
    this.cancelInstall(canonical);
    const result = await this.catalogManager.uninstallSkill({
      ...request,
      slug: canonical,
    });
    if (result.ok) {
      this.dirWatcher.syncNow();
      if (this.getBotIds) {
        void this.getBotIds()
          .then((ids) => {
            this.dirWatcher.setBotIds(ids);
          })
          .catch(() => {});
      }
      this.onSyncNeeded?.();
    }

    return result;
  }

  dispose(): void {
    this.dirWatcher.stop();
    this.installQueue.dispose();
    this.catalogManager.dispose();
  }
}
