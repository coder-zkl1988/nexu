/**
 * TypeScript mirror of the xhs-ops contract (scratchpad spec §1).
 *
 * The controller owns the zod schemas (packages/shared/src/schemas/xhs-ops.ts).
 * Until that file is exported from "@nexu/shared" and `pnpm generate-types`
 * has refreshed the SDK, the web side types the REST payloads here. Field
 * names/shapes must stay identical to the spec — this file is the only place
 * the web code spells them out.
 */

export interface XhsOpsInteractionRule {
  enabled: boolean;
  /** 0..50 */
  dailyCap: number;
  /** 0..100 */
  ratioPercent: number;
}

export interface XhsOpsInteractionConfig {
  like: XhsOpsInteractionRule;
  collect: XhsOpsInteractionRule;
  follow: XhsOpsInteractionRule;
  /** Literal false — comments are closed in Phase 1. */
  comment: { enabled: false };
}

export interface XhsOpsBrowseDefaults {
  /** 5..60 */
  dwellSecMin: number;
  /** 5..120 */
  dwellSecMax: number;
  /** 0..100 */
  searchRatioPercent: number;
  /** 1..8 */
  postsPerKeyword: number;
  /** 0..12 */
  homeFeedCount: number;
  /** 日目标篇数（0 = 不设目标）；>0 时按 dailySegments 拆段 */
  dailyTargetPosts: number;
  /** 当日拆成几个 run 串行执行，1..3；1 = 单 run */
  dailySegments: number;
}

/** 当日多段执行时本 run 的段序；单 run 为 null。 */
export interface XhsOpsRunSegment {
  index: number;
  count: number;
}

export interface XhsOpsBusiness {
  industry: string;
  product: string;
  regions: string[];
  sellingPoints: string[];
  priceBand: string;
  scene: string;
}

export interface XhsOpsAudience {
  ageRange: string;
  genderRatio: string;
  regions: string[];
  occupations: string[];
  spendingPower: string;
  knownInterests: string[];
  painPoints: string[];
}

export interface XhsOpsOpsNotes {
  forbiddenTopics: string[];
  boostKeywords: string[];
  avoidContentTypes: string[];
}

export interface XhsOpsProfileBase {
  ageRange: string;
  genderRatio: string;
  regions: string[];
}

export interface XhsOpsProfile {
  summary: string;
  base: XhsOpsProfileBase;
  verticalInterests: string[];
  generalInterests: string[];
  confirmedAt: string | null;
  updatedAt: string;
}

export interface XhsOpsProject {
  id: string;
  name: string;
  business: XhsOpsBusiness;
  audience: XhsOpsAudience;
  opsNotes: XhsOpsOpsNotes;
  profile: XhsOpsProfile | null;
  createdAt: string;
  updatedAt: string;
}

export interface XhsOpsInterestPool {
  core: string[];
  extended: string[];
  general: string[];
}

export type XhsOpsProfilePart = "text" | "avatar" | "cover";
export type XhsOpsProfileApplyStatus = "applied" | "partial" | "failed";

export interface XhsOpsProfileDraft {
  nickname: string;
  bio: string;
  /** media 目录下的绝对路径 */
  avatarCandidates: string[];
  coverCandidates: string[];
  avatarPath: string | null;
  coverPath: string | null;
  generatedAt: string | null;
  appliedAt: string | null;
  applyStatus: XhsOpsProfileApplyStatus | null;
  applyResult: string | null;
}

export interface XhsOpsPersona {
  age: string;
  gender: string;
  region: string;
  occupation: string;
  lifeStatus: string;
}

export interface XhsOpsAccount {
  id: string;
  projectId: string;
  /** 账号定位名，1..40 */
  label: string;
  /** 一句话内容方向与风格 */
  positioning: string;
  /** 人设人口学字段（年龄/性别/地区/职业/生活状态） */
  persona: XhsOpsPersona;
  /** 账号基础资料草稿（昵称/简介/头像背景备选/应用状态） */
  profileDraft: XhsOpsProfileDraft;
  deviceId: string | null;
  deviceName: string | null;
  interestPool: XhsOpsInterestPool;
  interaction: XhsOpsInteractionConfig;
  browseDefaults: XhsOpsBrowseDefaults;
  createdAt: string;
  updatedAt: string;
}

