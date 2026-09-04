import { randomUUID } from "node:crypto";
import {
  type XhsOpsAccount,
  type XhsOpsAccountCreateInput,
  type XhsOpsAccountUpdateInput,
  type XhsOpsProject,
  type XhsOpsProjectCreateInput,
  type XhsOpsProjectUpdateInput,
  type XhsOpsRun,
  type XhsOpsRunListQuery,
  type XhsOpsStoreData,
  xhsOpsAccountCreateSchema,
  xhsOpsAccountUpdateSchema,
  xhsOpsProjectCreateSchema,
  xhsOpsProjectUpdateSchema,
  xhsOpsStoreDataSchema,
} from "@nexu/shared";
import { LowDbStore } from "./lowdb-store.js";

/** Oldest runs are dropped past this many (spec §2). */
export const XHS_OPS_MAX_RUNS = 500;

/** Everything a run carries except the store-assigned id/timestamps. */
export type XhsOpsRunSeed = Omit<XhsOpsRun, "id" | "createdAt" | "updatedAt">;

export interface XhsOpsStoreDeps {
  now?: () => string;
  genId?: () => string;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      (out as Record<string, unknown>)[key] = entry;
    }
  }
  return out;
}

export class XhsOpsStore {
  private readonly store: LowDbStore<XhsOpsStoreData>;
  /**
   * Every mutation runs read → transform → write under this queue. LowDbStore
   * serializes writes but not read-modify-write cycles, and the run executor
   * patches chunks while the API may be patching notes or cancelling — two
   * interleaved updaters would silently drop one another's change.
   */
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private readonly now: () => string;
  private readonly genId: () => string;

  constructor(filePath: string, deps: XhsOpsStoreDeps = {}) {
    this.store = new LowDbStore<XhsOpsStoreData>(
      filePath,
      xhsOpsStoreDataSchema,
      () => ({ schemaVersion: 1, projects: [], accounts: [], runs: [] }),
    );
    this.now = deps.now ?? (() => new Date().toISOString());
    this.genId = deps.genId ?? (() => randomUUID());
  }

  private mutate<R>(
    fn: (current: XhsOpsStoreData) => { data: XhsOpsStoreData; result: R },
  ): Promise<R> {
    const next = this.mutationQueue.then(async () => {
      const current = await this.store.read();
      const { data, result } = fn(current);
      if (data !== current) {
        await this.store.write(data);
      }
      return result;
    });
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }

  // ─── Projects ──────────────────────────────────────────────────────────────

  async listProjects(): Promise<XhsOpsProject[]> {
    return (await this.store.read()).projects;
  }

  async getProject(projectId: string): Promise<XhsOpsProject | null> {
    return (await this.listProjects()).find((p) => p.id === projectId) ?? null;
  }

