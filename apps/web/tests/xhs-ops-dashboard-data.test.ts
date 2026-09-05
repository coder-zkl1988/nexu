import { describe, expect, it } from "vitest";
import { pickProjectByName } from "../src/lib/a2ui/custom-components/xhs-ops/XhsOpsDashboard";
import {
  buildRunMatrix,
  collectObservations,
  keywordStats,
  lastNDates,
  shortDate,
  sumTotals,
  summarizeAnomalies,
} from "../src/lib/a2ui/custom-components/xhs-ops/xhs-ops-dashboard-data";
import type {
  XhsOpsAccount,
  XhsOpsProject,
  XhsOpsRun,
  XhsOpsRunChunk,
} from "../src/lib/a2ui/custom-components/xhs-ops/xhs-ops-types";

function account(
  id: string,
  label: string,
  core: string[],
  deviceId: string | null = "dev-1",
): XhsOpsAccount {
  return {
    id,
    label,
    deviceId,
    interestPool: { core, extended: [], general: [] },
  } as unknown as XhsOpsAccount;
}

function chunk(partial: Partial<XhsOpsRunChunk>): XhsOpsRunChunk {
  return {
    index: 0,
    mode: "search",
    keyword: "亲子酒店",
    plannedCount: 3,
    status: "completed",
    taskId: null,
    startedAt: null,
    completedAt: null,
    browsed: 3,
    skipped: 0,
    interactions: { like: 0, collect: 0, follow: 0 },
    anomalies: [],
    observation: null,
    posts: [],
    message: null,
    totalSteps: null,
    finalScreenshot: null,
    error: null,
    ...partial,
  };
}

function run(
  partial: Partial<XhsOpsRun> & {
    accountId: string;
    accountLabel: string;
    date: string;
  },
): XhsOpsRun {
  const chunks = partial.chunks ?? [];
  const browsed = chunks.reduce((n, c) => n + c.browsed, 0);
  const planned = chunks.reduce((n, c) => n + c.plannedCount, 0);
  return {
    id: `${partial.accountId}-${partial.date}-${partial.createdAt ?? "0"}`,
    projectId: "p1",
    deviceId: "dev-1",
    status: "completed",
    plan: {
      keywords: [],
      homeFeedCount: 0,
      dwellSecMin: 10,
      dwellSecMax: 20,
      interaction: {} as never,
    },
    chunks,
    summary: {
      plannedTotal: planned,
      browsedTotal: browsed,
      searchBrowsed: chunks
        .filter((c) => c.mode === "search")
        .reduce((n, c) => n + c.browsed, 0),
      homeBrowsed: chunks
        .filter((c) => c.mode === "home")
        .reduce((n, c) => n + c.browsed, 0),
      interactions: chunks.reduce(
        (acc, c) => ({
          like: acc.like + c.interactions.like,
          collect: acc.collect + c.interactions.collect,
          follow: acc.follow + c.interactions.follow,
        }),
        { like: 0, collect: 0, follow: 0 },
      ),
      anomalyCount: chunks.reduce((n, c) => n + c.anomalies.length, 0),
      durationMs: null,
    },
    notes: "",
    error: null,
    createdAt: `${partial.date}T0${partial.createdAt ?? "0"}:00:00.000Z`,
    startedAt: null,
    completedAt: null,
    updatedAt: `${partial.date}T00:00:00.000Z`,
    ...partial,
  };
}

const TODAY = new Date(2026, 8, 5); // 2026-09-05 local

