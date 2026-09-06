/**
 * Typed wrappers over the xhs-ops REST contract (scratchpad spec §3).
 *
 * Every xhs-ops HTTP call in the web app goes through this module. The routes
 * are not yet in the generated SDK (apps/web/lib/api/sdk.gen.ts), so the calls
 * use the same hey-api client the SDK uses (`@/lib/api` configures baseUrl and
 * credentials) with the contract paths spelled out here. Once
 * `pnpm generate-types` produces getApiV1XhsOps* functions, switching is a
 * one-file change: replace the `client.*` calls below with the SDK functions.
 */
import { client } from "@/lib/api";
import type {
  XhsOpsAccount,
  XhsOpsAccountCreateInput,
  XhsOpsAccountUpdateInput,
  XhsOpsCommentDraft,
  XhsOpsCommentQuota,
  XhsOpsCommentStatus,
  XhsOpsPlanSuggestion,
  XhsOpsProfilePart,
  XhsOpsProject,
  XhsOpsProjectCreateInput,
  XhsOpsProjectUpdateInput,
  XhsOpsRun,
  XhsOpsRunCreateInput,
  XhsOpsRunListFilter,
} from "./xhs-ops-types";

const BASE = "/api/v1/xhs-ops";

export class XhsOpsApiError extends Error {
  /** HTTP status when the server answered; null when the request never landed. */
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "XhsOpsApiError";
    this.status = status;
  }
}

/** Accepts `{ error: { code, message } }`, `{ error: "…" }`, `{ message }`, or a string. */
function extractErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const nested = record.error;
    if (typeof nested === "string" && nested.trim()) return nested;
    if (nested && typeof nested === "object") {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }
  return fallback;
}

interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response?: Response;
}

async function unwrap<T>(
  call: () => Promise<ApiResult<T>>,
  fallback: string,
): Promise<T> {
  let result: ApiResult<T>;
  try {
    result = await call();
  } catch (err) {
    // fetch itself rejected — controller down, network gone, CORS.
    const detail =
      err instanceof Error && err.message ? `：${err.message}` : "";
    throw new XhsOpsApiError(`无法连接桌面端服务${detail}`, null);
  }
  if (result.error !== undefined || result.data === undefined) {
    const status = result.response?.status ?? null;
    const message =
      status === 404 && result.error === undefined
        ? "接口不存在（桌面端尚未更新到支持小红书运营的版本）"
        : extractErrorMessage(result.error, fallback);
    throw new XhsOpsApiError(message, status);
  }
  return result.data;
}