export type XhsOpsAnomalyType =
  | "no_results"
  | "load_failed"
  | "login_required"
  | "account_restricted"
  | "rate_limited"
  | "content_mismatch"
  | "interrupted"
  | "other";

export interface XhsOpsAnomaly {
  type: XhsOpsAnomalyType;
  detail: string;
}

export interface XhsOpsInteractionCounts {
  like: number;
  collect: number;
  follow: number;
}

export type XhsOpsChunkMode = "search" | "home";

export type XhsOpsChunkStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export interface XhsOpsRunChunkPost {
  title: string;
  author: string;
  action: "like" | "collect" | "follow" | "none";
  commentsRead: number;
}

export interface XhsOpsRunChunk {
  index: number;
  mode: XhsOpsChunkMode;
  keyword: string | null;
  plannedCount: number;
  status: XhsOpsChunkStatus;
  taskId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  browsed: number;
  skipped: number;
  interactions: XhsOpsInteractionCounts;
  anomalies: XhsOpsAnomaly[];
  observation: string | null;
  posts: XhsOpsRunChunkPost[];
  message: string | null;
  totalSteps: number | null;
  finalScreenshot: string | null;
  error: string | null;
}

export interface XhsOpsRunKeyword {
  /** 1..40 */
  keyword: string;
  /** 1..8 */
  count: number;
}

export interface XhsOpsRunPlan {
  /** 1..8 entries */
  keywords: XhsOpsRunKeyword[];
  /** 0..12 */
  homeFeedCount: number;
  dwellSecMin: number;
  dwellSecMax: number;
  interaction: XhsOpsInteractionConfig;
}

export interface XhsOpsRunSummary {
  plannedTotal: number;
  browsedTotal: number;
  searchBrowsed: number;
  homeBrowsed: number;
  interactions: XhsOpsInteractionCounts;
  anomalyCount: number;
  durationMs: number | null;
}

export type XhsOpsRunStatus =
  | "planned"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface XhsOpsRun {
  id: string;
  projectId: string;
  accountId: string;
  deviceId: string;
  accountLabel: string;
  /** YYYY-MM-DD */
  date: string;
  status: XhsOpsRunStatus;
  plan: XhsOpsRunPlan;
  segment: XhsOpsRunSegment | null;
  chunks: XhsOpsRunChunk[];
  summary: XhsOpsRunSummary;
  /** 运营观察（人工填写） */
  notes: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

// ── Request bodies ─────────────────────────────────────────────

export interface XhsOpsProfileInput {
  summary: string;
  base: XhsOpsProfileBase;
  verticalInterests: string[];
  generalInterests: string[];
  confirmedAt?: string | null;
  updatedAt?: string;
}

export interface XhsOpsProjectCreateInput {
  name: string;
  business?: Partial<XhsOpsBusiness>;
  audience?: Partial<XhsOpsAudience>;
  opsNotes?: Partial<XhsOpsOpsNotes>;
  profile?: XhsOpsProfileInput | null;
}

export type XhsOpsProjectUpdateInput = Partial<XhsOpsProjectCreateInput>;

export interface XhsOpsAccountCreateInput {
  projectId: string;
  label: string;
  positioning?: string;
  persona?: XhsOpsPersona;
  profileDraft?: XhsOpsProfileDraft;
  deviceId?: string | null;
  deviceName?: string | null;
  interestPool?: XhsOpsInterestPool;
  interaction?: XhsOpsInteractionConfig;
  browseDefaults?: XhsOpsBrowseDefaults;
}

export type XhsOpsAccountUpdateInput = Partial<
  Omit<XhsOpsAccountCreateInput, "projectId">
>;

export interface XhsOpsRunCreateInput {
  projectId: string;
  accountId: string;
  /** YYYY-MM-DD; server defaults to today (local time zone). */
  date?: string;
  plan: XhsOpsRunPlan;
  segment?: XhsOpsRunSegment | null;
}

export interface XhsOpsRunUpdateInput {
  notes?: string;
}

export interface XhsOpsRunListFilter {
  projectId?: string;
  accountId?: string;
  date?: string;
}

// ── Defaults (mirror the zod .default() values) ───────────────

export function defaultInteractionConfig(): XhsOpsInteractionConfig {
  return {
    like: { enabled: true, dailyCap: 5, ratioPercent: 10 },
    collect: { enabled: false, dailyCap: 2, ratioPercent: 3 },
    follow: { enabled: false, dailyCap: 0, ratioPercent: 0 },
    comment: { enabled: false },
  };
}

export function defaultBrowseDefaults(): XhsOpsBrowseDefaults {
  return {
    dwellSecMin: 10,
    dwellSecMax: 25,
    searchRatioPercent: 80,
    postsPerKeyword: 5,
    homeFeedCount: 6,
    dailyTargetPosts: 0,
    dailySegments: 1,
  };
}

export function emptyBusiness(): XhsOpsBusiness {
  return {
    industry: "",
    product: "",
    regions: [],
    sellingPoints: [],
    priceBand: "",
    scene: "",
  };
}

export function emptyAudience(): XhsOpsAudience {
  return {
    ageRange: "",
    genderRatio: "",
    regions: [],
    occupations: [],
    spendingPower: "",
    knownInterests: [],
    painPoints: [],
  };
}

export function emptyOpsNotes(): XhsOpsOpsNotes {
  return { forbiddenTopics: [], boostKeywords: [], avoidContentTypes: [] };
}

export function emptyInterestPool(): XhsOpsInterestPool {
  return { core: [], extended: [], general: [] };
}

export function emptyInteractionCounts(): XhsOpsInteractionCounts {
  return { like: 0, collect: 0, follow: 0 };
}

/** A run that is still owned by the executor (progress may still change). */
export function isRunActive(status: XhsOpsRunStatus | undefined): boolean {
  return status === "planned" || status === "running";
}

// ── Loose-input normalizers ───────────────────────────────────
// A2UI props arrive from the model: strings may be missing, arrays may be
// strings, numbers may be strings. These coerce to the contract shapes so the
// components never throw on a partially-filled payload.

export function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item).trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[,，、\n]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

