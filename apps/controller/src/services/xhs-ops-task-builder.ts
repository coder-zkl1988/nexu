import {
  type XhsOpsAnomaly,
  type XhsOpsInteractionCounts,
  type XhsOpsRunPost,
  xhsOpsAnomalyTypeSchema,
  xhsOpsRunPostActionSchema,
} from "@nexu/shared";
import { z } from "zod";

// Phone task text for one xhs-ops chunk (spec §5) and the parser for the
// structured record the phone appends to its COMPLETE return (spec §6).

/** Per-chunk allowance handed to the phone, already reduced by used quota. */
export interface XhsOpsChunkQuotaEntry {
  enabled: boolean;
  /** "本次最多 k 次" — 0 renders the switch as 关 so the model cannot misread. */
  max: number;
}

export interface XhsOpsChunkQuota {
  like: XhsOpsChunkQuotaEntry;
  collect: XhsOpsChunkQuotaEntry;
  follow: XhsOpsChunkQuotaEntry;
}

export interface XhsOpsChunkTaskBase {
  label: string;
  positioning: string;
  /** 人设一句话（formatPersona 产出），空串表示未填。 */
  persona?: string;
  dwellSecMin: number;
  dwellSecMax: number;
  quota: XhsOpsChunkQuota;
}

export interface XhsOpsSearchChunkTaskInput extends XhsOpsChunkTaskBase {
  keyword: string;
  count: number;
}

export interface XhsOpsHomeChunkTaskInput extends XhsOpsChunkTaskBase {
  count: number;
}

function switchText(entry: XhsOpsChunkQuotaEntry): string {
  const on = entry.enabled && entry.max > 0;
  return `${on ? "开" : "关"}，本次最多 ${on ? entry.max : 0} 次`;
}

function interactionLine(scope: string, quota: XhsOpsChunkQuota): string {
  return (
    `互动配置（只对与${scope}强相关且真正感兴趣的少数帖子，分散不相邻，第 1–2 篇纯浏览）：` +
    `点赞 ${switchText(quota.like)}；收藏 ${switchText(quota.collect)}；关注 ${switchText(quota.follow)}；` +
    "禁止评论、禁止发布、禁止私信、禁止分享。"
  );
}

function dwellRange(input: XhsOpsChunkTaskBase): string {
  const low = Math.min(input.dwellSecMin, input.dwellSecMax);
  const high = Math.max(input.dwellSecMin, input.dwellSecMax);
  return `${low}–${high}`;
}

function browseStandardLine(
  input: XhsOpsChunkTaskBase,
  backTo: string,
): string {
  return (
    "浏览标准：每篇进入后第一动作 WAIT 2 秒；阅读正文并慢速滑到评论区至少看 3 条评论；" +
    `单篇总停留 ${dwellRange(input)} 秒，用 WAIT（1–4 秒、时长要变化）与慢滑组合凑够，不要连续 3 次以上只 WAIT 不滑动；` +
    `看完用一次 BACK 返回${backTo}并确认。`
  );
}

const COMMON_ANOMALIES =
  "页面加载失败 → 等 5 秒重试一次，仍失败记录 load_failed；" +
  "出现登录页 → 记录 login_required 并立即结束；" +
  "出现账号异常/受限提示 → 记录 account_restricted 并立即结束；" +
  "出现“操作过于频繁”类提示 → 记录 rate_limited 并立即结束（不要再互动）；";

/** 把结构化人设压成一句话进任务头："32岁·女·北京海淀·互联网产品经理·2岁娃新手妈妈"。 */
export function formatPersona(
  persona:
    | {
        age?: string;
        gender?: string;
        region?: string;
        occupation?: string;
        lifeStatus?: string;
      }
    | null
    | undefined,
): string {
  if (!persona) return "";
  return [
    persona.age,
    persona.gender,
    persona.region,
    persona.occupation,
    persona.lifeStatus,
  ]
    .map((x) => (x ?? "").trim())
    .filter((x) => x.length > 0)
    .join("·");
}

