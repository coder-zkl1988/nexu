import { z } from "zod";

// ─── xhs-ops: 小红书账号运营 · 内容研究闭环（Phase 1）───────────────────────
// Contract: scratchpad xhs-ops-spec.md §1. Every string field defaults to ""
// and every array to [] so partially filled forms validate.

const text = () => z.string().default("");
const textList = () => z.array(z.string()).default([]);
const count = () => z.number().int().min(0).default(0);

export const xhsOpsDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

// ─── Interaction / browse config ─────────────────────────────────────────────

export const xhsOpsInteractionRuleSchema = z.object({
  enabled: z.boolean(),
  dailyCap: z.number().int().min(0).max(50),
  ratioPercent: z.number().int().min(0).max(100),
});

export const xhsOpsCommentRuleSchema = z.object({
  enabled: z.boolean().default(false),
  dailyCap: z.number().int().min(0).max(5).default(2),
});

export const xhsOpsInteractionConfigSchema = z.object({
  like: xhsOpsInteractionRuleSchema.default({
    enabled: true,
    dailyCap: 5,
    ratioPercent: 10,
  }),
  collect: xhsOpsInteractionRuleSchema.default({
    enabled: false,
    dailyCap: 2,
    ratioPercent: 3,
  }),
  follow: xhsOpsInteractionRuleSchema.default({
    enabled: false,
    dailyCap: 0,
    ratioPercent: 0,
  }),
  /**
   * 评论（P3-1，评审 2026-09-06）：默认关；开启后也只是允许进入审核队列，
   * 每一条都要人工批准，由独立的评论任务发出。硬上限 5，默认 2。
   */
  comment: xhsOpsCommentRuleSchema.default({}),
});

export const xhsOpsBrowseDefaultsSchema = z.object({
  dwellSecMin: z.number().int().min(5).max(60).default(10),
  dwellSecMax: z.number().int().min(5).max(120).default(25),
  searchRatioPercent: z.number().int().min(0).max(100).default(80),
  postsPerKeyword: z.number().int().min(1).max(8).default(5),
  homeFeedCount: z.number().int().min(0).max(12).default(6),
  /**
   * 日目标篇数（P2-3，可选）。0 = 不设目标，按 每词篇数 × 词数 走；>0 时当日
   * 计划按 dailySegments 拆成几段，每段总量 ≈ 目标 ÷ 段数。已拍板一期 30–50。
   */
  dailyTargetPosts: z.number().int().min(0).max(150).default(0),
  /** 当日拆成几个 run 串行执行（上午/下午/晚上）；1 = 单 run（默认）。 */
  dailySegments: z.number().int().min(1).max(3).default(1),
});

// ─── Project ─────────────────────────────────────────────────────────────────

export const xhsOpsProjectBusinessSchema = z.object({
  industry: text(),
  product: text(),
  regions: textList(),
  sellingPoints: textList(),
  priceBand: text(),
  scene: text(),
});

export const xhsOpsProjectAudienceSchema = z.object({
  ageRange: text(),
  genderRatio: text(),
  regions: textList(),
  occupations: textList(),
  spendingPower: text(),
  knownInterests: textList(),
  painPoints: textList(),
});

export const xhsOpsProjectOpsNotesSchema = z.object({
  forbiddenTopics: textList(),
  boostKeywords: textList(),
  avoidContentTypes: textList(),
});

export const xhsOpsProfileSchema = z.object({
  summary: text(),
  base: z
    .object({
      ageRange: text(),
      genderRatio: text(),
      regions: textList(),
    })
    .default({}),
  verticalInterests: textList(),
  generalInterests: textList(),
  confirmedAt: z.string().nullable().default(null),
  updatedAt: z.string(),
});

/** Profile as accepted on write: `updatedAt` is filled server-side when absent. */
export const xhsOpsProfileInputSchema = xhsOpsProfileSchema.extend({
  updatedAt: z.string().optional(),
});

/**
 * 每日自动执行（P2-4）。controller 内的 XhsOpsScheduler 每分钟检查：启用且本地
 * 时间 ≥ `time` 且今天还没触发 → 对项目下每个已绑设备的账号 plan-suggest →
 * createRun → startRun（同一手机的 run 由设备队列串行）。OpenClaw cron 只能投递
 * agentTurn、带不了账目，所以这里自己做胶水。
 */
