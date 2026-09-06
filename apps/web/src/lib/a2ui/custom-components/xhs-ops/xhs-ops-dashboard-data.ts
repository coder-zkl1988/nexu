/**
 * Pure aggregation helpers behind `XhsOpsDashboard` (P2-2 复盘看板).
 *
 * Everything here is derived from `GET /api/v1/xhs-ops/runs` plus the account
 * list — no extra controller endpoint. Kept free of React so the matrix /
 * anomaly / keyword logic is unit-testable, mirroring `findPersonaOverlaps`.
 */
import type {
  XhsOpsAccount,
  XhsOpsAnomalyType,
  XhsOpsRun,
  XhsOpsRunChunk,
  XhsOpsRunStatus,
} from "./xhs-ops-types";

export const DASHBOARD_DAY_OPTIONS = [7, 14, 30] as const;
export const DASHBOARD_MAX_DAYS = 60;

export function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last `days` local dates, oldest first, ending today. */
export function lastNDates(days: number, today: Date = new Date()): string[] {
  const n = Math.min(DASHBOARD_MAX_DAYS, Math.max(1, Math.round(days || 7)));
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(
      localDateString(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() - i),
      ),
    );
  }
  return out;
}

/** "2026-09-05" → "09-05" for column headers. */
export function shortDate(date: string): string {
  return date.length >= 10 ? date.slice(5, 10) : date;
}

export function chunkTitle(chunk: XhsOpsRunChunk): string {
  if (chunk.mode === "comment") return "评论";
  return chunk.mode === "home"
    ? "首页推荐流"
    : `搜索「${chunk.keyword ?? ""}」`;
}

function interactionTotal(c: {
  interactions?: {
    like?: number;
    collect?: number;
    follow?: number;
    comment?: number;
  } | null;
}): number {
  const i = c.interactions;
  return (
    (i?.like ?? 0) + (i?.collect ?? 0) + (i?.follow ?? 0) + (i?.comment ?? 0)
  );
}

// ── Matrix ────────────────────────────────────────────────────

export interface DashboardCell {
  date: string;
  runs: XhsOpsRun[];
  planned: number;
  browsed: number;
  home: number;
  interactions: number;
  anomalies: number;
  /** Worst status among the day's runs; null when the cell is empty. */
  status: XhsOpsRunStatus | null;
}

export interface DashboardTotals {
  runs: number;
  planned: number;
  browsed: number;
  home: number;
  interactions: number;
  anomalies: number;
}

export interface DashboardRow {
  accountId: string;
  label: string;
  /** false when the account was deleted after its runs were recorded. */
  exists: boolean;
  bound: boolean;
  coreKeywords: string[];
  cells: DashboardCell[];
  totals: DashboardTotals;
}

const STATUS_SEVERITY: Record<XhsOpsRunStatus, number> = {
  completed: 0,
  planned: 1,
  running: 1,
  cancelled: 2,
  interrupted: 3,
  failed: 4,
};

function worstStatus(runs: XhsOpsRun[]): XhsOpsRunStatus | null {
  let worst: XhsOpsRunStatus | null = null;
  for (const r of runs) {
    if (worst === null || STATUS_SEVERITY[r.status] > STATUS_SEVERITY[worst]) {
      worst = r.status;
    }
  }
  return worst;
}

function emptyTotals(): DashboardTotals {
  return {
    runs: 0,
    planned: 0,
    browsed: 0,
    home: 0,
    interactions: 0,
    anomalies: 0,
  };
}

function addRunToTotals(t: DashboardTotals, run: XhsOpsRun): void {
  const s = run.summary;
  t.runs += 1;
  t.planned += s?.plannedTotal ?? 0;
  t.browsed += s?.browsedTotal ?? 0;
  t.home += s?.homeBrowsed ?? 0;
  t.interactions += interactionTotal(s ?? {});
  t.anomalies += s?.anomalyCount ?? 0;
}

/**
 * Account × date matrix. Bound accounts always get a row (gaps are the point);
 * unbound accounts only when they have runs in range; accounts that appear in
 * runs but no longer exist are kept with their label snapshot.
 */