export function asInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeBusiness(value: unknown): XhsOpsBusiness {
  const v = asRecord(value);
  return {
    industry: asString(v.industry),
    product: asString(v.product),
    regions: asStringArray(v.regions),
    sellingPoints: asStringArray(v.sellingPoints),
    priceBand: asString(v.priceBand),
    scene: asString(v.scene),
  };
}

export function normalizeAudience(value: unknown): XhsOpsAudience {
  const v = asRecord(value);
  return {
    ageRange: asString(v.ageRange),
    genderRatio: asString(v.genderRatio),
    regions: asStringArray(v.regions),
    occupations: asStringArray(v.occupations),
    spendingPower: asString(v.spendingPower),
    knownInterests: asStringArray(v.knownInterests),
    painPoints: asStringArray(v.painPoints),
  };
}

export function normalizeOpsNotes(value: unknown): XhsOpsOpsNotes {
  const v = asRecord(value);
  return {
    forbiddenTopics: asStringArray(v.forbiddenTopics),
    boostKeywords: asStringArray(v.boostKeywords),
    avoidContentTypes: asStringArray(v.avoidContentTypes),
  };
}

export function normalizeProfileInput(value: unknown): XhsOpsProfileInput {
  const v = asRecord(value);
  const base = asRecord(v.base);
  return {
    summary: asString(v.summary),
    base: {
      ageRange: asString(base.ageRange),
      genderRatio: asString(base.genderRatio),
      regions: asStringArray(base.regions),
    },
    verticalInterests: asStringArray(v.verticalInterests),
    generalInterests: asStringArray(v.generalInterests),
    confirmedAt:
      typeof v.confirmedAt === "string" ? (v.confirmedAt as string) : null,
  };
}

export function normalizeInterestPool(value: unknown): XhsOpsInterestPool {
  const v = asRecord(value);
  return {
    core: asStringArray(v.core),
    extended: asStringArray(v.extended),
    general: asStringArray(v.general),
  };
}

