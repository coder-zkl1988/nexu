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
  /** Phase 1: comments are never enabled. */
  comment: z.object({ enabled: z.literal(false) }).default({ enabled: false }),
});

export const xhsOpsBrowseDefaultsSchema = z.object({
  dwellSecMin: z.number().int().min(5).max(60).default(10),
  dwellSecMax: z.number().int().min(5).max(120).default(25),
  searchRatioPercent: z.number().int().min(0).max(100).default(80),
  postsPerKeyword: z.number().int().min(1).max(8).default(5),
  homeFeedCount: z.number().int().min(0).max(12).default(6),
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

export const xhsOpsProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  business: xhsOpsProjectBusinessSchema.default({}),
  audience: xhsOpsProjectAudienceSchema.default({}),
  opsNotes: xhsOpsProjectOpsNotesSchema.default({}),
  profile: xhsOpsProfileSchema.nullable().default(null),
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

export const xhsOpsAccountSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** 账号定位名，如"北京亲子周末号" */
  label: z.string().min(1).max(40),
  /** 一句话内容方向与风格 */
  positioning: text(),
  persona: xhsOpsPersonaSchema.default({}),
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
});

export const xhsOpsRunChunkModeSchema = z.enum(["search", "home"]);

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
]);

export const xhsOpsRunPostSchema = z.object({
  title: z.string(),
  author: z.string(),
  action: xhsOpsRunPostActionSchema,
  commentsRead: count(),
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

export const xhsOpsRunPlanSchema = z.object({
  keywords: z.array(xhsOpsRunPlanKeywordSchema).min(1).max(8),
  homeFeedCount: z.number().int().min(0).max(12),
  dwellSecMin: z.number().int().min(1),
  dwellSecMax: z.number().int().min(1),
  interaction: xhsOpsInteractionConfigSchema,
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
});

export const xhsOpsPlanSuggestResponseSchema = z.object({
  plans: z.array(xhsOpsPlanSuggestionSchema),
});

export const xhsOpsRunListQuerySchema = z.object({
  projectId: z.string().optional(),
  accountId: z.string().optional(),
  date: xhsOpsDateSchema.optional(),
});

// ─── Persistence root ────────────────────────────────────────────────────────

export const xhsOpsStoreDataSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  projects: z.array(xhsOpsProjectSchema).default([]),
  accounts: z.array(xhsOpsAccountSchema).default([]),
  runs: z.array(xhsOpsRunSchema).default([]),
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