function headerLine(input: XhsOpsChunkTaskBase): string {
  const persona = (input.persona ?? "").trim();
  return (
    `【小红书内容研究任务｜账号定位：${input.label}｜` +
    (persona ? `人设：${persona}｜` : "") +
    `${input.positioning}】`
  );
}

function ledgerLine(count: number): string {
  return `记账：key_process 每篇更新 \`已浏览 x/${count}；已互动 赞a 藏b 关c；已处理：标题[动作]\`。`;
}

const RECORD_JSON_INSTRUCTION =
  "COMPLETE 的 return 先写 3–6 行人读汇报，最后一行必须是 RECORD_JSON: 加一行紧凑 JSON";

export function buildSearchChunkTask(
  input: XhsOpsSearchChunkTaskInput,
): string {
  const n = input.count;
  return [
    headerLine(input),
    `本次只处理一个关键词：搜索「${input.keyword}」，完整浏览 ${n} 篇与关键词直接相关的普通笔记（图文优先，视频可选）。`,
    browseStandardLine(input, "结果页"),
    interactionLine("关键词", input.quota),
    `异常处理：搜索无结果 → 记录 no_results 后直接结束本关键词；${COMMON_ANOMALIES}结果与关键词明显不相关 → 记录 content_mismatch，可少浏览。`,
    ledgerLine(n),
    `结束：达到 ${n} 篇或无更多相关内容时，确认回到搜索结果页，按通用规则回到桌面，然后 COMPLETE。${RECORD_JSON_INSTRUCTION}（格式见技能 research 子技能），不能省略。`,
  ].join("\n");
}

export function buildHomeChunkTask(input: XhsOpsHomeChunkTaskInput): string {
  const m = input.count;
  return [
    headerLine(input),
    `本次不搜索：在首页推荐流自然浏览 ${m} 篇（不搜索，凭兴趣挑与账号定位相关的内容，跳过广告/直播），图文优先，视频可选。`,
    browseStandardLine(input, "首页推荐流"),
    interactionLine("账号定位", input.quota),
    `异常处理：推荐流无内容或刷不出新内容 → 记录 no_results 后直接结束；${COMMON_ANOMALIES}推荐内容与账号定位明显不相关 → 记录 content_mismatch，可少浏览。`,
    ledgerLine(m),
    `结束：达到 ${m} 篇或无更多相关内容时，确认回到首页推荐流，按通用规则回到桌面，然后 COMPLETE。${RECORD_JSON_INSTRUCTION}（格式见技能 research 子技能，mode 填 home，keyword 填 null），不能省略。`,
  ].join("\n");
}

// ─── RECORD_JSON parsing (spec §6) ───────────────────────────────────────────

export const RECORD_JSON_MARKER = "RECORD_JSON:";
const MAX_POSTS = 20;
const MAX_TITLE_CHARS = 40;
const MAX_TEXT_CHARS = 500;

/** Non-negative integer; anything unparseable becomes 0. */
const lenientCount = z.preprocess((value) => {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}, z.number().int().min(0));

const lenientText = (max: number) =>
  z
    .string()
    .catch("")
    .transform((s) => s.slice(0, max));

const lenientAnomaly = z.preprocess(
  (value) => (typeof value === "string" ? { type: value, detail: "" } : value),
  z.object({
    type: xhsOpsAnomalyTypeSchema.catch("other"),
    detail: lenientText(MAX_TEXT_CHARS),
  }),
);

const lenientBoolean = z.preprocess(
  (value) => value === true || value === "true" || value === 1 || value === "1",
  z.boolean(),
);

