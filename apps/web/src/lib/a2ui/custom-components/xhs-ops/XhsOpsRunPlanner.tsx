import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CustomComponentProps } from "../registry";
import { describeXhsOpsError, xhsOpsApi } from "./xhs-ops-api";
import { localDateString } from "./xhs-ops-dashboard-data";
import {
  type XhsOpsAccount,
  type XhsOpsInteractionConfig,
  type XhsOpsInteractionRule,
  type XhsOpsRun,
  type XhsOpsRunChunk,
  type XhsOpsRunKeyword,
  type XhsOpsRunSegment,
  type XhsOpsSchedule,
  asInt,
  asString,
  defaultBrowseDefaults,
  defaultInteractionConfig,
  emptyInteractionCounts,
  isRunActive,
  isRunQueued,
  normalizeRunSegment,
  normalizeSchedule,
  segmentLabel,
} from "./xhs-ops-types";
import {
  CardShell,
  ErrorLine,
  Field,
  HintLine,
  NumberInput,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  StatusDot,
  anomalyLabel,
  chunkStatusLabel,
  formatClock,
  formatDurationMs,
  inputClass,
  readProp,
  runStatusLabel,
  runStatusTextClass,
  textareaClass,
} from "./xhs-ops-ui";

const POLL_INTERVAL_MS = 3_000;
const RECENT_RUNS_LIMIT = 5;
const FIRED_STORAGE_KEY = "nexu:xhs-ops:run-finished-fired:v1";
const FIRED_STORAGE_CAP = 200;

interface PlanInput {
  accountId: string;
  keywords: XhsOpsRunKeyword[];
  homeFeedCount: number | null;
  /** P2-3 当日多段：第几段/共几段；单 run 为 null。 */
  segment: XhsOpsRunSegment | null;
}

/** One card per (account, segment). */
function planKey(plan: {
  accountId: string;
  segment: XhsOpsRunSegment | null;
}) {
  return `${plan.accountId}#${plan.segment?.index ?? 0}`;
}

function normalizePlans(raw: unknown): PlanInput[] {
  if (!Array.isArray(raw)) return [];
  const plans: PlanInput[] = [];
  for (const item of raw) {
    const p =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const accountId = asString(p.accountId).trim();
    if (!accountId) continue;
    const keywords: XhsOpsRunKeyword[] = Array.isArray(p.keywords)
      ? p.keywords
          .map((k) => {
            if (typeof k === "string") {
              return { keyword: k.trim().slice(0, 40), count: 5 };
            }
            const kw =
              k && typeof k === "object" ? (k as Record<string, unknown>) : {};
            return {
              keyword: asString(kw.keyword).trim().slice(0, 40),
              count: asInt(kw.count, 5, 1, 8),
            };
          })
          .filter((k) => k.keyword.length > 0)
          .slice(0, 8)
      : [];
    plans.push({
      accountId,
      keywords,
      homeFeedCount:
        p.homeFeedCount === undefined || p.homeFeedCount === null
          ? null
          : asInt(p.homeFeedCount, 6, 0, 12),
      segment: normalizeRunSegment(p.segment),
    });
  }
  return plans;
}

