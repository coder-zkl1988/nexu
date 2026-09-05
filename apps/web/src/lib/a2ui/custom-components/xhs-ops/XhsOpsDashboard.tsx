import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomComponentProps } from "../registry";
import { describeXhsOpsError, xhsOpsApi } from "./xhs-ops-api";
import {
  DASHBOARD_DAY_OPTIONS,
  DASHBOARD_MAX_DAYS,
  type DashboardCell,
  type DashboardRow,
  KEYWORD_VERDICT_LABEL,
  type KeywordStat,
  type ObservationEntry,
  buildRunMatrix,
  chunkTitle,
  collectObservations,
  keywordStats,
  lastNDates,
  shortDate,
  sumTotals,
  summarizeAnomalies,
} from "./xhs-ops-dashboard-data";
import {
  type XhsOpsAccount,
  type XhsOpsProject,
  type XhsOpsRun,
  asInt,
  asString,
  isRunActive,
  segmentLabel,
} from "./xhs-ops-types";
import {
  CardShell,
  ErrorLine,
  HintLine,
  SecondaryButton,
  SectionTitle,
  StatusDot,
  anomalyLabel,
  chunkStatusLabel,
  formatClock,
  formatDurationMs,
  readProp,
  runStatusLabel,
  runStatusTextClass,
  textareaClass,
} from "./xhs-ops-ui";

const ACTIVE_POLL_MS = 5_000;
const OBSERVATION_PREVIEW = 8;

/**
 * P2-2 复盘看板：只读地把一个项目在最近 N 天的运行记录摊开成
 * 「账号 × 日期」矩阵 + 关键词表现 + 异常汇总 + 观察时间线，让运营不看聊天
 * 记录就能判断推荐流是否在靠近目标兴趣、该不该改兴趣池。唯一的写操作是给
 * 选中的运行补「运营备注」（PATCH notes），保存后上报
 * `xhs_ops_dashboard_note_saved`。数据全部来自 GET /runs，不派发任何任务。
 */