function normalizeRule(
  value: unknown,
  fallback: XhsOpsInteractionRule,
): XhsOpsInteractionRule {
  const v = asRecord(value);
  return {
    enabled: asBoolean(v.enabled, fallback.enabled),
    dailyCap: asInt(v.dailyCap, fallback.dailyCap, 0, 50),
    ratioPercent: asInt(v.ratioPercent, fallback.ratioPercent, 0, 100),
  };
}

export function normalizeInteractionConfig(
  value: unknown,
): XhsOpsInteractionConfig {
  const v = asRecord(value);
  const d = defaultInteractionConfig();
  return {
    like: normalizeRule(v.like, d.like),
    collect: normalizeRule(v.collect, d.collect),
    follow: normalizeRule(v.follow, d.follow),
    comment: { enabled: false },
  };
}

export function normalizeBrowseDefaults(value: unknown): XhsOpsBrowseDefaults {
  const v = asRecord(value);
  const d = defaultBrowseDefaults();
  const dwellSecMin = asInt(v.dwellSecMin, d.dwellSecMin, 5, 60);
  const dwellSecMax = Math.max(
    dwellSecMin,
    asInt(v.dwellSecMax, d.dwellSecMax, 5, 120),
  );
  return {
    dwellSecMin,
    dwellSecMax,
    searchRatioPercent: asInt(
      v.searchRatioPercent,
      d.searchRatioPercent,
      0,
      100,
    ),
    postsPerKeyword: asInt(v.postsPerKeyword, d.postsPerKeyword, 1, 8),
    homeFeedCount: asInt(v.homeFeedCount, d.homeFeedCount, 0, 12),
    dailyTargetPosts: asInt(v.dailyTargetPosts, d.dailyTargetPosts, 0, 150),
    dailySegments: asInt(v.dailySegments, d.dailySegments, 1, 3),
  };
}

export function normalizeRunSegment(value: unknown): XhsOpsRunSegment | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const count = asInt(v.count, 0, 0, 3);
  const index = asInt(v.index, 0, 0, 3);
  if (count < 1 || index < 1 || index > count) return null;
  return { index, count };
}

export function segmentLabel(
  segment: XhsOpsRunSegment | null | undefined,
): string {
  return segment && segment.count > 1
    ? `第 ${segment.index}/${segment.count} 段`
    : "";
}

export function emptyPersona(): XhsOpsPersona {
  return { age: "", gender: "", region: "", occupation: "", lifeStatus: "" };
}

export function normalizePersona(value: unknown): XhsOpsPersona {
  const v = asRecord(value);
  return {
    age: asString(v.age).trim().slice(0, 20),
    gender: asString(v.gender).trim().slice(0, 10),
    region: asString(v.region).trim().slice(0, 40),
    occupation: asString(v.occupation).trim().slice(0, 40),
    lifeStatus: asString(v.lifeStatus).trim().slice(0, 60),
  };
}

/** "32岁·女·北京海淀·互联网产品经理·2岁娃新手妈妈"；全空返回 ""。 */
export function personaSummary(p: XhsOpsPersona | null | undefined): string {
  if (!p) return "";
  return [p.age, p.gender, p.region, p.occupation, p.lifeStatus]
    .map((x) => (x ?? "").trim())
    .filter((x) => x.length > 0)
    .join("·");
}

// ─── 人设差异检查（P1-3）────────────────────────────────────────────────────

export interface PersonaOverlapInput {
  key: string;
  label: string;
  persona: XhsOpsPersona;
  interestPool: XhsOpsInterestPool;
}