// The finished action must reach the agent exactly once per run. The in-memory
// set guards re-renders; sessionStorage guards a remount of the same surface
// (the chat re-renders A2UI cards when history reloads).
function loadFiredRunIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(FIRED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function persistFiredRunId(ids: Set<string>): void {
  try {
    const list = [...ids].slice(-FIRED_STORAGE_CAP);
    sessionStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable — the in-memory guard still holds for this mount.
  }
}

function chunkTitle(chunk: XhsOpsRunChunk): string {
  return chunk.mode === "home"
    ? "首页推荐流"
    : `搜索「${chunk.keyword ?? ""}」`;
}

function sumInteractions(chunks: XhsOpsRunChunk[]) {
  return chunks.reduce(
    (acc, c) => ({
      like: acc.like + (c.interactions?.like ?? 0),
      collect: acc.collect + (c.interactions?.collect ?? 0),
      follow: acc.follow + (c.interactions?.follow ?? 0),
    }),
    emptyInteractionCounts(),
  );
}

function buildFinishedContext(run: XhsOpsRun): Record<string, unknown> {
  const homeChunk = run.chunks.find((c) => c.mode === "home");
  return {
    runId: run.id,
    accountId: run.accountId,
    accountLabel: run.accountLabel,
    status: run.status,
    date: run.date,
    summary: run.summary,
    anomalies: run.chunks.flatMap((c) =>
      (c.anomalies ?? []).map((a) => ({
        type: a.type,
        detail: a.detail,
        mode: c.mode,
        keyword: c.keyword,
      })),
    ),
    keywords: run.chunks
      .filter((c) => c.mode === "search")
      .map((c) => ({
        keyword: c.keyword ?? "",
        count: c.plannedCount,
        browsed: c.browsed,
        status: c.status,
        observation: c.observation,
      })),
    homeFeed: homeChunk
      ? {
          count: homeChunk.plannedCount,
          browsed: homeChunk.browsed,
          status: homeChunk.status,
          observation: homeChunk.observation,
        }
      : null,
    error: run.error,
    agentInstruction:
      "手机任务已由桌面组件执行完毕，不要重新派发。请结合 summary / anomalies / keywords 给出复盘：哪些关键词内容匹配、是否调整兴趣池或关键词、异常如何处理；并询问是否记录运营观察或建立每日自动执行。",
  };
}

/**
 * Step 4: one card per account. Edits the day's keyword plan, dispatches it as
 * a run (POST /runs + POST /runs/{id}/start), polls progress every 3s while
 * the executor owns it, supports cancel, and once finished shows the summary,
 * anomalies and a 运营观察 note (PATCH). Reports `xhs_ops_run_started` and —
 * exactly once per run — `xhs_ops_run_finished`.
 */
export function XhsOpsRunPlanner({
  comp,
  resolve,
  onAction,
}: CustomComponentProps) {
  const projectId = asString(readProp(comp, resolve, "projectId"));
  const rawPlans = readProp(comp, resolve, "plans");
  const plansKey = JSON.stringify(rawPlans ?? []);
  const plans = useMemo(() => normalizePlans(JSON.parse(plansKey)), [plansKey]);

  const [accounts, setAccounts] = useState<Map<string, XhsOpsAccount> | null>(
    null,
  );
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const firedRef = useRef<Set<string> | null>(null);
  if (firedRef.current === null) firedRef.current = loadFiredRunIds();

  // P1-4：agent 只传 projectId 时，由桌面按兴趣池确定性生成今日计划
  // （核心词轮换、避开上轮集合、搜索占比反推首页篇数），并展示生成依据。
  const [autoPlans, setAutoPlans] = useState<PlanInput[] | null>(null);
  const [autoRationale, setAutoRationale] = useState<Map<string, string[]>>(
    () => new Map(),
  );
  const [autoError, setAutoError] = useState<string | null>(null);
  useEffect(() => {
    if (plans.length > 0 || !projectId) return;
    let cancelled = false;
    setAutoPlans(null);
    xhsOpsApi
      .suggestPlans(projectId)
      .then((list) => {
        if (cancelled) return;
        setAutoPlans(
          list.map((p) => ({
            accountId: p.accountId,
            keywords: p.keywords,
            homeFeedCount: p.homeFeedCount,
            segment: normalizeRunSegment(p.segment),
          })),
        );
        setAutoRationale(
          new Map(
            list.map((p) => [
              planKey({
                accountId: p.accountId,
                segment: normalizeRunSegment(p.segment),
              }),
              p.rationale,
            ]),
          ),
        );
        setAutoError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setAutoPlans([]);
        setAutoError(describeXhsOpsError(err, "今日计划建议生成失败"));
      });
    return () => {
      cancelled = true;
    };
  }, [plansKey, projectId, plans.length]);
  const effectivePlans = plans.length > 0 ? plans : (autoPlans ?? []);

  // P2-3 串行分段：第 k 段要等第 k-1 段结束才可开始；默认自动接续。
  const [finishedKeys, setFinishedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [autoChain, setAutoChain] = useState(true);
  const hasSegments = effectivePlans.some(
    (p) => p.segment !== null && p.segment.count > 1,
  );
  const isLocked = (plan: PlanInput) =>
    plan.segment !== null &&
    plan.segment.index > 1 &&
    !finishedKeys.has(
      planKey({
        accountId: plan.accountId,
        segment: { index: plan.segment.index - 1, count: plan.segment.count },
      }),
    );

  useEffect(() => {
    if (!projectId) {
      setAccounts(new Map());
      setAccountsError("缺少 projectId");
      return;
    }
    let cancelled = false;
    xhsOpsApi
      .listAccounts(projectId)
      .then((list) => {
        if (cancelled) return;
        setAccounts(new Map(list.map((a) => [a.id, a])));
        setAccountsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setAccounts(new Map());
        setAccountsError(
          describeXhsOpsError(err, "账号信息加载失败，将使用默认浏览配置"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (plans.length === 0 && autoPlans === null && projectId) {
    return (
      <CardShell testId="run-planner" title="今日浏览计划">
        <HintLine>正在按各账号兴趣池生成今日计划…</HintLine>
      </CardShell>
    );
  }

  if (effectivePlans.length === 0) {
    return (
      <CardShell testId="run-planner" title="今日浏览计划">
        <ErrorLine
          message={
            autoError ??
            "没有可执行的计划：项目下没有已绑定手机的账号、plans 缺少 accountId，或今日各段已全部执行（复盘请打开看板）"
          }
        />
      </CardShell>
    );
  }

  if (accounts === null) {
    return (
      <CardShell testId="run-planner" title="今日浏览计划">
        <HintLine>正在加载账号信息…</HintLine>
      </CardShell>
    );
  }

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-3">
      {accountsError ? <ErrorLine message={accountsError} /> : null}
      <ScheduleBar projectId={projectId} />
      {hasSegments ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-1.5 text-[12px]">
          <span className="text-text-secondary">
            当日多段：同一账号的各段串行执行，上一段结束后才能开始下一段
          </span>
          <div className="flex items-center gap-2 text-text-primary">
            <span>自动接续下一段</span>
            <Switch
              checked={autoChain}
              onCheckedChange={setAutoChain}
              aria-label="自动接续下一段"
            />
          </div>
        </div>
      ) : null}
      {effectivePlans.map((plan) => {
        const key = planKey(plan);
        return (
          <div key={key} className="flex flex-col gap-1">
            {autoRationale.get(key)?.length ? (
              <HintLine>
                桌面生成依据：{autoRationale.get(key)?.join("；")}
              </HintLine>
            ) : null}
            <RunPlanCard
              projectId={projectId}
              plan={plan}
              account={accounts.get(plan.accountId)}
              onAction={onAction}
              firedRef={firedRef as MutableRefObject<Set<string>>}
              locked={isLocked(plan)}
              autoStart={autoChain}
              onFinished={() =>
                setFinishedKeys((prev) => {
                  if (prev.has(key)) return prev;
                  const next = new Set(prev);
                  next.add(key);
                  return next;
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * P2-4 每日自动执行：开关 + 本地时间，存在项目上，由桌面 controller 的调度器
 * 每分钟检查点火（同一手机上的多个 run 走设备队列串行）。保存时回传完整
 * schedule（含 lastTriggeredDate），否则服务端默认值会把"今天已触发"抹掉。
 */
function ScheduleBar({ projectId }: { projectId: string }) {
  const [schedule, setSchedule] = useState<XhsOpsSchedule | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    xhsOpsApi
      .getProject(projectId)
      .then((p) => {
        if (!cancelled) setSchedule(normalizeSchedule(p.schedule));
      })
      .catch(() => {
        if (!cancelled) setSchedule(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  if (!schedule) return null;

  const save = async (next: XhsOpsSchedule) => {
    setSchedule(next);
    setState("saving");
    setError(null);
    try {
      const p = await xhsOpsApi.updateProject(projectId, { schedule: next });
      setSchedule(normalizeSchedule(p.schedule));
      setState("saved");
    } catch (err) {
      setState("error");
      setError(describeXhsOpsError(err, "自动执行设置保存失败"));
    }
  };

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2/40 px-3 py-1.5 text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-text-primary">
          <Switch
            checked={schedule.enabled}
            onCheckedChange={(enabled) => void save({ ...schedule, enabled })}
            aria-label="每日自动执行"
            disabled={state === "saving"}
          />
          <span>每日自动执行</span>
          <input
            type="time"
            className={`${inputClass} w-[92px]`}
            value={schedule.time}
            aria-label="自动执行时间"
            disabled={state === "saving"}
            onChange={(e) => {
              const time = e.target.value;
              if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
                void save({ ...schedule, time });
              }
            }}
          />
          <span className="text-text-tertiary">
            到点后桌面自动按各账号兴趣池生成当日计划并派发；同一手机上的账号排队串行
          </span>
        </div>
        <span className="text-[11px] text-text-tertiary">
          {state === "saving" ? "保存中…" : state === "saved" ? "已保存" : ""}
        </span>
      </div>
      {schedule.lastResult ? (
        <div className="text-[11px] text-text-tertiary">
          最近：{schedule.lastResult}
        </div>
      ) : null}
      <ErrorLine message={error} />
    </div>
  );
}

const RULE_LABEL: Record<"like" | "collect" | "follow", string> = {
  like: "点赞",
  collect: "收藏",
  follow: "关注",
};

function validatePlan(
  keywords: XhsOpsRunKeyword[],
  homeFeedCount: number,
  dwellMin: number,
  dwellMax: number,
): string | null {
  if (keywords.length === 0) return "至少填写一个关键词";
  if (keywords.length > 8) return "关键词最多 8 个";
  if (keywords.some((k) => k.keyword.length > 40)) return "关键词不超过 40 字";
  if (keywords.some((k) => k.count < 1 || k.count > 8)) {
    return "每个关键词浏览 1–8 篇";
  }
  if (homeFeedCount < 0 || homeFeedCount > 12) return "首页篇数为 0–12";
  if (dwellMin < 5 || dwellMin > 60) return "最短停留为 5–60 秒";
  if (dwellMax < dwellMin || dwellMax > 120) {
    return "最长停留需不小于最短停留且不超过 120 秒";
  }
  return null;
}

function RunPlanCard({
  projectId,
  plan,
  account,
  onAction,
  firedRef,
  locked = false,
  autoStart = false,
  onFinished,
}: {
  projectId: string;
  plan: PlanInput;
  account: XhsOpsAccount | undefined;
  onAction: CustomComponentProps["onAction"];
  firedRef: MutableRefObject<Set<string>>;
  /** P2-3：上一段还没结束，本段不可开始。 */
  locked?: boolean;
  /** P2-3：解锁瞬间自动派发（仅对分段计划生效）。 */
  autoStart?: boolean;
  onFinished?: () => void;
}) {
  const accountId = plan.accountId;
  const segment = plan.segment;
  const browse = account?.browseDefaults ?? defaultBrowseDefaults();

  // ── Plan editing ──
  const [keywords, setKeywords] = useState<XhsOpsRunKeyword[]>(() =>
    plan.keywords.length > 0
      ? plan.keywords
      : [{ keyword: "", count: browse.postsPerKeyword }],
  );
  const [homeFeedCount, setHomeFeedCount] = useState<number>(
    plan.homeFeedCount ?? browse.homeFeedCount,
  );
  const [dwellMin, setDwellMin] = useState<number>(browse.dwellSecMin);
  const [dwellMax, setDwellMax] = useState<number>(browse.dwellSecMax);
  const [interaction, setInteraction] = useState<XhsOpsInteractionConfig>(
    () => account?.interaction ?? defaultInteractionConfig(),
  );
  const [interactionOpen, setInteractionOpen] = useState(false);

  // ── Run state ──
  const [run, setRun] = useState<XhsOpsRun | null>(null);
  const [pendingRun, setPendingRun] = useState<XhsOpsRun | null>(null);
  const [busy, setBusy] = useState<"idle" | "starting" | "cancelling">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [notesState, setNotesState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [recent, setRecent] = useState<XhsOpsRun[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  /** Runs this card started or adopted while active — only these may fire finished. */
  const trackedRef = useRef<Set<string>>(new Set());
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const refreshRecent = useCallback(async (): Promise<XhsOpsRun[] | null> => {
    if (!projectId) return null;
    try {
      const runs = await xhsOpsApi.listRuns({ projectId, accountId });
      setRecent(runs.slice(0, RECENT_RUNS_LIMIT));
      return runs;
    } catch {
      return null;
    }
  }, [projectId, accountId]);

  // On mount: load history; if the newest run is still active (page reload
  // mid-run, or the agent re-rendered the planner), adopt it and keep polling.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const runs = await refreshRecent();
      if (cancelled || !runs) return;
      // 分段卡只认今天同段序的 run，否则两张卡会抢同一个 run。
      const mine = segment
        ? runs.filter(
            (r) =>
              r.date === localDateString(new Date()) &&
              r.segment?.index === segment.index &&
              r.segment?.count === segment.count,
          )
        : runs;
      const active = mine.find((r) => isRunActive(r.status));
      if (active) {
        trackedRef.current.add(active.id);
        setRun(active);
        setNotes(active.notes ?? "");
        return;
      }
      if (segment) {
        const done = mine.find((r) => r.status !== "cancelled");
        if (done) {
          setRun(done);
          setNotes(done.notes ?? "");
          onFinishedRef.current?.();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshRecent, segment]);

  // Poll while the executor owns the run.
  const runId = run?.id ?? null;
  const runActive = run ? isRunActive(run.status) : false;
  useEffect(() => {
    if (!runId || !runActive) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await xhsOpsApi.getRun(runId);
        if (cancelled) return;
        setRun(next);
        setPollError(null);
      } catch (err) {
        if (cancelled) return;
        setPollError(describeXhsOpsError(err, "读取运行状态失败，继续重试…"));
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, runActive]);

  // Terminal transition → report once.
  useEffect(() => {
    if (!run || isRunActive(run.status)) return;
    if (!trackedRef.current.has(run.id)) return;
    if (firedRef.current.has(run.id)) return;
    firedRef.current.add(run.id);
    persistFiredRunId(firedRef.current);
    onAction?.("xhs_ops_run_finished", {
      ...buildFinishedContext(run),
      segment: run.segment,
    });
    onFinishedRef.current?.();
    void refreshRecent();
  }, [run, onAction, firedRef, refreshRecent]);

  const cleanKeywords = keywords
    .map((k) => ({ keyword: k.keyword.trim(), count: k.count }))
    .filter((k) => k.keyword.length > 0);

  const start = async () => {
    const validation = validatePlan(
      cleanKeywords,
      homeFeedCount,
      dwellMin,
      dwellMax,
    );
    if (validation) {
      setError(validation);
      return;
    }
    if (!projectId) {
      setError("缺少 projectId");
      return;
    }
    if (account && !account.deviceId) {
      setError("该账号未绑定设备，请先在账号配置中选择执行设备");
      return;
    }
    setBusy("starting");
    setError(null);
    try {
      let created = pendingRun;
      if (!created) {
        created = await xhsOpsApi.createRun({
          projectId,
          accountId,
          segment,
          plan: {
            keywords: cleanKeywords,
            homeFeedCount,
            dwellSecMin: dwellMin,
            dwellSecMax: dwellMax,
            interaction: { ...interaction, comment: { enabled: false } },
          },
        });
        setPendingRun(created);
      }
      const started = await xhsOpsApi.startRun(created.id);
      setPendingRun(null);
      trackedRef.current.add(started.id);
      setRun(started);
      setNotes(started.notes ?? "");
      setNotesState("idle");
      onAction?.("xhs_ops_run_started", {
        runId: started.id,
        accountId,
        agentInstruction:
          "任务已由桌面组件派发到手机并自动轮询进度，不要调用 device_execute_task / device_dispatch_tasks 重复派发，也不要轮询设备；等待 xhs_ops_run_finished 再复盘。",
      });
    } catch (err) {
      setError(
        pendingRun
          ? `计划已创建但启动失败：${describeXhsOpsError(err, "启动失败")}（再点一次「开始执行」重试启动）`
          : describeXhsOpsError(err, "启动失败"),
      );
    } finally {
      setBusy("idle");
    }
  };

  const cancel = async () => {
    if (!run) return;
    setBusy("cancelling");
    setError(null);
    try {
      const next = await xhsOpsApi.cancelRun(run.id);
      setRun(next);
    } catch (err) {
      setError(describeXhsOpsError(err, "取消失败"));
    } finally {
      setBusy("idle");
    }
  };

  const saveNotes = async () => {
    if (!run) return;
    setNotesState("saving");
    setError(null);
    try {
      const next = await xhsOpsApi.updateRunNotes(run.id, notes.trim());
      setRun((prev) =>
        prev && prev.id === next.id ? { ...prev, notes: next.notes } : prev,
      );
      setNotesState("saved");
      void refreshRecent();
    } catch (err) {
      setNotesState("idle");
      setError(describeXhsOpsError(err, "运营观察保存失败"));
    }
  };

  const resetToPlanning = () => {
    setRun(null);
    setPendingRun(null);
    setError(null);
    setPollError(null);
    setNotes("");
    setNotesState("idle");
  };

  const patchRule = (
    name: "like" | "collect" | "follow",
    patch: Partial<XhsOpsInteractionRule>,
  ) =>
    setInteraction((cfg) => ({
      ...cfg,
      [name]: { ...cfg[name], ...patch },
    }));

  const title = account?.label ?? `账号 ${accountId}`;
  const deviceText = account
    ? account.deviceName || account.deviceId || "未绑定设备"
    : "账号信息不可用";
  const subtitle = [
    `设备：${deviceText}`,
    account?.positioning ? account.positioning : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const editing = !run;
  const finished = run ? !isRunActive(run.status) : false;
  const liveInteractions = run ? sumInteractions(run.chunks) : null;
  const liveBrowsed = run
    ? run.chunks.reduce((n, c) => n + (c.browsed ?? 0), 0)
    : 0;
  const plannedTotal = run
    ? run.chunks.reduce((n, c) => n + (c.plannedCount ?? 0), 0)
    : cleanKeywords.reduce((n, k) => n + k.count, 0) + homeFeedCount;
  const canStart =
    busy === "idle" &&
    (!account || Boolean(account.deviceId)) &&
    editing &&
    !locked;

  // P2-3 自动接续：本段在本次挂载期间从"锁定"变为"可开始"且尚未派发 → 自动开始。
  const startRef = useRef(start);
  startRef.current = start;
  const wasLockedRef = useRef(locked);
  useEffect(() => {
    if (!segment || !autoStart) {
      wasLockedRef.current = locked;
      return;
    }
    if (locked) {
      wasLockedRef.current = true;
      return;
    }
    if (wasLockedRef.current && !run && !pendingRun && busy === "idle") {
      wasLockedRef.current = false;
      void startRef.current();
    }
  }, [locked, autoStart, segment, run, pendingRun, busy]);

  return (
    <CardShell
      testId="run-plan-card"
      title={`今日浏览计划 · ${title}${segment && segment.count > 1 ? ` · ${segmentLabel(segment)}` : ""}`}
      subtitle={subtitle}
      actions={
        run ? (
          <span
            className={`text-[12px] font-medium ${runStatusTextClass(run.status)}`}
          >
            {isRunQueued(run) ? "排队中" : runStatusLabel(run.status)}
          </span>
        ) : null
      }
      footer={
        <>
          <div className="min-w-0 text-[11px] text-text-tertiary">
            {editing
              ? `共 ${plannedTotal} 篇 · 关键词 ${cleanKeywords.length} 个 · 首页 ${homeFeedCount} 篇${locked && segment ? ` · 等待第 ${segment.index - 1} 段结束后${autoStart ? "自动开始" : "可开始"}` : ""}`
              : run && isRunQueued(run)
                ? "排队中：同一手机上还有任务在执行，结束后自动开始"
                : run && runActive
                  ? `已浏览 ${liveBrowsed}/${plannedTotal} · 赞 ${liveInteractions?.like ?? 0} 藏 ${liveInteractions?.collect ?? 0} 关 ${liveInteractions?.follow ?? 0}${run.startedAt ? ` · ${formatClock(run.startedAt)} 开始` : ""}`
                  : run
                    ? `${runStatusLabel(run.status)}${run.completedAt ? ` · ${formatClock(run.completedAt)}` : ""} · 用时 ${formatDurationMs(run.summary?.durationMs)}`
                    : ""}
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <PrimaryButton
                onClick={() => void start()}
                disabled={!canStart}
                title={
                  account && !account.deviceId
                    ? "该账号未绑定设备"
                    : locked
                      ? "上一段尚未结束"
                      : undefined
                }
              >
                {busy === "starting"
                  ? "派发中…"
                  : locked
                    ? "等待上一段"
                    : "开始执行"}
              </PrimaryButton>
            ) : null}
            {run && runActive ? (
              <SecondaryButton
                onClick={() => void cancel()}
                disabled={busy !== "idle"}
                danger
              >
                {busy === "cancelling" ? "取消中…" : "取消"}
              </SecondaryButton>
            ) : null}
            {finished ? (
              <SecondaryButton onClick={resetToPlanning}>
                重新计划
              </SecondaryButton>
            ) : null}
          </div>
        </>
      }
    >
      <ErrorLine message={error} />
      {account && !account.deviceId ? (
        <ErrorLine message="该账号未绑定设备，无法执行。请先在账号配置中选择执行设备。" />
      ) : null}

      {editing ? (
        <>
          <div className="flex flex-col gap-1.5">
            <SectionTitle hint="每个关键词浏览 1–8 篇，最多 8 个关键词">
              搜索关键词
            </SectionTitle>
            <div className="flex flex-col gap-1.5">
              {keywords.map((k, index) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and editable in place
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_72px_28px] items-center gap-2"
                >
                  <input
                    className={inputClass}
                    value={k.keyword}
                    maxLength={40}
                    placeholder="关键词"
                    aria-label={`关键词 ${index + 1}`}
                    onChange={(e) =>
                      setKeywords((list) =>
                        list.map((item, i) =>
                          i === index
                            ? { ...item, keyword: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <NumberInput
                    value={k.count}
                    min={1}
                    max={8}
                    ariaLabel={`关键词 ${index + 1} 篇数`}
                    onChange={(count) =>
                      setKeywords((list) =>
                        list.map((item, i) =>
                          i === index ? { ...item, count } : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label="删除关键词"
                    className="grid h-7 w-7 place-items-center rounded-md border border-border text-text-tertiary hover:text-red-600"
                    disabled={keywords.length <= 1}
                    onClick={() =>
                      setKeywords((list) => list.filter((_, i) => i !== index))
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {keywords.length < 8 ? (
                <div>
                  <SecondaryButton
                    onClick={() =>
                      setKeywords((list) => [
                        ...list,
                        { keyword: "", count: browse.postsPerKeyword },
                      ])
                    }
                  >
                    <Plus size={12} /> 添加关键词
                  </SecondaryButton>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Field label="首页自然浏览（篇）">
              <NumberInput
                value={homeFeedCount}
                min={0}
                max={12}
                onChange={setHomeFeedCount}
              />
            </Field>
            <Field label="单篇最短停留（秒）">
              <NumberInput
                value={dwellMin}
                min={5}
                max={60}
                onChange={(v) => {
                  setDwellMin(v);
                  if (dwellMax < v) setDwellMax(v);
                }}
              />
            </Field>
            <Field label="单篇最长停留（秒）">
              <NumberInput
                value={dwellMax}
                min={5}
                max={120}
                onChange={(v) => setDwellMax(Math.max(v, dwellMin))}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              className="flex items-center gap-1 self-start text-[12px] font-semibold text-text-primary"
              onClick={() => setInteractionOpen((open) => !open)}
            >
              互动配置
              <span className="font-normal text-text-tertiary">
                {(["like", "collect", "follow"] as const)
                  .filter((k) => interaction[k].enabled)
                  .map((k) => `${RULE_LABEL[k]}≤${interaction[k].dailyCap}`)
                  .join(" ") || "全部关闭"}
                {" · 评论关闭"}
              </span>
              {interactionOpen ? (
                <ChevronUp size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </button>
            {interactionOpen ? (
              <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
                {(["like", "collect", "follow"] as const).map((name) => {
                  const rule = interaction[name];
                  return (
                    <div
                      key={name}
                      className="grid grid-cols-[48px_auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-[12px]"
                    >
                      <span>{RULE_LABEL[name]}</span>
                      <Switch
                        size="xs"
                        checked={rule.enabled}
                        aria-label={`${RULE_LABEL[name]}开关`}
                        onCheckedChange={(enabled) =>
                          patchRule(name, { enabled })
                        }
                      />
                      <label className="flex items-center gap-1 text-[11px] text-text-secondary">
                        本次上限
                        <NumberInput
                          value={rule.dailyCap}
                          min={0}
                          max={50}
                          disabled={!rule.enabled}
                          className="w-16"
                          ariaLabel={`${RULE_LABEL[name]}上限`}
                          onChange={(dailyCap) => patchRule(name, { dailyCap })}
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[11px] text-text-secondary">
                        比例 %
                        <NumberInput
                          value={rule.ratioPercent}
                          min={0}
                          max={100}
                          disabled={!rule.enabled}
                          className="w-16"
                          ariaLabel={`${RULE_LABEL[name]}比例`}
                          onChange={(ratioPercent) =>
                            patchRule(name, { ratioPercent })
                          }
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {run ? (
        <div className="flex flex-col gap-1.5">
          <SectionTitle
            hint={
              runActive ? "每 3 秒刷新；手机按顺序逐个关键词执行" : undefined
            }
          >
            执行进度
          </SectionTitle>
          {pollError ? <HintLine>{pollError}</HintLine> : null}
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {run.chunks.map((chunk) => (
              <div
                key={chunk.index}
                className="flex flex-col gap-0.5 px-2.5 py-1.5 text-[12px]"
              >
                <div className="flex items-center gap-2">
                  <StatusDot
                    status={chunk.status}
                    title={chunkStatusLabel(chunk.status)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {chunkTitle(chunk)}
                  </span>
                  <span className="shrink-0 text-text-secondary">
                    {chunk.browsed}/{chunk.plannedCount} 篇
                  </span>
                  <span className="shrink-0 text-text-tertiary">
                    赞 {chunk.interactions?.like ?? 0} 藏{" "}
                    {chunk.interactions?.collect ?? 0} 关{" "}
                    {chunk.interactions?.follow ?? 0}
                  </span>
                  {(chunk.anomalies?.length ?? 0) > 0 ? (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[11px] text-amber-700">
                      异常 {chunk.anomalies.length}
                    </span>
                  ) : null}
                  <span className="w-10 shrink-0 text-right text-[11px] text-text-tertiary">
                    {chunkStatusLabel(chunk.status)}
                  </span>
                </div>
                {chunk.error ? (
                  <div className="pl-4 text-[11px] text-red-600">
                    {chunk.error}
                  </div>
                ) : null}
              </div>
            ))}
            {run.chunks.length === 0 ? (
              <div className="px-2.5 py-2 text-[12px] text-text-tertiary">
                等待执行器生成任务块…
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {run && finished ? (
        <RunResult
          run={run}
          notes={notes}
          notesState={notesState}
          onNotesChange={(v) => {
            setNotes(v);
            setNotesState("idle");
          }}
          onSaveNotes={() => void saveNotes()}
        />
      ) : null}

      {recent.length > 0 ? (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="flex items-center gap-1 self-start text-[11px] text-text-tertiary hover:text-text-primary"
            onClick={() => setRecentOpen((open) => !open)}
          >
            最近 {recent.length} 次运行
            {recentOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {recentOpen ? (
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {recent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]"
                >
                  <span className="w-20 shrink-0 text-text-secondary">
                    {r.date}
                  </span>
                  <span
                    className={`w-12 shrink-0 ${runStatusTextClass(r.status)}`}
                  >
                    {runStatusLabel(r.status)}
                  </span>
                  <span className="shrink-0 text-text-secondary">
                    {r.summary?.browsedTotal ?? 0}/
                    {r.summary?.plannedTotal ?? 0} 篇
                  </span>
                  <span className="shrink-0 text-text-tertiary">
                    赞 {r.summary?.interactions?.like ?? 0} 藏{" "}
                    {r.summary?.interactions?.collect ?? 0} 关{" "}
                    {r.summary?.interactions?.follow ?? 0}
                  </span>
                  <span className="shrink-0 text-text-tertiary">
                    异常 {r.summary?.anomalyCount ?? 0}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text-tertiary">
                    {r.notes}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </CardShell>
  );
}

function RunResult({
  run,
  notes,
  notesState,
  onNotesChange,
  onSaveNotes,
}: {
  run: XhsOpsRun;
  notes: string;
  notesState: "idle" | "saving" | "saved";
  onNotesChange: (value: string) => void;
  onSaveNotes: () => void;
}) {
  const summary = run.summary;
  const anomalies = run.chunks.flatMap((c) =>
    (c.anomalies ?? []).map((a) => ({ chunk: chunkTitle(c), ...a })),
  );
  const observations = run.chunks
    .filter((c) => c.observation?.trim())
    .map((c) => ({ chunk: chunkTitle(c), text: c.observation as string }));

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <SectionTitle>结果汇总</SectionTitle>
      {run.error ? <ErrorLine message={run.error} /> : null}
      <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
        <Stat
          label="计划 / 实际"
          value={`${summary?.plannedTotal ?? 0} / ${summary?.browsedTotal ?? 0}`}
        />
        <Stat
          label="搜索 / 首页"
          value={`${summary?.searchBrowsed ?? 0} / ${summary?.homeBrowsed ?? 0}`}
        />
        <Stat
          label="赞 / 藏 / 关"
          value={`${summary?.interactions?.like ?? 0} / ${summary?.interactions?.collect ?? 0} / ${summary?.interactions?.follow ?? 0}`}
        />
        <Stat
          label="异常"
          value={String(summary?.anomalyCount ?? anomalies.length)}
        />
      </div>

      {anomalies.length > 0 ? (
        <div className="flex flex-col gap-1">
          <SectionTitle>异常</SectionTitle>
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {anomalies.map((a, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: display-only list
                key={i}
                className="flex items-start gap-2"
              >
                <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[11px] text-amber-700">
                  {anomalyLabel(a.type)}
                </span>
                <span className="min-w-0 text-text-secondary">
                  {a.chunk}
                  {a.detail ? ` · ${a.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {observations.length > 0 ? (
        <div className="flex flex-col gap-1">
          <SectionTitle>手机端观察</SectionTitle>
          <ul className="flex flex-col gap-0.5 text-[12px] text-text-secondary">
            {observations.map((o) => (
              <li key={o.chunk}>
                <span className="text-text-primary">{o.chunk}</span> · {o.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <SectionTitle hint="人工记录本次运行的判断，保存到运行记录">
          运营观察
        </SectionTitle>
        <textarea
          className={textareaClass}
          rows={2}
          value={notes}
          placeholder="如：亲子酒店关键词内容匹配度高，下次加「室内乐园」"
          onChange={(e) => onNotesChange(e.target.value)}
        />
        <div className="flex items-center justify-end gap-2">
          {notesState === "saved" ? (
            <span className="text-[11px] text-text-tertiary">已保存</span>
          ) : null}
          <SecondaryButton
            onClick={onSaveNotes}
            disabled={notesState === "saving"}
          >
            {notesState === "saving" ? "保存中…" : "保存观察"}
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-2/60 px-2 py-1.5">
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className="text-[13px] font-medium text-text-primary">{value}</div>
    </div>
  );
}
