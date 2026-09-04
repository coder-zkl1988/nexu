import type { XhsOpsAccount, XhsOpsRun } from "@nexu/shared";
import { describe, expect, it } from "vitest";
import {
  homeFeedFromRatio,
  suggestPlan,
} from "../src/services/xhs-ops-plan-suggest.js";
import { computeChunkQuota } from "../src/services/xhs-ops-run-service.js";

function account(overrides: Partial<XhsOpsAccount> = {}): XhsOpsAccount {
  return {
    id: "acct-1",
    projectId: "p1",
    label: "豆豆妈的周末计划",
    positioning: "",
    persona: {
      age: "",
      gender: "",
      region: "",
      occupation: "",
      lifeStatus: "",
    },
    deviceId: "dev-1",
    deviceName: "dev",
    interestPool: {
      core: ["亲子酒店", "周末遛娃", "带娃攻略", "周边游"],
      extended: ["亲子旅行", "北京周边游"],
      general: ["咖啡", "摄影", "家居"],
    },
    interaction: {
      like: { enabled: true, dailyCap: 5, ratioPercent: 10 },
      collect: { enabled: false, dailyCap: 2, ratioPercent: 3 },
      follow: { enabled: false, dailyCap: 0, ratioPercent: 0 },
      comment: { enabled: false },
    },
    browseDefaults: {
      dwellSecMin: 10,
      dwellSecMax: 25,
      searchRatioPercent: 80,
      postsPerKeyword: 5,
      homeFeedCount: 6,
    },
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

function runWith(keywords: string[]): XhsOpsRun {
  return {
    plan: {
      keywords: keywords.map((k) => ({ keyword: k, count: 5 })),
      homeFeedCount: 5,
      dwellSecMin: 10,
      dwellSecMax: 25,
      interaction: account().interaction,
    },
  } as unknown as XhsOpsRun;
}

describe("suggestPlan (P1-4 当日计划确定性生成)", () => {
  it("round 1 takes the first three core words plus one extended and one general", () => {
    const s = suggestPlan(account(), []);
    expect(s.keywords.map((k) => k.keyword)).toEqual([
      "亲子酒店",
      "周末遛娃",
      "带娃攻略",
      "亲子旅行",
      "咖啡",
    ]);
    expect(s.keywords.every((k) => k.count === 5)).toBe(true);
    // 搜索 25 篇、占比 80% → 首页 round(25*0.2/0.8)=6
    expect(s.homeFeedCount).toBe(6);
    expect(s.rationale[0]).toContain("第 1 轮");
  });

  it("rotates core words by round so consecutive days differ", () => {
    const day1 = suggestPlan(account(), []);
    const day2 = suggestPlan(account(), [
      runWith(day1.keywords.map((k) => k.keyword)),
    ]);
    expect(day2.keywords.map((k) => k.keyword)).not.toEqual(
      day1.keywords.map((k) => k.keyword),
    );
    expect(day2.keywords.map((k) => k.keyword).slice(0, 3)).toEqual([
      "周末遛娃",
      "带娃攻略",
      "周边游",
    ]);
  });

  it("shifts one more step when rotation would repeat the previous run exactly", () => {
    // 4 个核心词、每轮取 3：第 4 轮 offset=0 会回到第 1 轮集合；上一轮若恰好是同一集合则前移
    const acct = account();
    const prev = runWith(["亲子酒店", "周末遛娃", "带娃攻略"]);
    const s = suggestPlan(acct, [prev, prev, prev, prev]); // round=4 → offset 0 → 与 prev 相同 → 前移
    expect(s.keywords.map((k) => k.keyword).slice(0, 3)).toEqual([
      "周末遛娃",
      "带娃攻略",
      "周边游",
    ]);
    expect(s.rationale).toContain("与上一轮关键词完全相同，核心词前移一位");
  });

  it("derives the home-feed count from searchRatioPercent", () => {
    expect(homeFeedFromRatio(20, 80, 6)).toBe(5);
    expect(homeFeedFromRatio(20, 100, 6)).toBe(0);
    expect(homeFeedFromRatio(20, 50, 6)).toBe(12); // 20 → clamp 12
    expect(homeFeedFromRatio(20, 0, 6)).toBe(6); // 无占比 → 回退账号默认
    const s = suggestPlan(
      account({
        browseDefaults: {
          dwellSecMin: 10,
          dwellSecMax: 25,
          searchRatioPercent: 100,
          postsPerKeyword: 5,
          homeFeedCount: 6,
        },
      }),
      [],
    );
    expect(s.homeFeedCount).toBe(0);
  });

  it("empty interest pool yields no keywords and says so", () => {
    const s = suggestPlan(
      account({ interestPool: { core: [], extended: [], general: [] } }),
      [],
    );
    expect(s.keywords).toEqual([]);
    expect(s.rationale[0]).toContain("核心兴趣池为空");
  });
});

describe("computeChunkQuota with ratioPercent (P1-4 触发比例生效)", () => {
  const config = account().interaction;
  it("ratio caps the per-chunk allowance below the daily share", () => {
    // like: cap 5 / 4 chunks → share 2；ratio 10% × 5 篇 → 1
    const q = computeChunkQuota(
      config,
      { like: 0, collect: 0, follow: 0 },
      4,
      5,
    );
    expect(q.like).toEqual({ enabled: true, max: 1 });
  });
  it("ratio 0 disables interaction for the chunk even when enabled", () => {
    const zero = {
      ...config,
      like: { enabled: true, dailyCap: 5, ratioPercent: 0 },
    };
    expect(
      computeChunkQuota(zero, { like: 0, collect: 0, follow: 0 }, 2, 5).like,
    ).toEqual({ enabled: false, max: 0 });
  });
  it("without plannedCount the legacy share/remaining rule still applies", () => {
    expect(
      computeChunkQuota(config, { like: 4, collect: 0, follow: 0 }, 4).like,
    ).toEqual({ enabled: true, max: 1 });
  });
});