export const xhsOpsScheduleSchema = z.object({
  enabled: z.boolean().default(false),
  /** 本地时间 HH:mm */
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("10:00"),
  /** 最近一次触发的本地日期 YYYY-MM-DD；一天只触发一次。 */
  lastTriggeredDate: z.string().nullable().default(null),
  /** 最近一次触发的结果摘要（给运营看）。 */
  lastResult: z.string().nullable().default(null),
});

export const xhsOpsProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  business: xhsOpsProjectBusinessSchema.default({}),
  audience: xhsOpsProjectAudienceSchema.default({}),
  opsNotes: xhsOpsProjectOpsNotesSchema.default({}),
  profile: xhsOpsProfileSchema.nullable().default(null),
  schedule: xhsOpsScheduleSchema.default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const xhsOpsProjectCreateSchema = xhsOpsProjectSchema
  .omit({ id: true, createdAt: true, updatedAt: true, profile: true })
  .extend({ profile: xhsOpsProfileInputSchema.nullable().optional() });

export const xhsOpsProjectUpdateSchema = xhsOpsProjectCreateSchema.partial();

// ─── Account ─────────────────────────────────────────────────────────────────

export const xhsOpsInterestPoolSchema = z.object({
  core: textList(),
  extended: textList(),
  general: textList(),
});

/**
 * 人设人口学字段（运营文档：每个人设应含年龄、性别、地区、职业/身份、生活状态）。
 * 结构化后才能核对"整体分布贴合目标消费者"和人设差异；全部可空，兼容旧数据。
 */
export const xhsOpsPersonaSchema = z.object({
  age: text(),
  gender: text(),
  region: text(),
  occupation: text(),
  lifeStatus: text(),
});

/**
 * 账号基础资料草稿（运营文档 §四「账号基础资料」+ 脑图「素材生成/账号创建」）：
 * 昵称/简介由服务端文本生成；头像/背景图各生成 3 张备选（已拍板：AI 生成备选、
 * 人工上传仅兜底），运营点选后「应用到手机」走 xhs profile 子技能改资料。
 */
export const xhsOpsProfileApplyStatusSchema = z.enum([
  "applied",
  "partial",
  "failed",
]);

export const xhsOpsProfileDraftSchema = z.object({
  nickname: text(),
  /** 星座+MBTI / 自我介绍 / 兴趣介绍 三段，≤100 字 */
  bio: text(),
  /** media 目录下的绝对路径 */
  avatarCandidates: textList(),
  coverCandidates: textList(),
  avatarPath: z.string().nullable().default(null),
  coverPath: z.string().nullable().default(null),
  generatedAt: z.string().nullable().default(null),
  appliedAt: z.string().nullable().default(null),
  applyStatus: xhsOpsProfileApplyStatusSchema.nullable().default(null),
  /** 手机回报摘要（各字段 done/failed/skipped + 一句话），不含资料具体值 */
  applyResult: z.string().nullable().default(null),
});

export const xhsOpsProfilePartSchema = z.enum(["text", "avatar", "cover"]);
export const xhsOpsProfileGenerateBodySchema = z.object({
  parts: z.array(xhsOpsProfilePartSchema).min(1).max(3),
});

export const xhsOpsAccountSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** 账号定位名，如"北京亲子周末号" */
  label: z.string().min(1).max(40),
  /** 一句话内容方向与风格 */
  positioning: text(),
  persona: xhsOpsPersonaSchema.default({}),
  profileDraft: xhsOpsProfileDraftSchema.default({}),
  deviceId: z.string().nullable().default(null),
  deviceName: z.string().nullable().default(null),
  interestPool: xhsOpsInterestPoolSchema.default({}),
  interaction: xhsOpsInteractionConfigSchema.default({}),
  browseDefaults: xhsOpsBrowseDefaultsSchema.default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const xhsOpsAccountCreateSchema = xhsOpsAccountSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/** An account never moves between projects, so `projectId` is not patchable. */
export const xhsOpsAccountUpdateSchema = xhsOpsAccountCreateSchema
  .omit({ projectId: true })
  .partial();

// ─── Run ─────────────────────────────────────────────────────────────────────

export const xhsOpsAnomalyTypeSchema = z.enum([
  "no_results",
  "load_failed",
  "login_required",
  "account_restricted",
  "rate_limited",
  "content_mismatch",
  "interrupted",
  "other",
]);