export function buildRunMatrix(
  accounts: XhsOpsAccount[],
  runs: XhsOpsRun[],
  dates: string[],
): DashboardRow[] {
  const dateSet = new Set(dates);
  const inRange = runs.filter((r) => dateSet.has(r.date));
  const byAccount = new Map<string, XhsOpsRun[]>();
  for (const r of inRange) {
    const list = byAccount.get(r.accountId) ?? [];
    list.push(r);
    byAccount.set(r.accountId, list);
  }

  const rows: DashboardRow[] = [];
  const seen = new Set<string>();
  const pushRow = (
    accountId: string,
    label: string,
    exists: boolean,
    bound: boolean,
    coreKeywords: string[],
  ) => {
    seen.add(accountId);
    const accountRuns = byAccount.get(accountId) ?? [];
    const totals = emptyTotals();
    const cells = dates.map<DashboardCell>((date) => {
      const dayRuns = accountRuns
        .filter((r) => r.date === date)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const cell: DashboardCell = {
        date,
        runs: dayRuns,
        planned: 0,
        browsed: 0,
        home: 0,
        interactions: 0,
        anomalies: 0,
        status: worstStatus(dayRuns),
      };
      for (const r of dayRuns) {
        cell.planned += r.summary?.plannedTotal ?? 0;
        cell.browsed += r.summary?.browsedTotal ?? 0;
        cell.home += r.summary?.homeBrowsed ?? 0;
        cell.interactions += interactionTotal(r.summary ?? {});
        cell.anomalies += r.summary?.anomalyCount ?? 0;
        addRunToTotals(totals, r);
      }
      return cell;
    });
    rows.push({ accountId, label, exists, bound, coreKeywords, cells, totals });
  };

  for (const a of accounts) {
    const has = (byAccount.get(a.id)?.length ?? 0) > 0;
    if (!a.deviceId && !has) continue;
    pushRow(
      a.id,
      a.label,
      true,
      Boolean(a.deviceId),
      a.interestPool?.core ?? [],
    );
  }
  for (const [accountId, list] of byAccount) {
    if (seen.has(accountId)) continue;
    const latest = [...list].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];
    pushRow(accountId, latest?.accountLabel ?? accountId, false, false, []);
  }
  return rows;
}

export function sumTotals(rows: DashboardRow[]): DashboardTotals {
  const t = emptyTotals();
  for (const r of rows) {
    t.runs += r.totals.runs;
    t.planned += r.totals.planned;
    t.browsed += r.totals.browsed;
    t.home += r.totals.home;
    t.interactions += r.totals.interactions;
    t.anomalies += r.totals.anomalies;
  }
  return t;
}

// ── Anomalies ─────────────────────────────────────────────────

export interface AnomalySummaryRow {
  type: XhsOpsAnomalyType | string;
  count: number;
  latest: {
    date: string;
    accountLabel: string;
    chunk: string;
    detail: string;
  } | null;
}