  async createProject(input: XhsOpsProjectCreateInput): Promise<XhsOpsProject> {
    const parsed = xhsOpsProjectCreateSchema.parse(input);
    const now = this.now();
    const { profile, ...rest } = parsed;
    const project: XhsOpsProject = {
      ...rest,
      id: this.genId(),
      profile: profile
        ? { ...profile, updatedAt: profile.updatedAt ?? now }
        : null,
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate((current) => ({
      data: { ...current, projects: [...current.projects, project] },
      result: project,
    }));
  }

  async updateProject(
    projectId: string,
    patch: XhsOpsProjectUpdateInput,
  ): Promise<XhsOpsProject | null> {
    const parsed = xhsOpsProjectUpdateSchema.parse(patch);
    return this.mutate((current) => {
      const index = current.projects.findIndex((p) => p.id === projectId);
      const existing = current.projects[index];
      if (!existing) {
        return { data: current, result: null };
      }
      const now = this.now();
      const { profile, ...rest } = parsed;
      const next: XhsOpsProject = {
        ...existing,
        ...stripUndefined(rest),
        updatedAt: now,
      };
      if (profile !== undefined) {
        next.profile = profile
          ? { ...profile, updatedAt: profile.updatedAt ?? now }
          : null;
      }
      const projects = [...current.projects];
      projects[index] = next;
      return { data: { ...current, projects }, result: next };
    });
  }

  /** Deleting a project cascades to its accounts and runs (spec §2). */
  async deleteProject(projectId: string): Promise<XhsOpsProject | null> {
    return this.mutate((current) => {
      const existing = current.projects.find((p) => p.id === projectId);
      if (!existing) {
        return { data: current, result: null };
      }
      return {
        data: {
          ...current,
          projects: current.projects.filter((p) => p.id !== projectId),
          accounts: current.accounts.filter((a) => a.projectId !== projectId),
          runs: current.runs.filter((r) => r.projectId !== projectId),
        },
        result: existing,
      };
    });
  }

  // ─── Accounts ──────────────────────────────────────────────────────────────

  async listAccountsByProject(projectId: string): Promise<XhsOpsAccount[]> {
    return (await this.store.read()).accounts.filter(
      (a) => a.projectId === projectId,
    );
  }

  async getAccount(accountId: string): Promise<XhsOpsAccount | null> {
    return (
      (await this.store.read()).accounts.find((a) => a.id === accountId) ?? null
    );
  }

  async createAccount(input: XhsOpsAccountCreateInput): Promise<XhsOpsAccount> {
    const parsed = xhsOpsAccountCreateSchema.parse(input);
    const now = this.now();
    const account: XhsOpsAccount = {
      ...parsed,
      id: this.genId(),
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate((current) => ({
      data: { ...current, accounts: [...current.accounts, account] },
      result: account,
    }));
  }

  async updateAccount(
    accountId: string,
    patch: XhsOpsAccountUpdateInput,
  ): Promise<XhsOpsAccount | null> {
    const parsed = xhsOpsAccountUpdateSchema.parse(patch);
    return this.mutate((current) => {
      const index = current.accounts.findIndex((a) => a.id === accountId);
      const existing = current.accounts[index];
      if (!existing) {
        return { data: current, result: null };
      }
      const next: XhsOpsAccount = {
        ...existing,
        ...stripUndefined(parsed),
        updatedAt: this.now(),
      };
      const accounts = [...current.accounts];
      accounts[index] = next;
      return { data: { ...current, accounts }, result: next };
    });
  }

  /** Runs keep their `accountLabel` snapshot and are retained as history. */
  async deleteAccount(accountId: string): Promise<XhsOpsAccount | null> {
    return this.mutate((current) => {
      const existing = current.accounts.find((a) => a.id === accountId);
      if (!existing) {
        return { data: current, result: null };
      }
      return {
        data: {
          ...current,
          accounts: current.accounts.filter((a) => a.id !== accountId),
        },
        result: existing,
      };
    });
  }

  // ─── Runs ──────────────────────────────────────────────────────────────────

  /** Newest first (createdAt desc). */
  async listRuns(filter: XhsOpsRunListQuery = {}): Promise<XhsOpsRun[]> {
    const runs = (await this.store.read()).runs.filter(
      (run) =>
        (filter.projectId === undefined ||
          run.projectId === filter.projectId) &&
        (filter.accountId === undefined ||
          run.accountId === filter.accountId) &&
        (filter.date === undefined || run.date === filter.date),
    );
    // Stored order is insertion order; reverse it first so equal createdAt
    // values still come out newest-first under a stable sort.
    return runs
      .reverse()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getRun(runId: string): Promise<XhsOpsRun | null> {
    return (await this.store.read()).runs.find((r) => r.id === runId) ?? null;
  }

  async createRun(seed: XhsOpsRunSeed): Promise<XhsOpsRun> {
    const now = this.now();
    const run: XhsOpsRun = {
      ...seed,
      id: this.genId(),
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate((current) => {
      const runs = [...current.runs, run];
      const overflow = Math.max(0, runs.length - XHS_OPS_MAX_RUNS);
      return {
        data: { ...current, runs: overflow > 0 ? runs.slice(overflow) : runs },
        result: run,
      };
    });
  }

  async updateRun(
    runId: string,
    updater: (current: XhsOpsRun) => XhsOpsRun,
  ): Promise<XhsOpsRun | null> {
    return this.mutate((current) => {
      const index = current.runs.findIndex((r) => r.id === runId);
      const existing = current.runs[index];
      if (!existing) {
        return { data: current, result: null };
      }
      const next = { ...updater(existing), id: existing.id };
      if (next.updatedAt === existing.updatedAt) {
        next.updatedAt = this.now();
      }
      const runs = [...current.runs];
      runs[index] = next;
      return { data: { ...current, runs }, result: next };
    });
  }

  async deleteRun(runId: string): Promise<XhsOpsRun | null> {
    return this.mutate((current) => {
      const existing = current.runs.find((r) => r.id === runId);
      if (!existing) {
        return { data: current, result: null };
      }
      return {
        data: { ...current, runs: current.runs.filter((r) => r.id !== runId) },
        result: existing,
      };
    });
  }
}