const lenientPost = z.object({
  title: lenientText(MAX_TITLE_CHARS),
  author: lenientText(MAX_TITLE_CHARS),
  action: xhsOpsRunPostActionSchema.catch("none"),
  commentsRead: lenientCount,
  // P3-1：手机标注"值不值得评" + 一句正文摘要；旧版技能不带这两个字段。
  commentWorthy: lenientBoolean.catch(false),
  summary: lenientText(120),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Drop list entries that cannot possibly be items (null, numbers, ...). */
const objectList = (allowStrings: boolean) =>
  z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter(
            (item) =>
              isRecord(item) || (allowStrings && typeof item === "string"),
          )
        : [],
    z.array(z.unknown()),
  );

const recordJsonSchema = z.object({
  mode: z.enum(["search", "home"]).nullable().catch(null),
  keyword: z.string().nullable().catch(null),
  planned: lenientCount,
  browsed: lenientCount,
  skipped: lenientCount,
  interactions: z
    .object({ like: lenientCount, collect: lenientCount, follow: lenientCount })
    .catch({ like: 0, collect: 0, follow: 0 }),
  anomalies: objectList(true).transform((items) =>
    items.flatMap((item) => {
      const parsed = lenientAnomaly.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  posts: objectList(false).transform((items) =>
    items.slice(0, MAX_POSTS).flatMap((item) => {
      const parsed = lenientPost.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  observation: z
    .string()
    .nullable()
    .catch(null)
    .transform((s) => (s === null ? null : s.slice(0, MAX_TEXT_CHARS * 2))),
});

export interface XhsOpsRecordJson {
  mode: "search" | "home" | null;
  keyword: string | null;
  planned: number;
  browsed: number;
  skipped: number;
  interactions: XhsOpsInteractionCounts;
  anomalies: XhsOpsAnomaly[];
  posts: XhsOpsRunPost[];
  observation: string | null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value)) return value;
  } catch {
    // fall through to the trailing-sentence tolerance below
  }
  // "…} 以上为本次记录" — a trailing sentence after the JSON on the same line is
  // accepted only when the substring up to the last `}` parses on its own.
  const end = raw.lastIndexOf("}");
  if (end < 0) return null;
  try {
    const value: unknown = JSON.parse(raw.slice(0, end + 1));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Take the LAST line starting with `RECORD_JSON:` (surrounding whitespace
 * tolerated) and parse it leniently. Returns null when the marker is absent
 * or its payload is not a JSON object — callers then fall back to
 * {@link extractBrowsedFromMessage}.
 */
export function parseRecordJson(
  message: string | null | undefined,
): XhsOpsRecordJson | null {
  if (!message) return null;
  // 手机端可能把换行写成字面 "\\n"（GLM 在 tab 分隔单行格式下的习惯），
  // 此时 RECORD_JSON: 不在真实行首；先归一化，再取最后一个 marker 出现处——
  // marker 之后到下一个真实换行为止就是载荷（尾随的 [回执] 行在下一行）。
  const normalized = message.replace(/\\n/g, "\n");
  const idx = normalized.lastIndexOf(RECORD_JSON_MARKER);
  if (idx < 0) return null;
  const rest = normalized.slice(idx + RECORD_JSON_MARKER.length);
  const lineEnd = rest.indexOf("\n");
  const payload = parseJsonObject(
    (lineEnd < 0 ? rest : rest.slice(0, lineEnd)).trim(),
  );
  if (payload === null) return null;
  const parsed = recordJsonSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

const BROWSED_PATTERN = /已浏览\s*(\d+)\s*\/\s*(\d+)/g;

/** Fallback for messages without a usable RECORD_JSON: the last ledger line. */
export function extractBrowsedFromMessage(
  message: string | null | undefined,
): { browsed: number; planned: number } | null {
  if (!message) return null;
  let last: RegExpExecArray | null = null;
  for (const match of message.matchAll(BROWSED_PATTERN)) {
    last = match;
  }
  if (!last) return null;
  return {
    browsed: Number.parseInt(last[1] ?? "0", 10),
    planned: Number.parseInt(last[2] ?? "0", 10),
  };
}

// ─── 资料维护（P2-1 账号基础资料应用到手机）────────────────────────────────

export interface XhsOpsProfileApplyTaskInput {
  label: string;
  nickname?: string | null;
  bio?: string | null;
  /** 已推送到手机「Tabby」相册的文件名（不含路径） */
  avatarFilename?: string | null;
  coverFilename?: string | null;
}

export const PROFILE_JSON_MARKER = "PROFILE_JSON:";

/**
 * 按 xhs profile 子技能的纪律组织：每次只改一个字段、保存后回「我」页核对；
 * 头像/背景从刚推送的相册图片里按文件名选；未列出的字段一律不碰。
 * 结束时最后一行 PROFILE_JSON 给桌面回读各字段 done/failed/skipped。
 */
export function buildProfileApplyTask(
  input: XhsOpsProfileApplyTaskInput,
): string {
  const steps: string[] = [];
  let n = 1;
  if (input.nickname?.trim()) {
    steps.push(
      `${n++}) 名字：点「名字」进入编辑页，点输入框后**只执行一次 TYPE**，整体替换为「${input.nickname.trim()}」，点保存/完成；遇到修改次数、字符或敏感词限制就停止并原样记下提示。`,
    );
  }
  if (input.bio?.trim()) {
    steps.push(
      `${n++}) 简介：点「简介」，**只执行一次 TYPE**，整体替换为下面这段（原样输入，不改写、不追加）：\n${input.bio.trim()}`,
    );
  }
  if (input.avatarFilename) {
    steps.push(
      `${n++}) 头像：点编辑主页顶部头像/「更换头像」（不要点「背景图」）→ 从相册选择「Tabby」相册里文件名为 ${input.avatarFilename} 的图片（刚推送的那张）→ 检查裁剪预览主体正确 → 完成/保存。系统请求相册权限时选「选择部分照片和视频」只授权这张。`,
    );
  }
  if (input.coverFilename) {
    steps.push(
      `${n++}) 背景图：只点「背景图」字段（不要点头像）→ 从「Tabby」相册选文件名为 ${input.coverFilename} 的图片 → 保存。`,
    );
  }
  return [
    `【小红书资料维护任务｜账号定位：${input.label}】`,
    "AWAKE 小红书 → 底部「我」→ 头像附近的「编辑主页」（不得点底部中央「+」，那是发布入口）。按下面顺序逐项修改，**每次只改一个字段**，保存后回到「我」页核对再改下一项：",
    ...steps,
    "禁止改动小红书号、实名认证、生日、地区、职业、学校等未列出的字段；出现登录页/账号异常/验证码 → 停止并记为 failed。",
    "隐私：key_process 与汇报里不要复述名字、简介的具体内容，只记「已修改/失败/跳过」。",
    '结束：回到「我」页核对已改字段确实更新，按通用规则 HOME 回桌面后 COMPLETE。COMPLETE 的 return 先写 2–4 行人读汇报，最后一行必须是 PROFILE_JSON: 加一行紧凑 JSON：{"nickname":"done|failed|skipped","bio":"done|failed|skipped","avatar":"done|failed|skipped","cover":"done|failed|skipped","note":"一句话"}，未要求修改的字段写 skipped。',
  ].join("\n");
}

export type XhsOpsProfileFieldOutcome = "done" | "failed" | "skipped";
export interface XhsOpsProfileJson {
  nickname: XhsOpsProfileFieldOutcome;
  bio: XhsOpsProfileFieldOutcome;
  avatar: XhsOpsProfileFieldOutcome;
  cover: XhsOpsProfileFieldOutcome;
  note: string;
}

function outcome(v: unknown): XhsOpsProfileFieldOutcome {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "done" || s === "failed") return s;
  return "skipped";
}

/** 与 parseRecordJson 同样宽容：字面 \\n 归一化、marker 位置无关、尾随文本容忍。 */
export function parseProfileJson(
  message: string | null | undefined,
): XhsOpsProfileJson | null {
  if (!message) return null;
  const normalized = message.replace(/\\n/g, "\n");
  const idx = normalized.lastIndexOf(PROFILE_JSON_MARKER);
  if (idx < 0) return null;
  const rest = normalized.slice(idx + PROFILE_JSON_MARKER.length);
  const lineEnd = rest.indexOf("\n");
  const payload = parseJsonObject(
    (lineEnd < 0 ? rest : rest.slice(0, lineEnd)).trim(),
  );
  if (payload === null) return null;
  return {
    nickname: outcome(payload.nickname),
    bio: outcome(payload.bio),
    avatar: outcome(payload.avatar),
    cover: outcome(payload.cover),
    note: typeof payload.note === "string" ? payload.note.slice(0, 200) : "",
  };
}