/** Chunk anomalies grouped by type, most frequent first. */
export function summarizeAnomalies(runs: XhsOpsRun[]): AnomalySummaryRow[] {
  const map = new Map<string, AnomalySummaryRow>();
  const ordered = [...runs].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  for (const run of ordered) {
    for (const chunk of run.chunks ?? []) {
      for (const a of chunk.anomalies ?? []) {
        const row = map.get(a.type) ?? { type: a.type, count: 0, latest: null };
        row.count += 1;
        row.latest = {
          date: run.date,
          accountLabel: run.accountLabel,
          chunk: chunkTitle(chunk),
          detail: a.detail ?? "",
        };
        map.set(a.type, row);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// ── Observations ──────────────────────────────────────────────

export interface ObservationEntry {
  runId: string;
  date: string;
  accountLabel: string;
  /** "phone" = chunk observation written by the phone; "ops" = run.notes. */
  source: "phone" | "ops";
  chunk: string;
  text: string;
}

/** Phone-side chunk observations + human run notes, newest first. */
export function collectObservations(runs: XhsOpsRun[]): ObservationEntry[] {
  const out: ObservationEntry[] = [];
  const ordered = [...runs].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
  for (const run of ordered) {
    if (run.notes?.trim()) {
      out.push({
        runId: run.id,
        date: run.date,
        accountLabel: run.accountLabel,
        source: "ops",
        chunk: "运营备注",
        text: run.notes.trim(),
      });
    }
    for (const chunk of [...(run.chunks ?? [])].sort(
      (a, b) => a.index - b.index,
    )) {
      const text = chunk.observation?.trim();
      if (!text) continue;
      out.push({
        runId: run.id,
        date: run.date,
        accountLabel: run.accountLabel,
        source: "phone",
        chunk: chunkTitle(chunk),
        text,
      });
    }
  }
  return out;
}

// ── Keywords ──────────────────────────────────────────────────

export type KeywordVerdict = "good" | "watch" | "adjust";

export interface KeywordStat {
  keyword: string;
  runs: number;
  planned: number;
  browsed: number;
  interactions: number;
  anomalies: number;
  /** no_results + content_mismatch — the two signals that a keyword is off. */
  mismatch: number;
  /** Labels of accounts that carry this keyword in their core pool. */
  coreOf: string[];
  verdict: KeywordVerdict;
  hint: string;
}

export interface HomeFeedStat {
  runs: number;
  planned: number;
  browsed: number;
  interactions: number;
  observations: number;
}

const MISMATCH_TYPES = new Set<string>(["no_results", "content_mismatch"]);

/**
 * Per-keyword performance across the search chunks in range. The verdict is
 * the operator's cue for editing the interest pool: any 无结果/内容不匹配
 * anomaly → 建议调整; completion below half on a real sample → 观察.
 */
export function keywordStats(
  runs: XhsOpsRun[],
  accounts: XhsOpsAccount[],
): { keywords: KeywordStat[]; home: HomeFeedStat } {
  const coreOf = new Map<string, Set<string>>();
  for (const a of accounts) {
    for (const k of a.interestPool?.core ?? []) {
      const set = coreOf.get(k) ?? new Set<string>();
      set.add(a.label);
      coreOf.set(k, set);
    }
  }
  const map = new Map<string, KeywordStat>();
  const home: HomeFeedStat = {
    runs: 0,
    planned: 0,
    browsed: 0,
    interactions: 0,
    observations: 0,
  };
  for (const run of runs) {
    let hadHome = false;
    for (const chunk of run.chunks ?? []) {
      if (chunk.status === "pending") continue;
      if (chunk.mode === "home") {
        hadHome = true;
        home.planned += chunk.plannedCount ?? 0;
        home.browsed += chunk.browsed ?? 0;
        home.interactions += interactionTotal(chunk);
        if (chunk.observation?.trim()) home.observations += 1;
        continue;
      }
      const keyword = chunk.keyword?.trim();
      if (!keyword) continue;
      const stat = map.get(keyword) ?? {
        keyword,
        runs: 0,
        planned: 0,
        browsed: 0,
        interactions: 0,
        anomalies: 0,
        mismatch: 0,
        coreOf: [...(coreOf.get(keyword) ?? [])],
        verdict: "good" as KeywordVerdict,
        hint: "",
      };
      stat.runs += 1;
      stat.planned += chunk.plannedCount ?? 0;
      stat.browsed += chunk.browsed ?? 0;
      stat.interactions += interactionTotal(chunk);
      for (const a of chunk.anomalies ?? []) {
        stat.anomalies += 1;
        if (MISMATCH_TYPES.has(a.type)) stat.mismatch += 1;
      }
      map.set(keyword, stat);
    }
    if (hadHome) home.runs += 1;
  }
  const VERDICT_ORDER: Record<KeywordVerdict, number> = {
    adjust: 0,
    watch: 1,
    good: 2,
  };
  const keywords = [...map.values()].map((s) => {
    if (s.mismatch > 0) {
      s.verdict = "adjust";
      s.hint = `${s.mismatch} 次无结果/内容不匹配，建议换词或移出核心池`;
    } else if (s.planned >= 4 && s.browsed < s.planned / 2) {
      s.verdict = "watch";
      s.hint = `完成率 ${Math.round((s.browsed / s.planned) * 100)}%，看是否加载/风控问题`;
    } else {
      s.verdict = "good";
      s.hint = s.coreOf.length > 0 ? "核心词，表现正常" : "表现正常";
    }
    return s;
  });
  keywords.sort(
    (a, b) =>
      VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
      b.planned - a.planned ||
      a.keyword.localeCompare(b.keyword, "zh-Hans-CN"),
  );
  return { keywords, home };
}

export const KEYWORD_VERDICT_LABEL: Record<KeywordVerdict, string> = {
  good: "正常",
  watch: "观察",
  adjust: "建议调整",
};