export const xhsOpsAnomalySchema = z.object({
  type: xhsOpsAnomalyTypeSchema,
  detail: text(),
});

export const xhsOpsInteractionCountsSchema = z.object({
  like: count(),
  collect: count(),
  follow: count(),
  /** P3-1 D2：评论 run 里成功发出的评论数；浏览 run 不带此字段。 */
  comment: z.number().int().min(0).optional(),
});

export const xhsOpsRunChunkModeSchema = z.enum(["search", "home", "comment"]);

export const xhsOpsRunChunkStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

export const xhsOpsRunPostActionSchema = z.enum([
  "like",
  "collect",
  "follow",
  "none",
  /** 点进去但没计数（评论不足/广告）——手机实际会报，保留而不是抹成 none。 */
  "skip",
]);

export const xhsOpsRunPostSchema = z.object({
  title: z.string(),
  author: z.string(),
  action: xhsOpsRunPostActionSchema,
  commentsRead: count(),
  /** P3-1 D3：手机只标注"这帖值不值得评"，不写评论。 */
  commentWorthy: z.boolean().default(false),
  /** 正文一句话摘要（a11y 文本），给桌面生成评论候选用。 */
  summary: z.string().max(120).default(""),
});

export const xhsOpsRunChunkSchema = z.object({
  index: z.number().int().min(0),
  mode: xhsOpsRunChunkModeSchema,
  keyword: z.string().nullable(),
  plannedCount: z.number().int().min(0),
  status: xhsOpsRunChunkStatusSchema,
  taskId: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  browsed: count(),
  skipped: count(),
  interactions: xhsOpsInteractionCountsSchema.default({}),
  anomalies: z.array(xhsOpsAnomalySchema).default([]),
  observation: z.string().nullable().default(null),
  posts: z.array(xhsOpsRunPostSchema).default([]),
  /** mode=comment 时：本 chunk 要发的评论草稿 id（一条评论一个 chunk）。 */
  commentDraftId: z.string().nullable().optional(),
  /** Raw phone message, truncated to 4000 chars. */
  message: z.string().nullable().default(null),
  totalSteps: z.number().int().nullable().default(null),
  finalScreenshot: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});

export const xhsOpsRunPlanKeywordSchema = z.object({
  keyword: z.string().min(1).max(40),
  count: z.number().int().min(1).max(8),
});

/** 评论 run 的一条待发评论（来自 approved 草稿的快照）。 */
export const xhsOpsRunPlanCommentSchema = z.object({
  draftId: z.string(),
  postTitle: z.string().max(60),
  postAuthor: z.string().max(40),
  text: z.string().min(1).max(30),
});

export const xhsOpsRunPlanSchema = z.object({
  /** 省略/browse = 搜索/首页浏览；comment = 发人工审核通过的评论（P3-1 D2）。 */
  kind: z.enum(["browse", "comment"]).optional(),
  /** browse 至少 1 个关键词（由服务校验）；comment 为空。 */
  keywords: z.array(xhsOpsRunPlanKeywordSchema).max(8),
  homeFeedCount: z.number().int().min(0).max(12),
  dwellSecMin: z.number().int().min(1),
  dwellSecMax: z.number().int().min(1),
  interaction: xhsOpsInteractionConfigSchema,
  comments: z.array(xhsOpsRunPlanCommentSchema).max(5).optional(),
});

export const xhsOpsRunSummarySchema = z.object({
  plannedTotal: count(),
  browsedTotal: count(),
  searchBrowsed: count(),
  homeBrowsed: count(),
  interactions: xhsOpsInteractionCountsSchema.default({}),
  anomalyCount: count(),
  durationMs: z.number().int().nullable().default(null),
});

/** 当日多段执行时本 run 是第几段（P2-3）；单 run 为 null。 */
export const xhsOpsRunSegmentSchema = z.object({
  index: z.number().int().min(1).max(3),
  count: z.number().int().min(1).max(3),
});

