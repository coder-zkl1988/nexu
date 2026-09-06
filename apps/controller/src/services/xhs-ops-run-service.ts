import type {
  DeviceExecuteTaskBody,
  DeviceInfo,
  DeviceTaskPolicy,
  TaskResult,
  XhsOpsAccount,
  XhsOpsAnomaly,
  XhsOpsAnomalyType,
  XhsOpsInteractionConfig,
  XhsOpsInteractionCounts,
  XhsOpsInteractionRule,
  XhsOpsPlanSuggestion,
  XhsOpsRun,
  XhsOpsRunChunk,
  XhsOpsRunCreate,
  XhsOpsRunPlan,
  XhsOpsRunSummary,
} from "@nexu/shared";
import { logger } from "../lib/logger.js";
import type { XhsOpsRunSeed, XhsOpsStore } from "../store/xhs-ops-store.js";
import {
  DeviceControlRpcError,
  type DeviceControlService,
} from "./device-control-service.js";
import { suggestDailyPlans } from "./xhs-ops-plan-suggest.js";
import {
  type XhsOpsChunkQuota,
  buildCommentChunkTask,
  buildHomeChunkTask,
  buildSearchChunkTask,
  extractBrowsedFromMessage,
  formatPersona,
  parseCommentJson,
  parseReceiptClicks,
  parseRecordJson,
} from "./xhs-ops-task-builder.js";

// Executes one xhs-ops run: its chunks go to the phone strictly one at a time
// through DeviceControlService (spec §4). Never talks to tabby-control itself.

export const XHS_PACKAGE = "com.xingin.xhs";
export const XHS_CHUNK_TIMEOUT_MS = 300_000;

export const XHS_TASK_POLICY: DeviceTaskPolicy = {
  operationClass: "app.use.xhs",
  targetPackages: [XHS_PACKAGE],
  allowedAppRoles: ["target_app", "system_dialog", "system_settings"],
  allowedActions: [
    "AWAKE",
    "CLICK",
    "TYPE",
    "ENTER",
    "WAIT",
    "BACK",
    "HOME",
    "SLIDE",
    "SCROLL",
    "LOAD_SKILL",
    "COMPLETE",
    "ABORT",
    "INFO",
  ],
  allowedApps: [XHS_PACKAGE],
  confirmationPolicy: { publish: "forbidden", payment: "forbidden" },
};

/** Anomalies that end the whole run: the account must not keep browsing. */
const SAFETY_STOP_TYPES: ReadonlySet<XhsOpsAnomalyType> = new Set([
  "login_required",
  "account_restricted",
  "rate_limited",
]);
const MAX_CONSECUTIVE_FAILURES = 2;
const MAX_MESSAGE_CHARS = 4000;
const MAX_ERROR_CHARS = 200;
const DEVICE_UNAVAILABLE = "设备不可用";

export const XHS_OPS_DEFAULT_IDLE_POLL_MS = 3_000;
export const XHS_OPS_DEFAULT_IDLE_WAIT_MS = 180_000;
export const XHS_OPS_DEFAULT_OFFLINE_AFTER_MS = 90_000;

export type XhsOpsDeviceControl = Pick<
  DeviceControlService,
  "getDevice" | "executeTask" | "cancelTask"
>;

export interface XhsOpsRunServiceOptions {
  idlePollIntervalMs?: number;
  idleWaitTimeoutMs?: number;
  offlineAfterMs?: number;
  now?: () => number;
}

export interface XhsOpsRunServiceDeps {
  store: XhsOpsStore;
  deviceControl: XhsOpsDeviceControl;
  options?: XhsOpsRunServiceOptions;
}

/** Client-facing failure; routes map `status` straight to the HTTP code. */
export class XhsOpsError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "XhsOpsError";
  }
}

interface RunController {
  cancelled: boolean;
  deviceId: string;
  done: Promise<void>;
}

/** Fields a finished phone task writes back onto its chunk. */
type ChunkOutcome = Pick<
  XhsOpsRunChunk,
  | "status"
  | "browsed"
  | "skipped"
  | "interactions"
  | "anomalies"
  | "posts"
  | "observation"
  | "taskId"
  | "totalSteps"
  | "finalScreenshot"
  | "message"
  | "error"
>;

const ZERO_COUNTS: XhsOpsInteractionCounts = { like: 0, collect: 0, follow: 0 };

/** 评论任务（P3-1 D2）：一条评论一个 chunk，步数预算与时间窗。 */
export const XHS_COMMENT_CHUNK_MAX_STEPS = 40;
export const XHS_COMMENT_WINDOW_START_HOUR = 8;
export const XHS_COMMENT_WINDOW_END_HOUR = 23;
export const XHS_COMMENT_MIN_GAP_AFTER_BROWSE_MS = 10 * 60_000;