/** 核心兴趣集合重叠到这个比例（Jaccard）即视为"同一类账号"。 */
export const PERSONA_CORE_OVERLAP_THRESHOLD = 0.6;

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a.map(normKey).filter(Boolean));
  const sb = new Set(b.map(normKey).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/**
 * 运营验收「人设有差异」的机械兜底：同项目内两两比对，命中任一规则就给
 * 双方各一条告警（不阻断保存，由运营决定重生成还是接受）：
 *  1. 账号定位名相同；
 *  2. 地区 + 职业完全相同（两项都非空）；
 *  3. 年龄 + 性别 + 生活状态完全相同（三项都非空）；
 *  4. 核心兴趣 Jaccard ≥ 0.6。
 * 返回 key → 告警文案列表；没有告警的 key 不出现。
 */
export function findPersonaOverlaps(
  rows: PersonaOverlapInput[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const push = (key: string, msg: string) => {
    const list = out.get(key) ?? [];
    if (!list.includes(msg)) list.push(msg);
    out.set(key, list);
  };
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (!a || !b) continue;
      const nameA = a.label.trim() || `账号${i + 1}`;
      const nameB = b.label.trim() || `账号${j + 1}`;
      if (a.label.trim() && normKey(a.label) === normKey(b.label)) {
        push(a.key, `账号定位名与「${nameB}」重复`);
        push(b.key, `账号定位名与「${nameA}」重复`);
      }
      const pa = a.persona;
      const pb = b.persona;
      if (
        pa.region.trim() &&
        pa.occupation.trim() &&
        normKey(pa.region) === normKey(pb.region) &&
        normKey(pa.occupation) === normKey(pb.occupation)
      ) {
        push(
          a.key,
          `地区+职业与「${nameB}」相同（${pa.region.trim()}·${pa.occupation.trim()}）`,
        );
        push(
          b.key,
          `地区+职业与「${nameA}」相同（${pb.region.trim()}·${pb.occupation.trim()}）`,
        );
      }
      if (
        pa.age.trim() &&
        pa.gender.trim() &&
        pa.lifeStatus.trim() &&
        normKey(pa.age) === normKey(pb.age) &&
        normKey(pa.gender) === normKey(pb.gender) &&
        normKey(pa.lifeStatus) === normKey(pb.lifeStatus)
      ) {
        push(a.key, `年龄/性别/生活状态与「${nameB}」完全相同`);
        push(b.key, `年龄/性别/生活状态与「${nameA}」完全相同`);
      }
      const overlap = jaccard(a.interestPool.core, b.interestPool.core);
      if (overlap >= PERSONA_CORE_OVERLAP_THRESHOLD) {
        const pct = Math.round(overlap * 100);
        push(a.key, `核心兴趣与「${nameB}」重叠 ${pct}%`);
        push(b.key, `核心兴趣与「${nameA}」重叠 ${pct}%`);
      }
    }
  }
  return out;
}

/** GET /projects/{id}/plan-suggest 的一条建议。 */
export interface XhsOpsPlanSuggestion {
  accountId: string;
  accountLabel: string;
  keywords: XhsOpsRunKeyword[];
  homeFeedCount: number;
  dwellSecMin: number;
  dwellSecMax: number;
  interaction: XhsOpsInteractionConfig;
  rationale: string[];
  segment: XhsOpsRunSegment | null;
}

export function emptyProfileDraft(): XhsOpsProfileDraft {
  return {
    nickname: "",
    bio: "",
    avatarCandidates: [],
    coverCandidates: [],
    avatarPath: null,
    coverPath: null,
    generatedAt: null,
    appliedAt: null,
    applyStatus: null,
    applyResult: null,
  };
}

export function normalizeProfileDraft(value: unknown): XhsOpsProfileDraft {
  const v = asRecord(value);
  const status = asString(v.applyStatus);
  return {
    nickname: asString(v.nickname).slice(0, 20),
    bio: asString(v.bio).slice(0, 200),
    avatarCandidates: asStringArray(v.avatarCandidates),
    coverCandidates: asStringArray(v.coverCandidates),
    avatarPath:
      typeof v.avatarPath === "string" && v.avatarPath ? v.avatarPath : null,
    coverPath:
      typeof v.coverPath === "string" && v.coverPath ? v.coverPath : null,
    generatedAt: typeof v.generatedAt === "string" ? v.generatedAt : null,
    appliedAt: typeof v.appliedAt === "string" ? v.appliedAt : null,
    applyStatus:
      status === "applied" || status === "partial" || status === "failed"
        ? status
        : null,
    applyResult: typeof v.applyResult === "string" ? v.applyResult : null,
  };
}

/** media 目录绝对路径 → 桌面可显示的 URL（controller 的 state-file 端点）。 */
export function mediaFileUrl(absPath: string): string {
  return `/api/v1/media/state-file?path=${encodeURIComponent(absPath)}`;
}
