import type {
  XhsOpsAccount,
  XhsOpsPlanSuggestion,
  XhsOpsRun,
} from "@nexu/shared";

/**
 * 当日计划确定性生成（运营文档 §四「当日养号任务」）：不依赖 LLM——
 * 核心兴趣按"这是该账号第几轮"轮换取 3 个，扩展/泛各取 1 个补自然感，
 * 并避开上一轮完全相同的关键词集合；每词篇数取账号 browseDefaults；
 * 首页篇数由 searchRatioPercent 反推（搜索占比 80% → 首页≈搜索总量的 1/4）。
 * agent 只需渲染 RunPlanner，桌面自己拉建议；用户仍可在卡片上改。
 */

const CORE_PICK = 3;
const EXTENDED_PICK = 1;
const GENERAL_PICK = 1;
const MAX_KEYWORDS = 8;
const MAX_HOME = 12;

function uniq(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const k = raw.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function rotate<T>(list: readonly T[], offset: number, take: number): T[] {
  if (list.length === 0 || take <= 0) return [];
  const n = Math.min(take, list.length);
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const item = list[(offset + i) % list.length];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/** 搜索占比 r：首页篇数 = 搜索总篇数 × (1-r)/r，钳 0..12；r=100% → 0；r=0 → 回退账号默认。 */
export function homeFeedFromRatio(
  searchTotal: number,
  searchRatioPercent: number,
  fallback: number,
): number {
  const r = Math.max(0, Math.min(100, searchRatioPercent)) / 100;
  if (r >= 1) return 0;
  if (r <= 0) return Math.max(0, Math.min(MAX_HOME, fallback));
  return Math.max(
    0,
    Math.min(MAX_HOME, Math.round((searchTotal * (1 - r)) / r)),
  );
}

/** @param previousRuns 该账号历史 run，最新在前（store.listRuns 的顺序）。 */
export function suggestPlan(
  account: XhsOpsAccount,
  previousRuns: readonly XhsOpsRun[],
): XhsOpsPlanSuggestion {
  const core = uniq(account.interestPool.core);
  const extended = uniq(account.interestPool.extended);
  const general = uniq(account.interestPool.general);
  const round = previousRuns.length;
  const rationale: string[] = [];

  const last = previousRuns[0];
  const lastSet = new Set(
    (last?.plan.keywords ?? []).map((k) => k.keyword.trim()),
  );
  let offset = core.length > 0 ? round % core.length : 0;
  let picks = rotate(core, offset, CORE_PICK);
  if (
    core.length > CORE_PICK &&
    lastSet.size > 0 &&
    picks.length === lastSet.size &&
    picks.every((k) => lastSet.has(k))
  ) {
    offset = (offset + 1) % core.length;
    picks = rotate(core, offset, CORE_PICK);
    rationale.push("与上一轮关键词完全相同，核心词前移一位");
  }
  const ext = rotate(extended, round, EXTENDED_PICK);
  const gen = rotate(general, round, GENERAL_PICK);
  const words = uniq([...picks, ...ext, ...gen]).slice(0, MAX_KEYWORDS);
  const perKeyword = account.browseDefaults.postsPerKeyword;
  const keywords = words.map((keyword) => ({ keyword, count: perKeyword }));
  const searchTotal = keywords.reduce((n, k) => n + k.count, 0);
  const homeFeedCount = homeFeedFromRatio(
    searchTotal,
    account.browseDefaults.searchRatioPercent,
    account.browseDefaults.homeFeedCount,
  );

  rationale.unshift(
    core.length > 0
      ? `第 ${round + 1} 轮：核心兴趣从第 ${offset + 1} 个起轮换取 ${picks.length} 个（${picks.join("、")}）`
      : "核心兴趣池为空，未能生成核心关键词",
  );
  if (ext.length > 0) rationale.push(`扩展兴趣补 ${ext.join("、")}`);
  if (gen.length > 0) rationale.push(`泛内容补 ${gen.join("、")}`);
  rationale.push(
    `搜索占比 ${account.browseDefaults.searchRatioPercent}%：搜索 ${searchTotal} 篇 → 首页 ${homeFeedCount} 篇`,
  );

  return {
    accountId: account.id,
    accountLabel: account.label,
    keywords,
    homeFeedCount,
    dwellSecMin: account.browseDefaults.dwellSecMin,
    dwellSecMax: account.browseDefaults.dwellSecMax,
    interaction: account.interaction,
    rationale,
  };
}