export const xhsOpsRunStatusSchema = z.enum([
  "planned",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const xhsOpsRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  accountId: z.string(),
  deviceId: z.string(),
  /** Snapshot of the account label at plan time. */
  accountLabel: z.string(),
  date: xhsOpsDateSchema,
  status: xhsOpsRunStatusSchema,
  plan: xhsOpsRunPlanSchema,
  segment: xhsOpsRunSegmentSchema.nullable().default(null),
  /**
   * 设备队列（P2-4）：startRun 时同一手机上已有 xhs-ops run 在跑，本 run 保持
   * `planned` 并记下排在谁后面；前一个结束后由服务自动启动并清空此字段。
   */
  queuedBehindRunId: z.string().nullable().default(null),
  chunks: z.array(xhsOpsRunChunkSchema).default([]),
  summary: xhsOpsRunSummarySchema.default({}),
  /** 运营观察（人工填写） */
  notes: text(),
  error: z.string().nullable().default(null),
  createdAt: z.string(),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  updatedAt: z.string(),
});

export const xhsOpsRunCreateSchema = z.object({
  projectId: z.string().min(1),
  accountId: z.string().min(1),
  /** Defaults to today in the controller's local time zone. */
  date: xhsOpsDateSchema.optional(),
  plan: xhsOpsRunPlanSchema,
  segment: xhsOpsRunSegmentSchema.nullable().optional(),
});

export const xhsOpsRunUpdateSchema = z.object({
  notes: z.string().max(4000).optional(),
});

/** 桌面按兴趣池生成的当日计划建议（GET /projects/{id}/plan-suggest）。 */
export const xhsOpsPlanSuggestionSchema = z.object({
  accountId: z.string(),
  accountLabel: z.string(),
  keywords: z.array(xhsOpsRunPlanKeywordSchema),
  homeFeedCount: z.number().int().min(0).max(12),
  dwellSecMin: z.number().int().min(1),
  dwellSecMax: z.number().int().min(1),
  interaction: xhsOpsInteractionConfigSchema,
  /** 生成依据，给运营看：轮换第几轮、避开了什么、比例怎么算的。 */
  rationale: z.array(z.string()),
  /** 多段执行时的段序（P2-3）；单 run 为 null。 */
  segment: xhsOpsRunSegmentSchema.nullable().default(null),
});

export const xhsOpsPlanSuggestResponseSchema = z.object({
  plans: z.array(xhsOpsPlanSuggestionSchema),
});

export const xhsOpsRunListQuerySchema = z.object({
  projectId: z.string().optional(),
  accountId: z.string().optional(),
  date: xhsOpsDateSchema.optional(),
});

// ─── Comment drafts (P3-1 D1) ───────────────────────────────────────────────

/**
 * 评论草稿状态机：pending → approved | rejected；approved → sent | failed；
 * 当天未执行的 approved 次日 expired（帖子时效）。任何一条发出去的评论都必须
 * 先有 approved 记录，且 text 与手机 TYPE 的文字逐字一致（D2 的策略白名单）。
 */
export const xhsOpsCommentStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "sent",
  "failed",
  "expired",
]);

export const xhsOpsCommentPostSchema = z.object({
  title: z.string().max(60),
  author: z.string().max(40),
  summary: z.string().max(120).default(""),
});

export const xhsOpsCommentDraftSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  accountId: z.string(),
  deviceId: z.string().nullable().default(null),
  /** 候选来自哪次浏览 run 的哪篇帖子。 */
  sourceRunId: z.string(),
  sourceChunkIndex: z.number().int().min(0),
  sourcePostIndex: z.number().int().min(0),
  post: xhsOpsCommentPostSchema,
  /** 桌面生成的候选（已过硬校验），运营点选或改写。 */
  candidates: z.array(z.string().max(30)).max(5).default([]),
  /** 审核后的最终文案；批准前为 null。 */
  text: z.string().max(30).nullable().default(null),
  status: xhsOpsCommentStatusSchema.default("pending"),
  reviewedAt: z.string().nullable().default(null),
  reviewNote: text(),
  sentRunId: z.string().nullable().default(null),
  sentAt: z.string().nullable().default(null),
  sendResult: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const xhsOpsCommentGenerateBodySchema = z.object({
  /** 省略 = 该 run 里所有 commentWorthy 的帖子。 */
  posts: z
    .array(
      z.object({
        chunkIndex: z.number().int().min(0),
        postIndex: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(10)
    .optional(),
});

export const xhsOpsCommentReviewBodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  /** 批准时的最终文案；省略则取第一条候选。 */
  text: z.string().max(30).optional(),
  note: z.string().max(200).optional(),
});

export const xhsOpsCommentListQuerySchema = z.object({
  status: xhsOpsCommentStatusSchema.optional(),
  accountId: z.string().optional(),
});

/** 桌面配额：cap = min(dailyCap, 5, floor(今日浏览/8))；remaining = cap − 今日已发 − 已批未发。 */
export const xhsOpsCommentQuotaSchema = z.object({
  accountId: z.string(),
  accountLabel: z.string(),
  date: xhsOpsDateSchema,
  enabled: z.boolean(),
  dailyCap: z.number().int(),
  todayBrowsed: z.number().int(),
  byBrowse: z.number().int(),
  cap: z.number().int(),
  sentToday: z.number().int(),
  approvedPending: z.number().int(),
  remaining: z.number().int(),
});

export const xhsOpsCommentListResponseSchema = z.object({
  drafts: z.array(xhsOpsCommentDraftSchema),
  quotas: z.array(xhsOpsCommentQuotaSchema),
});
export const xhsOpsCommentResponseSchema = z.object({
  draft: xhsOpsCommentDraftSchema,
});
export const xhsOpsCommentGenerateResponseSchema = z.object({
  drafts: z.array(xhsOpsCommentDraftSchema),
  skipped: z.array(z.string()),
});
export const xhsOpsCommentQuotaResponseSchema = z.object({
  quota: xhsOpsCommentQuotaSchema,
});

// ─── Persistence root ────────────────────────────────────────────────────────

export const xhsOpsStoreDataSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  projects: z.array(xhsOpsProjectSchema).default([]),
  accounts: z.array(xhsOpsAccountSchema).default([]),
  runs: z.array(xhsOpsRunSchema).default([]),
  comments: z.array(xhsOpsCommentDraftSchema).default([]),
});

// ─── REST response envelopes ─────────────────────────────────────────────────

export const xhsOpsProjectListResponseSchema = z.object({
  projects: z.array(xhsOpsProjectSchema),
});
export const xhsOpsProjectResponseSchema = z.object({
  project: xhsOpsProjectSchema,
});
export const xhsOpsAccountListResponseSchema = z.object({
  accounts: z.array(xhsOpsAccountSchema),
});
export const xhsOpsAccountResponseSchema = z.object({
  account: xhsOpsAccountSchema,
});
export const xhsOpsRunListResponseSchema = z.object({
  runs: z.array(xhsOpsRunSchema),
});
export const xhsOpsRunResponseSchema = z.object({ run: xhsOpsRunSchema });

// ─── Types ───────────────────────────────────────────────────────────────────

export type XhsOpsInteractionRule = z.infer<typeof xhsOpsInteractionRuleSchema>;
export type XhsOpsInteractionConfig = z.infer<
  typeof xhsOpsInteractionConfigSchema
>;
export type XhsOpsBrowseDefaults = z.infer<typeof xhsOpsBrowseDefaultsSchema>;
export type XhsOpsProjectBusiness = z.infer<typeof xhsOpsProjectBusinessSchema>;
export type XhsOpsProjectAudience = z.infer<typeof xhsOpsProjectAudienceSchema>;
export type XhsOpsProjectOpsNotes = z.infer<typeof xhsOpsProjectOpsNotesSchema>;
export type XhsOpsProfile = z.infer<typeof xhsOpsProfileSchema>;
export type XhsOpsProject = z.infer<typeof xhsOpsProjectSchema>;
export type XhsOpsProjectCreate = z.infer<typeof xhsOpsProjectCreateSchema>;
export type XhsOpsProjectCreateInput = z.input<
  typeof xhsOpsProjectCreateSchema
>;
export type XhsOpsProjectUpdate = z.infer<typeof xhsOpsProjectUpdateSchema>;
export type XhsOpsProjectUpdateInput = z.input<
  typeof xhsOpsProjectUpdateSchema
>;
export type XhsOpsInterestPool = z.infer<typeof xhsOpsInterestPoolSchema>;
export type XhsOpsAccount = z.infer<typeof xhsOpsAccountSchema>;
export type XhsOpsAccountCreate = z.infer<typeof xhsOpsAccountCreateSchema>;
export type XhsOpsAccountCreateInput = z.input<
  typeof xhsOpsAccountCreateSchema