export function XhsOpsDashboard({
  comp,
  resolve,
  onAction,
}: CustomComponentProps) {
  const propProjectId = asString(readProp(comp, resolve, "projectId"));
  const projectName = asString(readProp(comp, resolve, "projectName")).trim();
  const onlyAccountId = asString(readProp(comp, resolve, "accountId")) || null;
  const initialDays = asInt(
    readProp(comp, resolve, "days"),
    7,
    1,
    DASHBOARD_MAX_DAYS,
  );

  // Agent 在新会话里通常拿不到 projectId（没有列项目的工具），所以 projectId
  // 可省略：按 projectName 匹配，匹配不到就让用户在卡片里点选项目。
  const [projectId, setProjectId] = useState(propProjectId);
  const [projectChoices, setProjectChoices] = useState<XhsOpsProject[] | null>(
    propProjectId ? [] : null,
  );
  const [pickerError, setPickerError] = useState<string | null>(null);
  useEffect(() => {
    if (propProjectId) return;
    let cancelled = false;
    xhsOpsApi
      .listProjects()
      .then((list) => {
        if (cancelled) return;
        const match = pickProjectByName(list, projectName);
        if (match) setProjectId(match.id);
        setProjectChoices(list);
        setPickerError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setProjectChoices([]);
        setPickerError(describeXhsOpsError(err, "项目列表加载失败"));
      });
    return () => {
      cancelled = true;
    };
  }, [propProjectId, projectName]);

  const [days, setDays] = useState(initialDays);
  const [project, setProject] = useState<XhsOpsProject | null>(null);
  const [accounts, setAccounts] = useState<XhsOpsAccount[] | null>(null);
  const [runs, setRuns] = useState<XhsOpsRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    accountId: string;
    date: string;
  } | null>(null);
  const [showAllObservations, setShowAllObservations] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setAccounts(null);
      setRuns(null);
      return;
    }
    try {
      const [p, a, r] = await Promise.all([
        xhsOpsApi.getProject(projectId).catch(() => null),
        xhsOpsApi.listAccounts(projectId),
        xhsOpsApi.listRuns({ projectId }),
      ]);
      setProject(p);
      setAccounts(onlyAccountId ? a.filter((x) => x.id === onlyAccountId) : a);
      setRuns(
        onlyAccountId ? r.filter((x) => x.accountId === onlyAccountId) : r,
      );
      setLoadError(null);
    } catch (err) {
      setAccounts((prev) => prev ?? []);
      setRuns((prev) => prev ?? []);
      setLoadError(describeXhsOpsError(err, "运行记录加载失败"));
    }
  }, [projectId, onlyAccountId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 有执行中的 run 时轻量轮询，让看板跟着当日进度走。
  const hasActive = (runs ?? []).some((r) => isRunActive(r.status));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void load(), ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  const dates = useMemo(() => lastNDates(days), [days]);
  const runsInRange = useMemo(() => {
    const set = new Set(dates);
    return (runs ?? []).filter((r) => set.has(r.date));
  }, [runs, dates]);
  const rows = useMemo(
    () => buildRunMatrix(accounts ?? [], runs ?? [], dates),
    [accounts, runs, dates],
  );
  const totals = useMemo(() => sumTotals(rows), [rows]);
  const anomalies = useMemo(
    () => summarizeAnomalies(runsInRange),
    [runsInRange],
  );
  const observations = useMemo(
    () => collectObservations(runsInRange),
    [runsInRange],
  );
  const { keywords, home } = useMemo(
    () => keywordStats(runsInRange, accounts ?? []),
    [runsInRange, accounts],
  );

  const selectedCell: DashboardCell | null = useMemo(() => {
    if (!selected) return null;
    const row = rows.find((r) => r.accountId === selected.accountId);
    return row?.cells.find((c) => c.date === selected.date) ?? null;
  }, [rows, selected]);

  const replaceRun = (next: XhsOpsRun) =>
    setRuns((prev) =>
      prev ? prev.map((r) => (r.id === next.id ? next : r)) : prev,
    );

  const loading = accounts === null || runs === null;
  const rangeLabel = `${shortDate(dates[0] ?? "")} ~ ${shortDate(dates[dates.length - 1] ?? "")}`;

  return (
    <CardShell
      testId="dashboard"
      title="养号复盘看板"
      subtitle={
        project
          ? `${project.name} · 最近 ${days} 天（${rangeLabel}）`
          : `最近 ${days} 天（${rangeLabel}）`
      }
      actions={
        <div className="flex items-center gap-1">
          {DASHBOARD_DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`h-6 rounded-md border px-2 text-[11px] ${
                days === d
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-text-primary"
                  : "border-border text-text-secondary hover:bg-surface-2"
              }`}
            >
              {d} 天
            </button>
          ))}
        </div>
      }
    >
      <ErrorLine message={loadError ?? pickerError} />
      {!projectId ? (
        <ProjectPicker
          choices={projectChoices}
          wanted={projectName}
          onPick={(id) => {
            setProjectId(id);
            setSelected(null);
          }}
        />
      ) : loading ? (
        <HintLine>正在加载运行记录…</HintLine>
      ) : null}

      {projectId && !loading ? (
        <>
          <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-5">
            <Stat label="运行次数" value={String(totals.runs)} />
            <Stat
              label="计划 / 实际"
              value={`${totals.planned} / ${totals.browsed}`}
            />
            <Stat label="首页推荐" value={String(totals.home)} />
            <Stat
              label="互动（赞+藏+关）"
              value={String(totals.interactions)}
            />
            <Stat
              label="异常"
              value={String(totals.anomalies)}
              tone={totals.anomalies > 0 ? "warn" : undefined}
            />
          </div>

          <div className="flex flex-col gap-1">
            <SectionTitle hint="每格 = 实际/计划 浏览篇数；点格子看当日明细并补运营备注">
              账号 × 日期
            </SectionTitle>
            {rows.length === 0 ? (
              <HintLine>
                {runsInRange.length === 0
                  ? "所选范围内没有运行记录；先在「今日浏览计划」里执行一次。"
                  : "没有可展示的账号。"}
              </HintLine>
            ) : (
              <MatrixTable
                rows={rows}
                dates={dates}
                selected={selected}
                onSelect={(accountId, date) =>
                  setSelected((prev) =>
                    prev && prev.accountId === accountId && prev.date === date
                      ? null
                      : { accountId, date },
                  )
                }
              />
            )}
          </div>

          {selectedCell && selected ? (
            <CellDetail
              accountLabel={
                rows.find((r) => r.accountId === selected.accountId)?.label ??
                selected.accountId
              }
              cell={selectedCell}
              onRunChange={replaceRun}
              onAction={onAction}
            />
          ) : null}

          <KeywordTable keywords={keywords} home={home} />

          {anomalies.length > 0 ? (
            <div className="flex flex-col gap-1">
              <SectionTitle hint="按类型汇总，附最近一次出现的位置">
                异常汇总
              </SectionTitle>
              <ul className="flex flex-col gap-0.5 text-[12px]">
                {anomalies.map((a) => (
                  <li key={a.type} className="flex items-start gap-2">
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[11px] text-amber-700">
                      {anomalyLabel(a.type)} × {a.count}
                    </span>
                    {a.latest ? (
                      <span className="min-w-0 text-text-secondary">
                        最近 {shortDate(a.latest.date)} ·{" "}
                        {a.latest.accountLabel} · {a.latest.chunk}
                        {a.latest.detail ? ` · ${a.latest.detail}` : ""}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ObservationTimeline
            entries={observations}
            showAll={showAllObservations}
            onToggle={() => setShowAllObservations((v) => !v)}
          />
        </>
      ) : null}
    </CardShell>
  );
}

// ── Project picker ────────────────────────────────────────────

/** Exact name first, then unique substring match (either direction). */
export function pickProjectByName(
  projects: XhsOpsProject[],
  wanted: string,
): XhsOpsProject | null {
  const name = wanted.trim();
  if (!name) return projects.length === 1 ? (projects[0] ?? null) : null;
  const exact = projects.find((p) => p.name.trim() === name);
  if (exact) return exact;
  const loose = projects.filter(
    (p) => p.name.includes(name) || name.includes(p.name.trim()),
  );
  return loose.length === 1 ? (loose[0] ?? null) : null;
}

function ProjectPicker({
  choices,
  wanted,
  onPick,
}: {
  choices: XhsOpsProject[] | null;
  wanted: string;
  onPick: (projectId: string) => void;
}) {
  if (choices === null) return <HintLine>正在加载项目列表…</HintLine>;
  if (choices.length === 0) {
    return (
      <HintLine>还没有养号项目；先用「养号项目」表单创建一个再复盘。</HintLine>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <SectionTitle
        hint={
          wanted
            ? `没有找到名为「${wanted}」的项目，请选择要复盘的项目`
            : "请选择要复盘的项目"
        }
      >
        选择项目
      </SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((p) => (
          <SecondaryButton key={p.id} onClick={() => onPick(p.id)}>
            {p.name}
          </SecondaryButton>
        ))}
      </div>
    </div>
  );
}

// ── Matrix ────────────────────────────────────────────────────

function MatrixTable({
  rows,
  dates,
  selected,
  onSelect,
}: {
  rows: DashboardRow[];
  dates: string[];
  selected: { accountId: string; date: string } | null;
  onSelect: (accountId: string, date: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-max border-collapse text-[11px]">
        <thead>
          <tr className="bg-surface-2/60 text-text-tertiary">
            <th className="sticky left-0 z-10 bg-surface-2/95 px-2 py-1 text-left font-medium">
              账号
            </th>
            {dates.map((d) => (
              <th key={d} className="px-1.5 py-1 text-center font-medium">
                {shortDate(d)}
              </th>
            ))}
            <th className="px-2 py-1 text-right font-medium">合计</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.accountId} className="border-t border-border">
              <td className="sticky left-0 z-10 max-w-[160px] bg-surface-1 px-2 py-1">
                <div className="truncate text-text-primary" title={row.label}>
                  {row.label}
                </div>
                <div className="text-[10px] text-text-tertiary">
                  {!row.exists ? "已删除" : row.bound ? "已绑定" : "未绑定"}
                </div>
              </td>
              {row.cells.map((cell) => {
                const isSel =
                  selected?.accountId === row.accountId &&
                  selected?.date === cell.date;
                const empty = cell.runs.length === 0;
                return (
                  <td key={cell.date} className="px-0.5 py-0.5 text-center">
                    <button
                      type="button"
                      disabled={empty}
                      onClick={() => onSelect(row.accountId, cell.date)}
                      title={
                        empty
                          ? "无运行"
                          : `${cell.runs.length} 次运行 · 首页 ${cell.home} · 互动 ${cell.interactions} · 异常 ${cell.anomalies}`
                      }
                      className={`flex min-w-[52px] flex-col items-center rounded px-1 py-0.5 ${
                        empty
                          ? "text-text-tertiary"
                          : isSel
                            ? "bg-[var(--color-accent)]/15 text-text-primary"
                            : "hover:bg-surface-2 text-text-primary"
                      }`}
                    >
                      {empty ? (
                        <span>—</span>
                      ) : (
                        <>
                          <span className="flex items-center gap-1 font-medium">
                            <StatusDot
                              status={cell.status ?? "pending"}
                              title={
                                cell.status ? runStatusLabel(cell.status) : ""
                              }
                            />
                            {cell.browsed}/{cell.planned}
                          </span>
                          <span className="text-[10px] text-text-tertiary">
                            首{cell.home} 互{cell.interactions}
                            {cell.anomalies > 0 ? (
                              <span className="text-amber-600">
                                {" "}
                                异{cell.anomalies}
                              </span>
                            ) : null}
                          </span>
                        </>
                      )}
                    </button>
                  </td>
                );
              })}
              <td className="px-2 py-1 text-right text-text-secondary">
                <div className="font-medium text-text-primary">
                  {row.totals.browsed}/{row.totals.planned}
                </div>
                <div className="text-[10px] text-text-tertiary">
                  {row.totals.runs} 次 · 互 {row.totals.interactions}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Selected day detail + notes ───────────────────────────────

function CellDetail({
  accountLabel,
  cell,
  onRunChange,
  onAction,
}: {
  accountLabel: string;
  cell: DashboardCell;
  onRunChange: (run: XhsOpsRun) => void;
  onAction?: CustomComponentProps["onAction"];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2/40 p-2">
      <SectionTitle hint={`${accountLabel} · ${cell.date}`}>
        当日明细
      </SectionTitle>
      {cell.runs.map((run) => (
        <RunDetail
          key={run.id}
          run={run}
          onRunChange={onRunChange}
          onAction={onAction}
        />
      ))}
    </div>
  );
}

function RunDetail({
  run,
  onRunChange,
  onAction,
}: {
  run: XhsOpsRun;
  onRunChange: (run: XhsOpsRun) => void;
  onAction?: CustomComponentProps["onAction"];
}) {
  const [notes, setNotes] = useState(run.notes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setNotes(run.notes ?? "");
  }, [run.notes]);

  const save = async () => {
    setState("saving");
    setError(null);
    try {
      const next = await xhsOpsApi.updateRunNotes(run.id, notes.trim());
      onRunChange({ ...run, notes: next.notes });
      setState("saved");
      onAction?.("xhs_ops_dashboard_note_saved", {
        runId: run.id,
        accountLabel: run.accountLabel,
        date: run.date,
        notes: next.notes,
        agentInstruction:
          "运营已在复盘看板为这次运行记录了观察。不要重新派发任务，也不要逐字复述记录；如果观察里提到关键词/兴趣不匹配，给出一两条兴趣池调整建议即可。",
      });
    } catch (err) {
      setState("error");
      setError(describeXhsOpsError(err, "备注保存失败"));
    }
  };

  const chunks = [...(run.chunks ?? [])].sort((a, b) => a.index - b.index);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-1 p-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`font-medium ${runStatusTextClass(run.status)}`}>
          {runStatusLabel(run.status)}
        </span>
        {run.segment && run.segment.count > 1 ? (
          <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-text-secondary">
            {segmentLabel(run.segment)}
          </span>
        ) : null}
        <span className="text-text-tertiary">
          {formatClock(run.startedAt ?? run.createdAt)}
          {run.completedAt ? ` → ${formatClock(run.completedAt)}` : ""} ·{" "}
          {formatDurationMs(run.summary?.durationMs)}
        </span>
        <span className="text-text-tertiary">
          计划 {run.summary?.plannedTotal ?? 0} / 实际{" "}
          {run.summary?.browsedTotal ?? 0} · 赞{" "}
          {run.summary?.interactions?.like ?? 0} 藏{" "}
          {run.summary?.interactions?.collect ?? 0} 关{" "}
          {run.summary?.interactions?.follow ?? 0}
        </span>
      </div>
      {run.error ? <ErrorLine message={run.error} /> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[11px]">
          <thead>
            <tr className="text-text-tertiary">
              <th className="px-1.5 py-0.5 text-left font-medium">环节</th>
              <th className="px-1.5 py-0.5 text-right font-medium">
                实际/计划
              </th>
              <th className="px-1.5 py-0.5 text-right font-medium">跳过</th>
              <th className="px-1.5 py-0.5 text-right font-medium">赞/藏/关</th>
              <th className="px-1.5 py-0.5 text-left font-medium">
                状态 · 异常
              </th>
              <th className="px-1.5 py-0.5 text-left font-medium">
                手机端观察
              </th>
            </tr>
          </thead>
          <tbody>
            {chunks.map((c) => (
              <tr key={c.index} className="border-t border-border/60">
                <td className="px-1.5 py-0.5 text-text-primary">
                  {chunkTitle(c)}
                </td>
                <td className="px-1.5 py-0.5 text-right">
                  {c.browsed}/{c.plannedCount}
                </td>
                <td className="px-1.5 py-0.5 text-right text-text-tertiary">
                  {c.skipped}
                </td>
                <td className="px-1.5 py-0.5 text-right text-text-tertiary">
                  {c.interactions?.like ?? 0}/{c.interactions?.collect ?? 0}/
                  {c.interactions?.follow ?? 0}
                </td>
                <td className="px-1.5 py-0.5">
                  <span className="mr-1 inline-flex items-center gap-1">
                    <StatusDot status={c.status} />
                    {chunkStatusLabel(c.status)}
                  </span>
                  {(c.anomalies ?? []).map((a, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: display-only list
                      key={i}
                      title={a.detail}
                      className="mr-1 rounded-full bg-amber-500/15 px-1.5 text-[10px] text-amber-700"
                    >
                      {anomalyLabel(a.type)}
                    </span>
                  ))}
                </td>
                <td className="max-w-[260px] px-1.5 py-0.5 text-text-secondary">
                  {c.observation?.trim() || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1">
        <SectionTitle hint="人工判断写在这里，保存到这次运行记录">
          运营备注
        </SectionTitle>
        <textarea
          className={textareaClass}
          rows={2}
          value={notes}
          placeholder="如：首页推荐流开始出现亲子酒店，下周核心池加「室内乐园」"
          onChange={(e) => {
            setNotes(e.target.value);
            if (state !== "idle") setState("idle");
          }}
        />
        <ErrorLine message={error} />
        <div className="flex items-center justify-end gap-2">
          {state === "saved" ? (
            <span className="text-[11px] text-text-tertiary">已保存</span>
          ) : null}
          <SecondaryButton onClick={save} disabled={state === "saving"}>
            {state === "saving" ? "保存中…" : "保存备注"}
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}

// ── Keywords ──────────────────────────────────────────────────

function verdictClass(v: KeywordStat["verdict"]): string {
  switch (v) {
    case "adjust":
      return "bg-red-500/10 text-red-600";
    case "watch":
      return "bg-amber-500/15 text-amber-700";
    default:
      return "bg-emerald-500/10 text-emerald-700";
  }
}

function KeywordTable({
  keywords,
  home,
}: {
  keywords: KeywordStat[];
  home: ReturnType<typeof keywordStats>["home"];
}) {
  if (keywords.length === 0 && home.runs === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <SectionTitle hint="按搜索关键词汇总；「建议调整」= 出现过无结果/内容不匹配">
        关键词表现
      </SectionTitle>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-max border-collapse text-[11px]">
          <thead>
            <tr className="bg-surface-2/60 text-text-tertiary">
              <th className="px-2 py-1 text-left font-medium">关键词</th>
              <th className="px-2 py-1 text-left font-medium">核心池账号</th>
              <th className="px-2 py-1 text-right font-medium">次数</th>
              <th className="px-2 py-1 text-right font-medium">实际/计划</th>
              <th className="px-2 py-1 text-right font-medium">互动</th>
              <th className="px-2 py-1 text-right font-medium">异常</th>
              <th className="px-2 py-1 text-left font-medium">判断</th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((k) => (
              <tr key={k.keyword} className="border-t border-border">
                <td className="px-2 py-1 text-text-primary">{k.keyword}</td>
                <td
                  className="max-w-[180px] truncate px-2 py-1 text-text-tertiary"
                  title={k.coreOf.join("、")}
                >
                  {k.coreOf.length > 0 ? k.coreOf.join("、") : "—"}
                </td>
                <td className="px-2 py-1 text-right">{k.runs}</td>
                <td className="px-2 py-1 text-right">
                  {k.browsed}/{k.planned}
                </td>
                <td className="px-2 py-1 text-right">{k.interactions}</td>
                <td
                  className={`px-2 py-1 text-right ${k.anomalies > 0 ? "text-amber-600" : ""}`}
                >
                  {k.anomalies}
                </td>
                <td className="px-2 py-1">
                  <span
                    className={`rounded-full px-1.5 text-[10px] ${verdictClass(k.verdict)}`}
                  >
                    {KEYWORD_VERDICT_LABEL[k.verdict]}
                  </span>
                  <span className="ml-1 text-text-tertiary">{k.hint}</span>
                </td>
              </tr>
            ))}
            {home.runs > 0 ? (
              <tr className="border-t border-border bg-surface-2/30">
                <td className="px-2 py-1 text-text-primary">首页推荐流</td>
                <td className="px-2 py-1 text-text-tertiary">—</td>
                <td className="px-2 py-1 text-right">{home.runs}</td>
                <td className="px-2 py-1 text-right">
                  {home.browsed}/{home.planned}
                </td>
                <td className="px-2 py-1 text-right">{home.interactions}</td>
                <td className="px-2 py-1 text-right">—</td>
                <td className="px-2 py-1 text-text-tertiary">
                  {home.observations}{" "}
                  条手机端观察——推荐流是否靠近目标兴趣看下方时间线
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Observations ──────────────────────────────────────────────

function ObservationTimeline({
  entries,
  showAll,
  onToggle,
}: {
  entries: ObservationEntry[];
  showAll: boolean;
  onToggle: () => void;
}) {
  if (entries.length === 0) return null;
  const visible = showAll ? entries : entries.slice(0, OBSERVATION_PREVIEW);
  return (
    <div className="flex flex-col gap-1">
      <SectionTitle hint="手机端每个环节的观察 + 运营备注，按日期倒序">
        观察时间线
      </SectionTitle>
      <ul className="flex flex-col gap-1 text-[12px]">
        {visible.map((o, i) => (
          <li
            key={`${o.runId}-${o.chunk}-${i}`}
            className="flex items-start gap-2"
          >
            <span className="shrink-0 font-mono text-[11px] text-text-tertiary">
              {shortDate(o.date)}
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 text-[10px] ${
                o.source === "ops"
                  ? "bg-sky-500/10 text-sky-700"
                  : "bg-surface-2 text-text-secondary"
              }`}
            >
              {o.source === "ops" ? "运营" : "手机"}
            </span>
            <span className="min-w-0 text-text-secondary">
              <span className="text-text-primary">
                {o.accountLabel} · {o.chunk}
              </span>{" "}
              · {o.text}
            </span>
          </li>
        ))}
      </ul>
      {entries.length > OBSERVATION_PREVIEW ? (
        <div>
          <SecondaryButton onClick={onToggle}>
            {showAll ? "收起" : `展开全部 ${entries.length} 条`}
          </SecondaryButton>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-md bg-surface-2/60 px-2 py-1.5">
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div
        className={`text-[13px] font-medium ${tone === "warn" ? "text-amber-600" : "text-text-primary"}`}
      >
        {value}
      </div>
    </div>
  );
}