describe("xhs-ops dashboard data (P2-2 复盘看板)", () => {
  it("lastNDates ends today, oldest first, clamped to 1..60", () => {
    expect(lastNDates(3, TODAY)).toEqual([
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
    expect(lastNDates(0, TODAY)).toHaveLength(7); // falsy → default 7
    expect(lastNDates(999, TODAY)).toHaveLength(60);
    expect(shortDate("2026-09-05")).toBe("09-05");
  });

  it("buildRunMatrix keeps bound accounts with gaps, drops unbound without runs, keeps deleted accounts from runs", () => {
    const accounts = [
      account("a", "豆豆妈", ["亲子酒店"]),
      account("b", "桃子爸", ["露营"], null),
      account("c", "无记录未绑定", [], null),
    ];
    const runs = [
      run({
        accountId: "a",
        accountLabel: "豆豆妈",
        date: "2026-09-04",
        chunks: [
          chunk({}),
          chunk({
            index: 1,
            mode: "home",
            keyword: null,
            plannedCount: 6,
            browsed: 5,
            interactions: { like: 2, collect: 0, follow: 1 },
          }),
        ],
      }),
      run({
        accountId: "a",
        accountLabel: "豆豆妈",
        date: "2026-09-04",
        createdAt: "5",
        status: "failed",
        chunks: [
          chunk({
            status: "failed",
            browsed: 1,
            anomalies: [{ type: "load_failed", detail: "超时" }],
          }),
        ],
      }),
      run({
        accountId: "b",
        accountLabel: "桃子爸",
        date: "2026-09-05",
        chunks: [chunk({ keyword: "露营" })],
      }),
      run({
        accountId: "gone",
        accountLabel: "已删账号",
        date: "2026-09-03",
        chunks: [chunk({})],
      }),
      run({
        accountId: "a",
        accountLabel: "豆豆妈",
        date: "2026-08-01",
        chunks: [chunk({})],
      }), // out of range
    ];
    const dates = lastNDates(3, TODAY);
    const rows = buildRunMatrix(accounts, runs, dates);
    expect(rows.map((r) => r.label)).toEqual(["豆豆妈", "桃子爸", "已删账号"]);

    const a = rows[0];
    expect(a?.bound).toBe(true);
    expect(a?.coreKeywords).toEqual(["亲子酒店"]);
    expect(a?.cells.map((c) => c.runs.length)).toEqual([0, 2, 0]);
    const day = a?.cells[1];
    expect(day).toMatchObject({
      planned: 12,
      browsed: 9,
      home: 5,
      interactions: 3,
      anomalies: 1,
      status: "failed",
    });
    expect(a?.totals).toMatchObject({ runs: 2, planned: 12, browsed: 9 });

    const gone = rows[2];
    expect(gone?.exists).toBe(false);
    expect(gone?.cells[0]?.runs).toHaveLength(1);

    expect(sumTotals(rows)).toMatchObject({
      runs: 4,
      planned: 18,
      browsed: 15,
      anomalies: 1,
    });
  });

  it("summarizeAnomalies groups by type with the latest occurrence", () => {
    const runs = [
      run({
        accountId: "a",
        accountLabel: "豆豆妈",
        date: "2026-09-03",
        chunks: [
          chunk({ anomalies: [{ type: "no_results", detail: "第一次" }] }),
        ],
      }),
      run({
        accountId: "a",
        accountLabel: "豆豆妈",
        date: "2026-09-04",
        chunks: [
          chunk({
            keyword: "周边游",
            anomalies: [
              { type: "no_results", detail: "第二次" },
              { type: "rate_limited", detail: "" },
            ],
          }),
        ],
      }),
    ];
    const rows = summarizeAnomalies(runs);
    expect(rows.map((r) => [r.type, r.count])).toEqual([
      ["no_results", 2],
      ["rate_limited", 1],
    ]);
    expect(rows[0]?.latest).toMatchObject({
      date: "2026-09-04",
      chunk: "搜索「周边游」",
      detail: "第二次",
    });
  });

  it("collectObservations mixes phone observations and ops notes, newest first", () => {
    const runs = [
      run({
        accountId: "a",
        accountLabel: "豆豆妈",
        date: "2026-09-03",
        notes: "旧备注",
        chunks: [
          chunk({
            mode: "home",
            keyword: null,
            observation: "推荐流有亲子内容了",
          }),
        ],
      }),
      run({
        accountId: "a",
        accountLabel: "豆豆妈",
        date: "2026-09-04",
        chunks: [
          chunk({ observation: "  " }),
          chunk({ index: 1, observation: "内容匹配" }),
        ],
      }),
    ];
    const out = collectObservations(runs);
    expect(out.map((o) => [o.date, o.source, o.chunk])).toEqual([
      ["2026-09-04", "phone", "搜索「亲子酒店」"],
      ["2026-09-03", "ops", "运营备注"],
      ["2026-09-03", "phone", "首页推荐流"],
    ]);
  });

  it("keywordStats verdicts: mismatch → 建议调整, low completion → 观察, else 正常; home feed aggregated separately", () => {
    const accounts = [account("a", "豆豆妈", ["亲子酒店", "室内乐园"])];
    const runs = [
      run({
        accountId: "a",
        accountLabel: "豆豆妈",
        date: "2026-09-04",
        chunks: [
          chunk({
            keyword: "亲子酒店",
            plannedCount: 3,
            browsed: 3,
            interactions: { like: 1, collect: 1, follow: 0 },
          }),
          chunk({
            index: 1,
            keyword: "室内乐园",
            plannedCount: 3,
            browsed: 0,
            anomalies: [{ type: "content_mismatch", detail: "全是商场广告" }],
          }),
          chunk({ index: 2, keyword: "周边游", plannedCount: 4, browsed: 1 }),
          chunk({
            index: 3,
            mode: "home",
            keyword: null,
            plannedCount: 6,
            browsed: 6,
            observation: "有亲子酒店",
          }),
          chunk({ index: 4, keyword: "未执行", status: "pending", browsed: 0 }),
        ],
      }),
    ];
    const { keywords, home } = keywordStats(runs, accounts);
    expect(keywords.map((k) => [k.keyword, k.verdict])).toEqual([
      ["室内乐园", "adjust"],
      ["周边游", "watch"],
      ["亲子酒店", "good"],
    ]);
    expect(keywords[0]?.coreOf).toEqual(["豆豆妈"]);
    expect(keywords[0]?.hint).toContain("建议换词");
    expect(keywords[1]?.hint).toContain("完成率 25%");
    expect(keywords[2]?.interactions).toBe(2);
    expect(home).toEqual({
      runs: 1,
      planned: 6,
      browsed: 6,
      interactions: 0,
      observations: 1,
    });
  });

  it("pickProjectByName: exact > unique substring > single project > null", () => {
    const projects = [
      { id: "p1", name: "新氧青春·亲子度假" },
      { id: "p2", name: "新氧青春·医美" },
      { id: "p3", name: "露营装备" },
    ] as XhsOpsProject[];
    expect(pickProjectByName(projects, "新氧青春·亲子度假")?.id).toBe("p1");
    expect(pickProjectByName(projects, "亲子度假")?.id).toBe("p1");
    expect(pickProjectByName(projects, "「露营装备」项目")?.id).toBe("p3");
    expect(pickProjectByName(projects, "新氧青春")).toBeNull(); // ambiguous
    expect(pickProjectByName(projects, "")).toBeNull(); // several, nothing asked
    expect(pickProjectByName(projects.slice(2), "")?.id).toBe("p3"); // only one
  });
});