>;
export type XhsOpsAccountUpdate = z.infer<typeof xhsOpsAccountUpdateSchema>;
export type XhsOpsAccountUpdateInput = z.input<
  typeof xhsOpsAccountUpdateSchema
>;
export type XhsOpsAnomalyType = z.infer<typeof xhsOpsAnomalyTypeSchema>;
export type XhsOpsAnomaly = z.infer<typeof xhsOpsAnomalySchema>;
export type XhsOpsInteractionCounts = z.infer<
  typeof xhsOpsInteractionCountsSchema
>;
export type XhsOpsRunChunkMode = z.infer<typeof xhsOpsRunChunkModeSchema>;
export type XhsOpsRunChunkStatus = z.infer<typeof xhsOpsRunChunkStatusSchema>;
export type XhsOpsRunPostAction = z.infer<typeof xhsOpsRunPostActionSchema>;
export type XhsOpsRunPost = z.infer<typeof xhsOpsRunPostSchema>;
export type XhsOpsRunChunk = z.infer<typeof xhsOpsRunChunkSchema>;
export type XhsOpsRunPlanKeyword = z.infer<typeof xhsOpsRunPlanKeywordSchema>;
export type XhsOpsRunPlan = z.infer<typeof xhsOpsRunPlanSchema>;
export type XhsOpsRunPlanInput = z.input<typeof xhsOpsRunPlanSchema>;
export type XhsOpsRunSummary = z.infer<typeof xhsOpsRunSummarySchema>;
export type XhsOpsRunStatus = z.infer<typeof xhsOpsRunStatusSchema>;
export type XhsOpsRunSegment = z.infer<typeof xhsOpsRunSegmentSchema>;
export type XhsOpsRunPlanComment = z.infer<typeof xhsOpsRunPlanCommentSchema>;
export type XhsOpsSchedule = z.infer<typeof xhsOpsScheduleSchema>;
export type XhsOpsCommentRule = z.infer<typeof xhsOpsCommentRuleSchema>;
export type XhsOpsCommentStatus = z.infer<typeof xhsOpsCommentStatusSchema>;
export type XhsOpsCommentDraft = z.infer<typeof xhsOpsCommentDraftSchema>;
export type XhsOpsCommentGenerateBody = z.infer<
  typeof xhsOpsCommentGenerateBodySchema
>;
export type XhsOpsCommentReviewBody = z.infer<
  typeof xhsOpsCommentReviewBodySchema
>;
export type XhsOpsCommentListQuery = z.infer<
  typeof xhsOpsCommentListQuerySchema
>;
export type XhsOpsCommentQuota = z.infer<typeof xhsOpsCommentQuotaSchema>;
export type XhsOpsRun = z.infer<typeof xhsOpsRunSchema>;
export type XhsOpsRunCreate = z.infer<typeof xhsOpsRunCreateSchema>;
export type XhsOpsRunCreateInput = z.input<typeof xhsOpsRunCreateSchema>;
export type XhsOpsRunUpdate = z.infer<typeof xhsOpsRunUpdateSchema>;
export type XhsOpsRunListQuery = z.infer<typeof xhsOpsRunListQuerySchema>;
export type XhsOpsStoreData = z.infer<typeof xhsOpsStoreDataSchema>;
export type XhsOpsProjectListResponse = z.infer<
  typeof xhsOpsProjectListResponseSchema
>;
export type XhsOpsProjectResponse = z.infer<typeof xhsOpsProjectResponseSchema>;
export type XhsOpsAccountListResponse = z.infer<
  typeof xhsOpsAccountListResponseSchema
>;
export type XhsOpsAccountResponse = z.infer<typeof xhsOpsAccountResponseSchema>;
export type XhsOpsRunListResponse = z.infer<typeof xhsOpsRunListResponseSchema>;
export type XhsOpsRunResponse = z.infer<typeof xhsOpsRunResponseSchema>;

export type XhsOpsPlanSuggestion = z.infer<typeof xhsOpsPlanSuggestionSchema>;
export type XhsOpsProfileDraft = z.infer<typeof xhsOpsProfileDraftSchema>;
export type XhsOpsProfilePart = z.infer<typeof xhsOpsProfilePartSchema>;
export type XhsOpsProfileApplyStatus = z.infer<
  typeof xhsOpsProfileApplyStatusSchema
>;