/** 评论任务的手机策略：仍禁发布/付款，评论放开但只放行这一条审核原文。 */
export function commentTaskPolicy(text: string): DeviceTaskPolicy {
  return {
    ...XHS_TASK_POLICY,
    confirmationPolicy: {
      ...XHS_TASK_POLICY.confirmationPolicy,
      comment: "allowed",
    },
    commentAllowlist: [text],
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Local-time YYYY-MM-DD (the operator plans "today" in their own zone). */
export function localDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildRunChunks(plan: XhsOpsRunPlan): XhsOpsRunChunk[] {
  const blank = {
    status: "pending" as const,
    taskId: null,
    startedAt: null,
    completedAt: null,
    browsed: 0,
    skipped: 0,
    interactions: { ...ZERO_COUNTS },
    anomalies: [],
    observation: null,
    posts: [],
    message: null,
    totalSteps: null,
    finalScreenshot: null,
    error: null,
    commentDraftId: null,
  };
  if (plan.kind === "comment") {
    // 一条评论一个 chunk：任务文本、手机白名单、回填都以草稿为单位。
    return (plan.comments ?? []).map((comment, index) => ({
      ...blank,
      index,
      mode: "comment" as const,
      keyword: null,
      plannedCount: 1,
      commentDraftId: comment.draftId,
    }));
  }
  const chunks: XhsOpsRunChunk[] = plan.keywords.map((entry, index) => ({
    ...blank,
    index,
    mode: "search",
    keyword: entry.keyword,
    plannedCount: entry.count,
  }));
  if (plan.homeFeedCount > 0) {
    chunks.push({
      ...blank,
      index: chunks.length,
      mode: "home",
      keyword: null,
      plannedCount: plan.homeFeedCount,
    });
  }
  return chunks;
}

export function summarizeRun(
  chunks: XhsOpsRunChunk[],
  startedAt: string | null,
  completedAt: string | null,
): XhsOpsRunSummary {
  const summary: XhsOpsRunSummary = {
    plannedTotal: 0,
    browsedTotal: 0,
    searchBrowsed: 0,
    homeBrowsed: 0,
    interactions: { ...ZERO_COUNTS },
    anomalyCount: 0,
    durationMs: null,
  };
  let comments = 0;
  for (const chunk of chunks) {
    if (chunk.mode === "comment") {
      // 评论 chunk 不算浏览篇数；计划/实际用"篇"口径会误导看板。
      comments += chunk.interactions.comment ?? 0;
      summary.anomalyCount += chunk.anomalies.length;
      continue;
    }
    summary.plannedTotal += chunk.plannedCount;
    summary.browsedTotal += chunk.browsed;
    if (chunk.mode === "search") summary.searchBrowsed += chunk.browsed;
    else summary.homeBrowsed += chunk.browsed;
    summary.interactions.like += chunk.interactions.like;
    summary.interactions.collect += chunk.interactions.collect;
    summary.interactions.follow += chunk.interactions.follow;
    summary.anomalyCount += chunk.anomalies.length;
  }
  if (comments > 0) summary.interactions.comment = comments;
  if (startedAt && completedAt) {
    const duration = Date.parse(completedAt) - Date.parse(startedAt);
    summary.durationMs = Number.isFinite(duration)
      ? Math.max(0, duration)
      : null;
  }
  return summary;
}

/**
 * Per-chunk allowance (spec §4.4): min(remaining, ceil(dailyCap / chunks)).
 * A disabled rule or an exhausted cap yields 0.
 */
export function computeChunkQuota(
  config: XhsOpsInteractionConfig,
  used: XhsOpsInteractionCounts,
  totalChunks: number,
  /** 本 chunk 计划浏览篇数；给了才按 ratioPercent 封顶（触发比例 = 每浏览 N 篇最多互动 N×ratio）。 */
  plannedCount?: number,
): XhsOpsChunkQuota {
  const chunkCount = Math.max(1, totalChunks);
  const entry = (rule: XhsOpsInteractionRule, usedCount: number) => {
    if (!rule.enabled || rule.dailyCap <= 0) {
      return { enabled: false, max: 0 };
    }
    const remaining = Math.max(0, rule.dailyCap - usedCount);
    const share = Math.ceil(rule.dailyCap / chunkCount);
    let max = Math.max(0, Math.min(remaining, share));
    if (plannedCount !== undefined) {
      // 运营文档「触发比例」：比例为 0 视为本 chunk 不互动。
      const ratioCap =
        rule.ratioPercent > 0
          ? Math.ceil((plannedCount * rule.ratioPercent) / 100)
          : 0;
      max = Math.min(max, ratioCap);
    }
    return { enabled: max > 0, max };
  };
  return {
    like: entry(config.like, used.like),
    collect: entry(config.collect, used.collect),
    follow: entry(config.follow, used.follow),
  };
}

/**
 * Step budget per chunk. The phone's `maxSteps` schema caps at 100.
 *
 * Home-feed chunks need more headroom than search chunks: the model skips
 * ads/live/low-comment cards before finding a countable post, and every skip
 * costs 5–8 steps. Measured on the 2026-09-06 HONOR run (4 posts planned):
 * search chunks used 25 and 42 steps, home chunks 22, 33, 50 and one hit the
 * old 60 cap at 2/4 browsed. Search keeps 20 + 10/post; home gets 30 + 12/post.
 */
export function chunkMaxSteps(
  plannedCount: number,
  mode: "search" | "home" | "comment" = "search",
): number {
  if (mode === "comment") return XHS_COMMENT_CHUNK_MAX_STEPS;
  const budget =
    mode === "home" ? 30 + plannedCount * 12 : 20 + plannedCount * 10;
  return Math.min(100, budget);
}

/**
 * 评论任务结果 → chunk 字段。sent 且回执里小红书有生效点击 → completed +
 * interactions.comment=1；sent 但回执 0 次生效点击 → 不信，降为 failed 并记
 * 异常；failed → failed；skipped（帖子搜不到等）→ skipped。detail 进 observation。
 */
export function interpretCommentTaskResult(result: TaskResult): ChunkOutcome {
  const message = result.message ?? "";
  const json = parseCommentJson(message);
  const anomalies: XhsOpsAnomaly[] = [];
  const outcome: ChunkOutcome = {
    status: "failed",
    browsed: 0,
    skipped: 0,
    interactions: { ...ZERO_COUNTS },
    anomalies,
    posts: [],
    observation: null,
    taskId: result.taskId,
    totalSteps: result.totalSteps ?? null,
    finalScreenshot: result.finalScreenshot ?? null,
    message: message ? message.slice(0, MAX_MESSAGE_CHARS) : null,
    error: null,
  };
  if (!json) {
    anomalies.push({ type: "other", detail: "手机未返回 COMMENT_JSON" });
    outcome.error = result.success
      ? "手机未返回结构化评论结果"
      : (message || "任务失败").slice(0, MAX_ERROR_CHARS);
    return outcome;
  }
  for (const a of json.anomalies) {
    anomalies.push({
      type: (
        [
          "no_results",
          "load_failed",
          "login_required",
          "account_restricted",
          "rate_limited",
          "content_mismatch",
          "interrupted",
          "other",
        ] as const
      ).includes(a.type as XhsOpsAnomalyType)
        ? (a.type as XhsOpsAnomalyType)
        : "other",
      detail: a.detail || a.type,
    });
  }
  outcome.observation = json.detail || null;
  if (json.status === "sent") {
    const clicks = parseReceiptClicks(message, XHS_PACKAGE);
    if (clicks !== null && clicks === 0) {
      anomalies.push({
        type: "other",
        detail: "汇报已发出但回执里小红书 0 次生效点击，不予采信",
      });
      outcome.error = "汇报与回执不一致";
      return outcome;
    }
    outcome.status = "completed";
    outcome.interactions = { ...ZERO_COUNTS, comment: 1 };
    return outcome;
  }
  if (json.status === "skipped") {
    outcome.status = "skipped";
    outcome.error = json.detail || "未尝试评论";
    return outcome;
  }
  outcome.error = (json.detail || "评论未成功").slice(0, MAX_ERROR_CHARS);
  return outcome;
}

/** Turn a phone result into chunk fields (spec §4.3 + §6 fallback). */
export function interpretTaskResult(result: TaskResult): ChunkOutcome {
  const message = result.message ?? "";
  const record = parseRecordJson(message);
  const anomalies: XhsOpsAnomaly[] = [];
  const outcome: ChunkOutcome = {
    status: "completed",
    browsed: 0,
    skipped: 0,
    interactions: { ...ZERO_COUNTS },
    anomalies,
    posts: [],
    observation: null,
    taskId: result.taskId,
    totalSteps: result.totalSteps ?? null,
    finalScreenshot: result.finalScreenshot ?? null,
    message: message ? message.slice(0, MAX_MESSAGE_CHARS) : null,
    error: null,
  };
  if (record) {
    outcome.browsed = record.browsed;
    outcome.skipped = record.skipped;
    outcome.interactions = { ...record.interactions };
    anomalies.push(...record.anomalies);
    outcome.posts = record.posts;
    outcome.observation = record.observation;
  } else {
    const fallback = extractBrowsedFromMessage(message);
    if (fallback) outcome.browsed = fallback.browsed;
    anomalies.push({ type: "other", detail: "手机未返回结构化记录" });
  }
  if (!result.success) {
    outcome.status = "failed";
    const head = message.slice(0, MAX_ERROR_CHARS);
    anomalies.push({ type: "interrupted", detail: head });
    outcome.error = head || "手机任务未成功完成";
  }
  return outcome;
}

export class XhsOpsRunService {
  private readonly active = new Map<string, RunController>();
  /** P2-4 设备队列：deviceId → 等待启动的 runId（FIFO）。进程内状态，重启即清。 */
  private readonly deviceQueues = new Map<string, string[]>();
  private readonly store: XhsOpsStore;
  private readonly deviceControl: XhsOpsDeviceControl;
  private readonly idlePollIntervalMs: number;
  private readonly idleWaitTimeoutMs: number;
  private readonly offlineAfterMs: number;
  private readonly now: () => number;

  constructor(deps: XhsOpsRunServiceDeps) {
    this.store = deps.store;
    this.deviceControl = deps.deviceControl;
    this.idlePollIntervalMs =
      deps.options?.idlePollIntervalMs ?? XHS_OPS_DEFAULT_IDLE_POLL_MS;
    this.idleWaitTimeoutMs =
      deps.options?.idleWaitTimeoutMs ?? XHS_OPS_DEFAULT_IDLE_WAIT_MS;
    this.offlineAfterMs =
      deps.options?.offlineAfterMs ?? XHS_OPS_DEFAULT_OFFLINE_AFTER_MS;
    this.now = deps.options?.now ?? (() => Date.now());
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  // ─── Lifecycle API ─────────────────────────────────────────────────────────

  /** Plan a run (status `planned`). 404 unknown project/account, 400 no device. */
  /** 为项目下每个已绑设备的账号生成当日计划建议（确定性，见 xhs-ops-plan-suggest.ts）。 */
  async suggestPlans(projectId: string): Promise<XhsOpsPlanSuggestion[]> {
    const project = await this.store.getProject(projectId);
    if (!project) throw new XhsOpsError(404, "项目不存在");
    const accounts = await this.store.listAccountsByProject(projectId);
    const plans: XhsOpsPlanSuggestion[] = [];
    for (const account of accounts) {
      if (!account.deviceId) continue;
      const runs = await this.store.listRuns({ accountId: account.id });
      plans.push(
        ...suggestDailyPlans(
          account,
          runs,
          localDateString(new Date(this.now())),
        ),
      );
    }
    return plans;
  }

  async createRun(input: XhsOpsRunCreate): Promise<XhsOpsRun> {
    const project = await this.store.getProject(input.projectId);
    if (!project) throw new XhsOpsError(404, "项目不存在");
    const account = await this.store.getAccount(input.accountId);
    if (!account || account.projectId !== project.id) {
      throw new XhsOpsError(404, "账号不存在或不属于该项目");
    }
    if (!account.deviceId) {
      throw new XhsOpsError(400, "账号未绑定设备，无法创建运行计划");
    }
    if (input.plan.kind === "comment") {
      if ((input.plan.comments ?? []).length === 0) {
        throw new XhsOpsError(400, "评论任务至少要有一条已批准的评论");
      }
    } else if (input.plan.keywords.length === 0) {
      throw new XhsOpsError(400, "浏览计划至少填写一个关键词");
    }
    const chunks = buildRunChunks(input.plan);
    const seed: XhsOpsRunSeed = {
      projectId: project.id,
      accountId: account.id,
      deviceId: account.deviceId,
      accountLabel: account.label,
      date: input.date ?? localDateString(new Date(this.now())),
      status: "planned",
      plan: input.plan,
      segment: input.segment ?? null,
      queuedBehindRunId: null,
      chunks,
      summary: summarizeRun(chunks, null, null),
      notes: "",
      error: null,
      startedAt: null,
      completedAt: null,
    };
    return this.store.createRun(seed);
  }

  /**
   * P3-1 D2：把该账号已批准、尚未派发的评论草稿打成一个评论 run（每条一个
   * chunk），认领草稿（sentRunId）后创建。时间窗 08:00–23:00；距最近一次浏览
   * run 结束 ≥10 分钟（评审拍板）。不在这里 start——调用方决定何时启动。
   */
  async createCommentRun(input: {
    projectId: string;
    accountId: string;
    draftIds?: string[];
  }): Promise<XhsOpsRun> {
    const account = await this.store.getAccount(input.accountId);
    if (!account || account.projectId !== input.projectId) {
      throw new XhsOpsError(404, "账号不存在或不属于该项目");
    }
    if (!account.deviceId) {
      throw new XhsOpsError(400, "账号未绑定设备，无法发评论");
    }
    const now = new Date(this.now());
    const hour = now.getHours();
    if (
      hour < XHS_COMMENT_WINDOW_START_HOUR ||
      hour >= XHS_COMMENT_WINDOW_END_HOUR
    ) {
      throw new XhsOpsError(
        409,
        `评论只在 ${String(XHS_COMMENT_WINDOW_START_HOUR).padStart(2, "0")}:00–${XHS_COMMENT_WINDOW_END_HOUR}:00 之间派发`,
      );
    }
    const today = localDateString(now);
    const todayRuns = await this.store.listRuns({
      accountId: account.id,
      date: today,
    });
    const lastBrowseEnd = todayRuns
      .filter((r) => r.plan.kind !== "comment" && r.completedAt)
      .map((r) => Date.parse(r.completedAt as string))
      .filter((t) => Number.isFinite(t))
      .reduce((max, t) => Math.max(max, t), 0);
    if (
      lastBrowseEnd > 0 &&
      this.now() - lastBrowseEnd < XHS_COMMENT_MIN_GAP_AFTER_BROWSE_MS
    ) {
      const wait = Math.ceil(
        (XHS_COMMENT_MIN_GAP_AFTER_BROWSE_MS - (this.now() - lastBrowseEnd)) /
          60_000,
      );
      throw new XhsOpsError(
        409,
        `浏览刚结束，${wait} 分钟后再发评论（与浏览间隔 ≥10 分钟）`,
      );
    }
    const approved = (
      await this.store.listComments({
        accountId: account.id,
        status: "approved",
      })
    )
      .filter((d) => !d.sentRunId && d.text)
      .filter((d) => !input.draftIds || input.draftIds.includes(d.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, 5);
    if (approved.length === 0) {
      throw new XhsOpsError(400, "没有已批准且未派发的评论");
    }
    const run = await this.createRun({
      projectId: input.projectId,
      accountId: account.id,
      date: today,
      segment: null,
      plan: {
        kind: "comment",
        keywords: [],
        homeFeedCount: 0,
        dwellSecMin: account.browseDefaults.dwellSecMin,
        dwellSecMax: account.browseDefaults.dwellSecMax,
        interaction: account.interaction,
        comments: approved.map((d) => ({
          draftId: d.id,
          postTitle: d.post.title,
          postAuthor: d.post.author,
          text: d.text as string,
        })),
      },
    });
    for (const d of approved) {
      await this.store.updateComment(d.id, (cur) => ({
        ...cur,
        sentRunId: run.id,
        updatedAt: this.nowIso(),
      }));
    }
    logger.info(
      { runId: run.id, accountId: account.id, comments: approved.length },
      "xhs-ops: comment run created",
    );
    return run;
  }

  /** Kick off the executor; returns immediately with the run in `running`. */
  async startRun(runId: string): Promise<XhsOpsRun> {
    const run = await this.store.getRun(runId);
    if (!run) throw new XhsOpsError(404, "运行记录不存在");
    if (run.status !== "planned" || this.active.has(runId)) {
      throw new XhsOpsError(
        409,
        run.status === "running"
          ? "运行已在进行中"
          : "运行已结束，不能重新启动",
      );
    }
    // 同一手机上已有 xhs-ops run 在跑：排队，前一个结束后自动启动（P2-4）。
    // 否则两个 run 各自 3s 轮询设备空闲，会一起冲进 TASK_ALREADY_RUNNING。
    const busyRunId = this.activeRunOnDevice(run.deviceId);
    if (busyRunId !== null && busyRunId !== runId) {
      const queue = this.deviceQueues.get(run.deviceId) ?? [];
      if (!queue.includes(runId)) queue.push(runId);
      this.deviceQueues.set(run.deviceId, queue);
      const now = this.nowIso();
      const queued = await this.store.updateRun(runId, (current) => ({
        ...current,
        queuedBehindRunId: busyRunId,
        updatedAt: now,
      }));
      if (!queued) throw new XhsOpsError(404, "运行记录不存在");
      logger.info(
        {
          runId,
          deviceId: run.deviceId,
          behind: busyRunId,
          position: queue.length,
        },
        "xhs-ops: run queued behind another run on the same device",
      );
      return queued;
    }
    const account = await this.store.getAccount(run.accountId);
    const startedAt = this.nowIso();
    const started = await this.store.updateRun(runId, (current) => ({
      ...current,
      status: "running",
      queuedBehindRunId: null,
      startedAt,
      completedAt: null,
      error: null,
      updatedAt: startedAt,
    }));
    if (!started) throw new XhsOpsError(404, "运行记录不存在");

    const controller: RunController = {
      cancelled: false,
      deviceId: started.deviceId,
      done: Promise.resolve(),
    };
    controller.done = this.execute(started, account, controller)
      .catch((error: unknown) => {
        // The loop guards every await; this only fires on a bug in the loop
        // itself. Still never leave the run stuck in `running`.
        logger.error(
          { runId, error: describe(error) },
          "xhs-ops: run executor crashed",
        );
        return this.finalizeRun(
          runId,
          controller,
          `执行器异常：${describe(error)}`,
        );
      })
      .catch((error: unknown) => {
        logger.error(
          { runId, error: describe(error) },
          "xhs-ops: run finalization failed",
        );
      })
      .finally(() => {
        this.active.delete(runId);
        void this.drainDeviceQueue(started.deviceId);
      });
    this.active.set(runId, controller);
    logger.info(
      { runId, deviceId: started.deviceId, chunks: started.chunks.length },
      "xhs-ops: run started",
    );
    return started;
  }

  /** Mark cancelled now, stop the phone's current task, let the loop drain. */
  async cancelRun(runId: string): Promise<XhsOpsRun> {
    const run = await this.store.getRun(runId);
    if (!run) throw new XhsOpsError(404, "运行记录不存在");
    if (run.status === "planned" && run.queuedBehindRunId) {
      // 还在设备队列里等着：出队即取消，不碰手机。
      const queue = this.deviceQueues.get(run.deviceId);
      if (queue) {
        const idx = queue.indexOf(runId);
        if (idx >= 0) queue.splice(idx, 1);
        if (queue.length === 0) this.deviceQueues.delete(run.deviceId);
      }
      const now = this.nowIso();
      const dequeued = await this.store.updateRun(runId, (current) => ({
        ...current,
        status: "cancelled",
        queuedBehindRunId: null,
        chunks: current.chunks.map((chunk) =>
          chunk.status === "pending"
            ? { ...chunk, status: "cancelled" }
            : chunk,
        ),
        completedAt: now,
        updatedAt: now,
      }));
      if (!dequeued) throw new XhsOpsError(404, "运行记录不存在");
      logger.info(
        { runId, deviceId: run.deviceId },
        "xhs-ops: queued run cancelled",
      );
      return dequeued;
    }
    if (run.status !== "running") {
      throw new XhsOpsError(409, "运行未在进行中，无法取消");
    }
    const controller = this.active.get(runId);
    if (controller) controller.cancelled = true;
    const now = this.nowIso();
    const cancelled = await this.store.updateRun(runId, (current) => ({
      ...current,
      status: "cancelled",
      chunks: current.chunks.map((chunk) =>
        chunk.status === "pending" ? { ...chunk, status: "cancelled" } : chunk,
      ),
      // No executor holds this run (e.g. it belonged to a previous process
      // instance), so nothing else will ever close it out.
      ...(controller ? {} : { completedAt: now }),
      updatedAt: now,
    }));
    if (!cancelled) throw new XhsOpsError(404, "运行记录不存在");
    logger.info({ runId, deviceId: run.deviceId }, "xhs-ops: run cancelled");
    await this.cancelDeviceTask(run.deviceId, runId);
    return cancelled;
  }

  /** Startup sweep: runs left `running` by a previous process are dead. */
  async recoverInterruptedRuns(): Promise<number> {
    const runs = await this.store.listRuns();
    let recovered = 0;
    for (const run of runs) {
      if (run.status === "planned" && run.queuedBehindRunId) {
        // 队列是进程内的：上次进程留下的"排队中"只是个孤儿标记，清掉让它回到可手动开始。
        await this.store.updateRun(run.id, (current) => ({
          ...current,
          queuedBehindRunId: null,
          updatedAt: this.nowIso(),
        }));
        continue;
      }
      if (run.status !== "running" || this.active.has(run.id)) continue;
      const now = this.nowIso();
      const updated = await this.store.updateRun(run.id, (current) => {
        const chunks = current.chunks.map((chunk): XhsOpsRunChunk => {
          if (chunk.status === "running") {
            return {
              ...chunk,
              status: "failed",
              completedAt: now,
              error: "控制器重启，任务块被中断",
              anomalies: [
                ...chunk.anomalies,
                { type: "interrupted", detail: "控制器重启" },
              ],
            };
          }
          return chunk.status === "pending"
            ? { ...chunk, status: "skipped" }
            : chunk;
        });
        return {
          ...current,
          status: "interrupted",
          chunks,
          error: current.error ?? "控制器重启，运行被中断",
          completedAt: now,
          summary: summarizeRun(chunks, current.startedAt, now),
          updatedAt: now,
        };
      });
      if (updated) recovered += 1;
    }
    if (recovered > 0) {
      logger.warn(
        { recovered },
        "xhs-ops: marked leftover running runs interrupted",
      );
    }
    return recovered;
  }

  isRunning(runId: string): boolean {
    return this.active.has(runId);
  }

  /** runId of the run currently executing on `deviceId`, if any. */
  activeRunOnDevice(deviceId: string): string | null {
    for (const [runId, controller] of this.active) {
      if (controller.deviceId === deviceId) return runId;
    }
    return null;
  }

  /** Queued runIds for `deviceId`, in start order. */
  queuedRunIds(deviceId: string): readonly string[] {
    return this.deviceQueues.get(deviceId) ?? [];
  }

  /** After a run drains, start the next planned run waiting on the same phone. */
  private async drainDeviceQueue(deviceId: string): Promise<void> {
    const queue = this.deviceQueues.get(deviceId);
    if (!queue) return;
    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId) break;
      const next = await this.store.getRun(nextId).catch(() => null);
      if (!next || next.status !== "planned") continue;
      try {
        await this.startRun(nextId);
        logger.info(
          { runId: nextId, deviceId, remaining: queue.length },
          "xhs-ops: queued run started",
        );
        break;
      } catch (error: unknown) {
        logger.warn(
          { runId: nextId, deviceId, error: describe(error) },
          "xhs-ops: starting queued run failed, trying the next one",
        );
      }
    }
    if (queue.length === 0) this.deviceQueues.delete(deviceId);
  }

  /** Resolves once the executor for `runId` has drained (immediately if idle). */
  async waitForRun(runId: string): Promise<void> {
    await this.active.get(runId)?.done;
  }

  // ─── Executor ──────────────────────────────────────────────────────────────

  private async execute(
    run: XhsOpsRun,
    account: XhsOpsAccount | null,
    controller: RunController,
  ): Promise<void> {
    const totalChunks = run.chunks.length;
    const used: XhsOpsInteractionCounts = { ...ZERO_COUNTS };
    let consecutiveFailures = 0;
    let stopReason: string | null = null;

    for (const chunk of run.chunks) {
      if (controller.cancelled) {
        await this.patchChunk(run.id, chunk.index, (c) =>
          c.status === "pending" ? { ...c, status: "cancelled" } : c,
        );
        continue;
      }
      if (stopReason !== null) {
        await this.patchChunk(run.id, chunk.index, (c) => ({
          ...c,
          status: "skipped",
        }));
        continue;
      }

      await this.patchChunk(run.id, chunk.index, (c) => ({
        ...c,
        status: "running",
        startedAt: this.nowIso(),
      }));

      const idle = await this.waitForIdle(controller);
      if (controller.cancelled) {
        await this.patchChunk(run.id, chunk.index, (c) => ({
          ...c,
          status: "cancelled",
          completedAt: this.nowIso(),
        }));
        continue;
      }
      if (!idle.ok) {
        stopReason = idle.error;
        await this.patchChunk(run.id, chunk.index, (c) => ({
          ...c,
          status: "failed",
          completedAt: this.nowIso(),
          error: idle.error,
        }));
        logger.warn(
          { runId: run.id, chunk: chunk.index, error: idle.error },
          "xhs-ops: device not ready, stopping run",
        );
        continue;
      }

      const quota = computeChunkQuota(
        run.plan.interaction,
        used,
        totalChunks,
        chunk.plannedCount,
      );
      const outcome = await this.runChunkOnDevice(
        run,
        account,
        chunk,
        quota,
        controller,
      );

      used.like += outcome.interactions.like;
      used.collect += outcome.interactions.collect;
      used.follow += outcome.interactions.follow;

      await this.patchChunk(run.id, chunk.index, (c) => ({
        ...c,
        ...outcome,
        completedAt: this.nowIso(),
      }));
      if (chunk.mode === "comment") {
        await this.recordCommentOutcome(run.id, chunk, outcome);
      }
      logger.info(
        {
          runId: run.id,
          chunk: chunk.index,
          mode: chunk.mode,
          keyword: chunk.keyword,
          status: outcome.status,
          browsed: outcome.browsed,
          anomalies: outcome.anomalies.map((a) => a.type),
        },
        "xhs-ops: chunk finished",
      );
      if (controller.cancelled) continue;

      const fatal = outcome.anomalies.find((a) =>
        SAFETY_STOP_TYPES.has(a.type),
      );
      if (fatal) {
        stopReason = `安全停机：手机报告 ${fatal.type}${fatal.detail ? `（${fatal.detail}）` : ""}`;
        continue;
      }
      if (outcome.status === "failed") {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopReason = `连续 ${MAX_CONSECUTIVE_FAILURES} 个任务块失败，已停止执行`;
        }
      } else {
        consecutiveFailures = 0;
      }
    }

    if (run.plan.kind === "comment") {
      await this.releaseUnprocessedDrafts(run.id);
    }
    await this.finalizeRun(run.id, controller, stopReason);
  }

  /** 评论 chunk 收尾：把结果写回草稿（sent / failed），供队列和看板展示。 */
  private async recordCommentOutcome(
    runId: string,
    chunk: XhsOpsRunChunk,
    outcome: ChunkOutcome,
  ): Promise<void> {
    const draftId = chunk.commentDraftId;
    if (!draftId) return;
    const now = this.nowIso();
    const sent =
      outcome.status === "completed" && (outcome.interactions.comment ?? 0) > 0;
    try {
      await this.store.updateComment(draftId, (cur) => ({
        ...cur,
        status: sent ? "sent" : "failed",
        sentRunId: runId,
        sentAt: sent ? now : cur.sentAt,
        sendResult: (
          outcome.error ??
          outcome.observation ??
          (sent ? "已发出" : "未发出")
        ).slice(0, 300),
        updatedAt: now,
      }));
    } catch (error: unknown) {
      logger.error(
        { runId, draftId, error: describe(error) },
        "xhs-ops: recording comment outcome failed",
      );
    }
  }

  /** 评论 run 结束时，认领了但没处理到的草稿（取消/中断）放回 approved 池。 */
  private async releaseUnprocessedDrafts(runId: string): Promise<void> {
    const claimed = (
      await this.store.listComments({ status: "approved" })
    ).filter((d) => d.sentRunId === runId);
    for (const d of claimed) {
      await this.store.updateComment(d.id, (cur) => ({
        ...cur,
        sentRunId: null,
        updatedAt: this.nowIso(),
      }));
    }
  }

  private async runChunkOnDevice(
    run: XhsOpsRun,
    account: XhsOpsAccount | null,
    chunk: XhsOpsRunChunk,
    quota: XhsOpsChunkQuota,
    controller: RunController,
  ): Promise<ChunkOutcome> {
    const base = {
      label: run.accountLabel,
      positioning: account?.positioning ?? "",
      persona: formatPersona(account?.persona),
      dwellSecMin: run.plan.dwellSecMin,
      dwellSecMax: run.plan.dwellSecMax,
      quota,
    };
    const comment =
      chunk.mode === "comment"
        ? (run.plan.comments ?? []).find(
            (c) => c.draftId === chunk.commentDraftId,
          )
        : undefined;
    if (chunk.mode === "comment" && !comment) {
      return {
        status: "failed",
        browsed: 0,
        skipped: 0,
        interactions: { ...ZERO_COUNTS },
        anomalies: [{ type: "other", detail: "评论 chunk 找不到对应草稿" }],
        posts: [],
        observation: null,
        taskId: null,
        totalSteps: null,
        finalScreenshot: null,
        message: null,
        error: "评论 chunk 找不到对应草稿",
      };
    }
    const task = comment
      ? buildCommentChunkTask({
          label: base.label,
          positioning: base.positioning,
          persona: base.persona,
          postTitle: comment.postTitle,
          postAuthor: comment.postAuthor,
          text: comment.text,
        })
      : chunk.mode === "search"
        ? buildSearchChunkTask({
            ...base,
            keyword: chunk.keyword ?? "",
            count: chunk.plannedCount,
          })
        : buildHomeChunkTask({ ...base, count: chunk.plannedCount });
    const body: DeviceExecuteTaskBody = {
      task,
      maxSteps: chunkMaxSteps(chunk.plannedCount, chunk.mode),
      timeout: XHS_CHUNK_TIMEOUT_MS,
      allowedApps: [XHS_PACKAGE],
      // 评论 chunk：手机策略放开评论但只放行这一条审核原文（逐字白名单）。
      taskPolicy: comment ? commentTaskPolicy(comment.text) : XHS_TASK_POLICY,
    };

    let outcome: ChunkOutcome;
    try {
      const { result } = await this.deviceControl.executeTask(
        run.deviceId,
        body,
      );
      outcome = comment
        ? interpretCommentTaskResult(result)
        : interpretTaskResult(result);
    } catch (error: unknown) {
      const reason = describe(error).slice(0, MAX_ERROR_CHARS);
      outcome = {
        status: "failed",
        browsed: 0,
        skipped: 0,
        interactions: { ...ZERO_COUNTS },
        anomalies: [{ type: "interrupted", detail: reason }],
        posts: [],
        observation: null,
        taskId: null,
        totalSteps: null,
        finalScreenshot: null,
        message: null,
        error: reason,
      };
      logger.warn(
        { runId: run.id, chunk: chunk.index, error: reason },
        "xhs-ops: device task dispatch failed",
      );
    }
    if (controller.cancelled) {
      outcome.status = "cancelled";
    }
    return outcome;
  }

  /**
   * Poll the device until idle (spec §4.1). Missing/offline devices fail
   * immediately; a device that stays busy fails at the deadline.
   */
  private async waitForIdle(
    controller: RunController,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const deadline = this.now() + this.idleWaitTimeoutMs;
    let lastProbeError: string | null = null;
    for (;;) {
      if (controller.cancelled) return { ok: false, error: "已取消" };
      let device: DeviceInfo | null | undefined;
      try {
        device = await this.deviceControl.getDevice(controller.deviceId);
      } catch (error: unknown) {
        if (
          error instanceof DeviceControlRpcError &&
          error.code === "DEVICE_NOT_FOUND"
        ) {
          return { ok: false, error: DEVICE_UNAVAILABLE };
        }
        lastProbeError = describe(error);
        device = undefined;
      }
      if (device === null) return { ok: false, error: DEVICE_UNAVAILABLE };
      if (device) {
        if (this.now() - device.lastSeen > this.offlineAfterMs) {
          return { ok: false, error: DEVICE_UNAVAILABLE };
        }
        if (device.status === "idle") return { ok: true };
      }
      if (this.now() >= deadline) {
        return {
          ok: false,
          error: device
            ? "等待设备空闲超时"
            : `${DEVICE_UNAVAILABLE}（无法查询设备状态：${lastProbeError ?? "unknown"}）`,
        };
      }
      await sleep(this.idlePollIntervalMs);
    }
  }

  private async cancelDeviceTask(
    deviceId: string,
    runId: string,
  ): Promise<void> {
    // The RPC returns the taskId only when the task ends, so ask the device
    // which task it is on; tabby-control also resolves "current" itself.
    let taskId = "current";
    try {
      const device = await this.deviceControl.getDevice(deviceId);
      if (device?.currentTaskId) taskId = device.currentTaskId;
    } catch {
      // fall back to "current"
    }
    try {
      await this.deviceControl.cancelTask(deviceId, { taskId });
    } catch (error: unknown) {
      logger.warn(
        { runId, deviceId, taskId, error: describe(error) },
        "xhs-ops: cancelling device task failed",
      );
    }
  }

  private async patchChunk(
    runId: string,
    index: number,
    patch: (chunk: XhsOpsRunChunk) => XhsOpsRunChunk,
  ): Promise<void> {
    try {
      await this.store.updateRun(runId, (current) => ({
        ...current,
        chunks: current.chunks.map((chunk) =>
          chunk.index === index ? patch(chunk) : chunk,
        ),
        updatedAt: this.nowIso(),
      }));
    } catch (error: unknown) {
      logger.error(
        { runId, chunk: index, error: describe(error) },
        "xhs-ops: persisting chunk state failed",
      );
    }
  }

  private async finalizeRun(
    runId: string,
    controller: RunController,
    stopReason: string | null,
  ): Promise<void> {
    const completedAt = this.nowIso();
    const finished = await this.store.updateRun(runId, (current) => {
      const status = controller.cancelled
        ? "cancelled"
        : stopReason !== null
          ? "failed"
          : "completed";
      return {
        ...current,
        status,
        error: controller.cancelled ? current.error : stopReason,
        completedAt,
        summary: summarizeRun(current.chunks, current.startedAt, completedAt),
        updatedAt: completedAt,
      };
    });
    logger.info(
      {
        runId,
        status: finished?.status ?? "missing",
        error: finished?.error ?? null,
        summary: finished?.summary ?? null,
      },
      "xhs-ops: run finished",
    );
  }
}
