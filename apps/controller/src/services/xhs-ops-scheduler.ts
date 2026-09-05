import type {
  XhsOpsPlanSuggestion,
  XhsOpsProject,
  XhsOpsRun,
  XhsOpsRunCreate,
} from "@nexu/shared";
import { logger } from "../lib/logger.js";
import type { XhsOpsStore } from "../store/xhs-ops-store.js";
import { XhsOpsError, localDateString } from "./xhs-ops-run-service.js";

/**
 * P2-4 每日自动执行的胶水。OpenClaw cron 只能投递 agentTurn、带不了账目，所以
 * controller 自己每分钟看一眼：项目 `schedule.enabled` 且本地时间到了 `time`
 * 且今天还没触发 → 对项目下每个已绑设备的账号 plan-suggest → createRun →
 * startRun。同一手机上的多个 run（多账号 / 多段）由 XhsOpsRunService 的设备
 * 队列串行，这里只管"点火"。`lastTriggeredDate` 先写再派发，进程内再加一把
 * in-flight 锁，避免 tick 重叠或重启后当天重复触发。
 */

export const XHS_OPS_SCHEDULER_INTERVAL_MS = 60_000;

export type XhsOpsSchedulerRunService = {
  suggestPlans(projectId: string): Promise<XhsOpsPlanSuggestion[]>;
  createRun(input: XhsOpsRunCreate): Promise<XhsOpsRun>;
  startRun(runId: string): Promise<XhsOpsRun>;
};

export interface XhsOpsSchedulerDeps {
  store: XhsOpsStore;
  runService: XhsOpsSchedulerRunService;
  now?: () => number;
  intervalMs?: number;
}

export interface XhsOpsScheduleTriggerResult {
  projectId: string;
  date: string;
  /** Suggestions the planner produced (one per remaining account segment). */
  planned: number;
  created: number;
  /** Runs that went straight to `running`. */
  started: number;
  /** Runs parked in a device queue behind another run on the same phone. */
  queued: number;
  /** Human-readable reasons for plans that could not be dispatched. */
  skipped: string[];
  summary: string;
}

export function localClock(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** True when the schedule should fire at `now`: enabled, time reached, not yet fired today. */
export function isScheduleDue(project: XhsOpsProject, now: Date): boolean {
  const schedule = project.schedule;
  if (!schedule?.enabled) return false;
  const today = localDateString(now);
  if (schedule.lastTriggeredDate === today) return false;
  return localClock(now) >= schedule.time;
}

export class XhsOpsScheduler {
  private readonly store: XhsOpsStore;
  private readonly runService: XhsOpsSchedulerRunService;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly inFlight = new Set<string>();

  constructor(deps: XhsOpsSchedulerDeps) {
    this.store = deps.store;
    this.runService = deps.runService;
    this.now = deps.now ?? (() => Date.now());
    this.intervalMs = deps.intervalMs ?? XHS_OPS_SCHEDULER_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "xhs-ops: scheduler tick failed",
        );
      });
    }, this.intervalMs);
    this.timer.unref?.();
    logger.info({ intervalMs: this.intervalMs }, "xhs-ops: scheduler started");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over all projects; fires every schedule that is due. */
  async tick(): Promise<XhsOpsScheduleTriggerResult[]> {
    const now = new Date(this.now());
    const projects = await this.store.listProjects();
    const fired: XhsOpsScheduleTriggerResult[] = [];
    for (const project of projects) {
      if (!isScheduleDue(project, now)) continue;
      try {
        fired.push(
          await this.triggerProject(project.id, { reason: "schedule" }),
        );
      } catch (error: unknown) {
        logger.warn(
          {
            projectId: project.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "xhs-ops: scheduled trigger failed",
        );
      }
    }
    return fired;
  }

  /**
   * Dispatch today's plans for one project now. `reason: "manual"` is the
   * 「立即执行一次」 button and ignores enabled/time, but still records the
   * trigger so the scheduled pass does not run the same day twice.
   */
  async triggerProject(
    projectId: string,
    opts: { reason: "schedule" | "manual" } = { reason: "manual" },
  ): Promise<XhsOpsScheduleTriggerResult> {
    const project = await this.store.getProject(projectId);
    if (!project) throw new XhsOpsError(404, "项目不存在");
    if (this.inFlight.has(projectId)) {
      throw new XhsOpsError(409, "该项目的自动执行正在派发中");
    }
    this.inFlight.add(projectId);
    const date = localDateString(new Date(this.now()));
    try {
      // 先记"今天已触发"，再派发：派发中途崩溃也不会在下一个 tick 重复点火。
      await this.store.updateProject(projectId, {
        schedule: { ...project.schedule, lastTriggeredDate: date },
      });
      const plans = await this.runService.suggestPlans(projectId);
      const result: XhsOpsScheduleTriggerResult = {
        projectId,
        date,
        planned: plans.length,
        created: 0,
        started: 0,
        queued: 0,
        skipped: [],
        summary: "",
      };
      for (const plan of plans) {
        const label = `${plan.accountLabel}${plan.segment && plan.segment.count > 1 ? ` 第${plan.segment.index}/${plan.segment.count}段` : ""}`;
        if (plan.keywords.length === 0) {
          // run plan 要求至少一个关键词（schema min(1)），空兴趣池直接记跳过。
          result.skipped.push(`${label}：兴趣池为空，没有可执行的关键词`);
          continue;
        }
        try {
          const created = await this.runService.createRun({
            projectId,
            accountId: plan.accountId,
            date,
            segment: plan.segment ?? null,
            plan: {
              keywords: plan.keywords,
              homeFeedCount: plan.homeFeedCount,
              dwellSecMin: plan.dwellSecMin,
              dwellSecMax: plan.dwellSecMax,
              interaction: plan.interaction,
            },
          });
          result.created += 1;
          const started = await this.runService.startRun(created.id);
          if (started.status === "running") result.started += 1;
          else result.queued += 1;
        } catch (error: unknown) {
          result.skipped.push(
            `${label}：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      result.summary =
        plans.length === 0
          ? "没有可执行的计划（无已绑定手机的账号，或今日各段已执行）"
          : `${result.started} 个开始、${result.queued} 个排队${result.skipped.length > 0 ? `、${result.skipped.length} 个未派发` : ""}`;
      await this.store.updateProject(projectId, {
        schedule: {
          ...project.schedule,
          lastTriggeredDate: date,
          lastResult:
            `${date} ${localClock(new Date(this.now()))} ${opts.reason === "manual" ? "手动" : "定时"}：${result.summary}${result.skipped.length > 0 ? `（${result.skipped.join("；")}）` : ""}`.slice(
              0,
              500,
            ),
        },
      });
      logger.info(
        { reason: opts.reason, ...result, skipped: result.skipped.length },
        "xhs-ops: daily schedule triggered",
      );
      return result;
    } finally {
      this.inFlight.delete(projectId);
    }
  }
}