/** Same as unwrap but tolerates an empty success body (DELETE). */
async function unwrapVoid(
  call: () => Promise<ApiResult<unknown>>,
  fallback: string,
): Promise<void> {
  let result: ApiResult<unknown>;
  try {
    result = await call();
  } catch (err) {
    const detail =
      err instanceof Error && err.message ? `：${err.message}` : "";
    throw new XhsOpsApiError(`无法连接桌面端服务${detail}`, null);
  }
  if (result.error !== undefined) {
    throw new XhsOpsApiError(
      extractErrorMessage(result.error, fallback),
      result.response?.status ?? null,
    );
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

export const xhsOpsApi = {
  // ── Projects ──
  async listProjects(): Promise<XhsOpsProject[]> {
    const data = await unwrap(
      () =>
        client.get<{ projects: XhsOpsProject[] }>({ url: `${BASE}/projects` }),
      "项目列表加载失败",
    );
    return data.projects ?? [];
  },

  async getProject(projectId: string): Promise<XhsOpsProject> {
    const data = await unwrap(
      () =>
        client.get<{ project: XhsOpsProject }>({
          url: `${BASE}/projects/${enc(projectId)}`,
        }),
      "项目加载失败",
    );
    return data.project;
  },

  async createProject(input: XhsOpsProjectCreateInput): Promise<XhsOpsProject> {
    const data = await unwrap(
      () =>
        client.post<{ project: XhsOpsProject }>({
          url: `${BASE}/projects`,
          body: input,
        }),
      "项目创建失败",
    );
    return data.project;
  },

  async updateProject(
    projectId: string,
    patch: XhsOpsProjectUpdateInput,
  ): Promise<XhsOpsProject> {
    const data = await unwrap(
      () =>
        client.patch<{ project: XhsOpsProject }>({
          url: `${BASE}/projects/${enc(projectId)}`,
          body: patch,
        }),
      "项目保存失败",
    );
    return data.project;
  },

  async deleteProject(projectId: string): Promise<void> {
    await unwrapVoid(
      () => client.delete({ url: `${BASE}/projects/${enc(projectId)}` }),
      "项目删除失败",
    );
  },

  // ── Accounts ──
  async listAccounts(projectId: string): Promise<XhsOpsAccount[]> {
    const data = await unwrap(
      () =>
        client.get<{ accounts: XhsOpsAccount[] }>({
          url: `${BASE}/projects/${enc(projectId)}/accounts`,
        }),
      "账号列表加载失败",
    );
    return data.accounts ?? [];
  },

  async createAccount(
    projectId: string,
    input: XhsOpsAccountCreateInput,
  ): Promise<XhsOpsAccount> {
    const data = await unwrap(
      () =>
        client.post<{ account: XhsOpsAccount }>({
          url: `${BASE}/projects/${enc(projectId)}/accounts`,
          body: input,
        }),
      "账号创建失败",
    );
    return data.account;
  },

  async getAccount(accountId: string): Promise<XhsOpsAccount> {
    const data = await unwrap(
      () =>
        client.get<{ account: XhsOpsAccount }>({
          url: `${BASE}/accounts/${enc(accountId)}`,
        }),
      "账号加载失败",
    );
    return data.account;
  },

  async updateAccount(
    accountId: string,
    patch: XhsOpsAccountUpdateInput,
  ): Promise<XhsOpsAccount> {
    const data = await unwrap(
      () =>
        client.patch<{ account: XhsOpsAccount }>({
          url: `${BASE}/accounts/${enc(accountId)}`,
          body: patch,
        }),
      "账号保存失败",
    );
    return data.account;
  },

  async deleteAccount(accountId: string): Promise<void> {
    await unwrapVoid(
      () => client.delete({ url: `${BASE}/accounts/${enc(accountId)}` }),
      "账号删除失败",
    );
  },

  // ── Profile draft (P2-1) ──
  async generateProfileDraft(
    accountId: string,
    parts: XhsOpsProfilePart[],
  ): Promise<XhsOpsAccount> {
    const data = await unwrap(
      () =>
        client.post<{ account: XhsOpsAccount }>({
          url: `${BASE}/accounts/${enc(accountId)}/profile-draft/generate`,
          body: { parts },
        }),
      "资料生成失败",
    );
    return data.account;
  },

  async applyProfileDraft(accountId: string): Promise<XhsOpsAccount> {
    const data = await unwrap(
      () =>
        client.post<{ account: XhsOpsAccount }>({
          url: `${BASE}/accounts/${enc(accountId)}/profile-draft/apply`,
          body: {},
        }),
      "资料应用到手机失败",
    );
    return data.account;
  },

  // ── Comment review queue (P3-1 D1) ──
  async listComments(
    projectId: string,
    filter: { status?: XhsOpsCommentStatus; accountId?: string } = {},
  ): Promise<{ drafts: XhsOpsCommentDraft[]; quotas: XhsOpsCommentQuota[] }> {
    const query: Record<string, string> = {};
    if (filter.status) query.status = filter.status;
    if (filter.accountId) query.accountId = filter.accountId;
    return unwrap(
      () =>
        client.get<{
          drafts: XhsOpsCommentDraft[];
          quotas: XhsOpsCommentQuota[];
        }>({
          url: `${BASE}/projects/${enc(projectId)}/comments`,
          query,
        }),
      "评论队列加载失败",
    );
  },

  async generateComments(
    runId: string,
    posts?: Array<{ chunkIndex: number; postIndex: number }>,
  ): Promise<{ drafts: XhsOpsCommentDraft[]; skipped: string[] }> {
    return unwrap(
      () =>
        client.post<{ drafts: XhsOpsCommentDraft[]; skipped: string[] }>({
          url: `${BASE}/runs/${enc(runId)}/comments/generate`,
          body: posts ? { posts } : {},
        }),
      "评论候选生成失败",
    );
  },

  async reviewComment(
    commentId: string,
    body: { decision: "approved" | "rejected"; text?: string; note?: string },
  ): Promise<XhsOpsCommentDraft> {
    const data = await unwrap(
      () =>
        client.post<{ draft: XhsOpsCommentDraft }>({
          url: `${BASE}/comments/${enc(commentId)}/review`,
          body,
        }),
      "评论审核失败",
    );
    return data.draft;
  },

  /** P3-1 D2：把账号已批准的评论打成评论 run 并启动（同一手机排队串行）。 */
  async createCommentRun(
    projectId: string,
    accountId: string,
    draftIds?: string[],
  ): Promise<XhsOpsRun> {
    const data = await unwrap(
      () =>
        client.post<{ run: XhsOpsRun }>({
          url: `${BASE}/projects/${enc(projectId)}/comment-runs`,
          body: draftIds ? { accountId, draftIds } : { accountId },
        }),
      "评论任务派发失败",
    );
    return data.run;
  },

  // ── Plan suggestion ──
  async suggestPlans(projectId: string): Promise<XhsOpsPlanSuggestion[]> {
    const data = await unwrap(
      () =>
        client.get<{ plans: XhsOpsPlanSuggestion[] }>({
          url: `${BASE}/projects/${enc(projectId)}/plan-suggest`,
        }),
      "今日计划建议加载失败",
    );
    return data.plans ?? [];
  },

  // ── Runs ──
  async listRuns(filter: XhsOpsRunListFilter = {}): Promise<XhsOpsRun[]> {
    const query: Record<string, string> = {};
    if (filter.projectId) query.projectId = filter.projectId;
    if (filter.accountId) query.accountId = filter.accountId;
    if (filter.date) query.date = filter.date;
    const data = await unwrap(
      () =>
        client.get<{ runs: XhsOpsRun[] }>({
          url: `${BASE}/runs`,
          query,
        }),
      "运行记录加载失败",
    );
    return data.runs ?? [];
  },

  async createRun(input: XhsOpsRunCreateInput): Promise<XhsOpsRun> {
    const data = await unwrap(
      () =>
        client.post<{ run: XhsOpsRun }>({
          url: `${BASE}/runs`,
          body: input,
        }),
      "运行计划创建失败",
    );
    return data.run;
  },

  async getRun(runId: string): Promise<XhsOpsRun> {
    const data = await unwrap(
      () =>
        client.get<{ run: XhsOpsRun }>({ url: `${BASE}/runs/${enc(runId)}` }),
      "运行状态读取失败",
    );
    return data.run;
  },

  async updateRunNotes(runId: string, notes: string): Promise<XhsOpsRun> {
    const data = await unwrap(
      () =>
        client.patch<{ run: XhsOpsRun }>({
          url: `${BASE}/runs/${enc(runId)}`,
          body: { notes },
        }),
      "运营观察保存失败",
    );
    return data.run;
  },

  async startRun(runId: string): Promise<XhsOpsRun> {
    const data = await unwrap(
      () =>
        client.post<{ run: XhsOpsRun }>({
          url: `${BASE}/runs/${enc(runId)}/start`,
        }),
      "启动执行失败",
    );
    return data.run;
  },

  async cancelRun(runId: string): Promise<XhsOpsRun> {
    const data = await unwrap(
      () =>
        client.post<{ run: XhsOpsRun }>({
          url: `${BASE}/runs/${enc(runId)}/cancel`,
        }),
      "取消执行失败",
    );
    return data.run;
  },
};

/** Human-readable message for any error thrown by this module (or anything else). */
export function describeXhsOpsError(
  err: unknown,
  fallback = "请求失败",
): string {
  if (err instanceof XhsOpsApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
