import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DeviceExecuteTaskBody,
  DevicePushMediaBody,
  DevicePushMediaResponse,
  TaskResult,
  XhsOpsAccount,
  XhsOpsProfileApplyStatus,
  XhsOpsProfileDraft,
  XhsOpsProfilePart,
  XhsOpsProject,
} from "@nexu/shared";
import type { XhsOpsStore } from "../store/xhs-ops-store.js";
import type { DeviceControlService } from "./device-control-service.js";
import {
  XHS_PACKAGE,
  XHS_TASK_POLICY,
  XhsOpsError,
} from "./xhs-ops-run-service.js";
import {
  buildProfileApplyTask,
  formatPersona,
  parseProfileJson,
} from "./xhs-ops-task-builder.js";

/**
 * 账号基础资料：服务端生成（昵称/简介走文本生成；头像/背景各 3 张备选走图片
 * 生成）+ 应用到手机（把选中的图推到「Tabby」相册，再下发资料维护任务）。
 * 生成不经过聊天 agent——MediaGenerationService 的 utility lane 已经够用，
 * 且结果直接落库，运营在组件里点选。
 */

export interface XhsOpsProfileMedia {
  generateImage(input: {
    prompt: string;
    count?: number;
    aspectRatio?: string;
    quality?: "auto" | "high" | "medium" | "low";
  }): Promise<{ path: string; items: Array<{ path: string }> }>;
  generateText(input: { prompt: string }): Promise<{ text: string }>;
}

export type XhsOpsProfileDeviceControl = Pick<
  DeviceControlService,
  "getDevice" | "executeTask" | "pushMedia"
>;

export interface XhsOpsProfileServiceDeps {
  store: XhsOpsStore;
  media: XhsOpsProfileMedia;
  deviceControl: XhsOpsProfileDeviceControl;
  /** OpenClaw 媒体根目录（openclawStateDir/media），推送前校验路径不越界。 */
  mediaRoot: string;
  readFile?: (filePath: string) => Promise<Buffer>;
  now?: () => number;
}

export const XHS_PROFILE_CANDIDATES = 3;
export const XHS_PROFILE_APPLY_TIMEOUT_MS = 300_000;
export const XHS_PROFILE_APPLY_MAX_STEPS = 60;

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function buildProfileTextPrompt(
  project: XhsOpsProject,
  account: XhsOpsAccount,
): string {
  const persona = formatPersona(account.persona);
  const pool = account.interestPool;
  const profile = project.profile;
  return [
    '为一个小红书 KOC 账号生成昵称和简介。只输出一行紧凑 JSON：{"nickname":"…","bio":"…"}，不要解释。',
    `账号定位：${account.label}｜${account.positioning}`,
    persona ? `人设：${persona}` : "",
    `核心兴趣：${pool.core.join("、")}；扩展：${pool.extended.join("、")}；日常：${pool.general.join("、")}`,
    profile ? `目标人群画像：${profile.summary}` : "",
    project.opsNotes.forbiddenTopics.length > 0
      ? `禁忌方向（简介不得涉及）：${project.opsNotes.forbiddenTopics.join("、")}`
      : "",
    "昵称：≤12 字，像真人随手起的，可含表情或小符号，不要「XX官方」「XX团队」模板感，不与定位名完全相同。",
    "简介：三段合一、总长 ≤100 字：①星座+MBTI（自拟，符合人设）②一句自我介绍（年龄段/身份/所在地，口语化）③一句兴趣介绍（围绕核心兴趣但像日常分享）。禁止营销话术、联系方式、引流、品牌名。",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function buildAvatarPrompt(account: XhsOpsAccount): string {
  const p = account.persona;
  const who =
    [p.gender, p.age, p.lifeStatus].filter((x) => x.trim()).join("，") ||
    "一位年轻人";
  return `真实感人像半身照：${who}，自然表情、看向镜头或微侧，自然环境背景（公园/咖啡馆/海边/街道任选），自然光，手机随手拍质感，不要文字、水印、品牌 logo、夸张滤镜。`;
}

export function buildCoverPrompt(account: XhsOpsAccount): string {
  const p = account.persona;
  const place = p.region.trim()
    ? `${p.region.trim()}或附近知名景点`
    : "国内知名风景地";
  const who =
    [p.gender, p.age].filter((x) => x.trim()).join("，") || "一位旅行者";
  return `${place}的风景照，横构图，画面中远处有一位${who}背身望向远方，旅行随拍质感，自然光，无文字、无水印、无品牌 logo。`;
}

export function parseProfileText(text: string): {
  nickname: string;
  bio: string;
} {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]) as Record<string, unknown>;
      const nickname =
        typeof obj.nickname === "string" ? obj.nickname.trim() : "";
      const bio = typeof obj.bio === "string" ? obj.bio.trim() : "";
      if (nickname || bio)
        return { nickname: nickname.slice(0, 20), bio: bio.slice(0, 200) };
    } catch {
      // fall through
    }
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    nickname: (lines[0] ?? "").slice(0, 20),
    bio: lines.slice(1).join("\n").slice(0, 200),
  };
}

export class XhsOpsProfileService {
  private readonly store: XhsOpsStore;
  private readonly media: XhsOpsProfileMedia;
  private readonly deviceControl: XhsOpsProfileDeviceControl;
  private readonly mediaRoot: string;
  private readonly readFile: (filePath: string) => Promise<Buffer>;
  private readonly now: () => number;

  constructor(deps: XhsOpsProfileServiceDeps) {
    this.store = deps.store;
    this.media = deps.media;
    this.deviceControl = deps.deviceControl;
    this.mediaRoot = path.resolve(deps.mediaRoot);
    this.readFile = deps.readFile ?? ((p) => fs.readFile(p));
    this.now = deps.now ?? (() => Date.now());
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  private async loadAccount(
    accountId: string,
  ): Promise<{ account: XhsOpsAccount; project: XhsOpsProject }> {
    const account = await this.store.getAccount(accountId);
    if (!account) throw new XhsOpsError(404, "账号不存在");
    const project = await this.store.getProject(account.projectId);
    if (!project) throw new XhsOpsError(404, "项目不存在");
    return { account, project };
  }

  async generate(
    accountId: string,
    parts: XhsOpsProfilePart[],
  ): Promise<XhsOpsAccount> {
    const { account, project } = await this.loadAccount(accountId);
    const draft: XhsOpsProfileDraft = { ...account.profileDraft };
    const wanted = new Set(parts);
    if (wanted.has("text")) {
      const { text } = await this.media.generateText({
        prompt: buildProfileTextPrompt(project, account),
      });
      const parsed = parseProfileText(text);
      if (!parsed.nickname && !parsed.bio)
        throw new XhsOpsError(409, "文本生成结果无法解析，请重试");
      if (parsed.nickname) draft.nickname = parsed.nickname;
      if (parsed.bio) draft.bio = parsed.bio;
    }
    if (wanted.has("avatar")) {
      const r = await this.media.generateImage({
        prompt: buildAvatarPrompt(account),
        count: XHS_PROFILE_CANDIDATES,
        aspectRatio: "1:1",
      });
      draft.avatarCandidates = (
        r.items.length > 0 ? r.items.map((i) => i.path) : [r.path]
      ).filter(Boolean);
      if (
        draft.avatarPath &&
        !draft.avatarCandidates.includes(draft.avatarPath)
      )
        draft.avatarPath = null;
    }
    if (wanted.has("cover")) {
      const r = await this.media.generateImage({
        prompt: buildCoverPrompt(account),
        count: XHS_PROFILE_CANDIDATES,
        aspectRatio: "16:9",
      });
      draft.coverCandidates = (
        r.items.length > 0 ? r.items.map((i) => i.path) : [r.path]
      ).filter(Boolean);
      if (draft.coverPath && !draft.coverCandidates.includes(draft.coverPath))
        draft.coverPath = null;
    }
    draft.generatedAt = this.nowIso();
    const updated = await this.store.updateAccount(accountId, {
      profileDraft: draft,
    });
    if (!updated) throw new XhsOpsError(404, "账号不存在");
    return updated;
  }

  private async readMediaForPush(
    filePath: string,
    filename: string,
  ): Promise<DevicePushMediaBody["images"][number]> {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(this.mediaRoot + path.sep)) {
      throw new XhsOpsError(400, "图片不在媒体目录内，拒绝推送");
    }
    const ext = path.extname(resolved).toLowerCase();
    const mimeType = MIME_BY_EXT[ext] ?? "image/jpeg";
    const bytes = await this.readFile(resolved);
    return { filename, mimeType, dataBase64: bytes.toString("base64") };
  }

  async apply(accountId: string): Promise<XhsOpsAccount> {
    const { account } = await this.loadAccount(accountId);
    if (!account.deviceId)
      throw new XhsOpsError(400, "账号未绑定设备，无法应用资料");
    const draft = account.profileDraft;
    const wantNickname = draft.nickname.trim().length > 0;
    const wantBio = draft.bio.trim().length > 0;
    if (!wantNickname && !wantBio && !draft.avatarPath && !draft.coverPath) {
      throw new XhsOpsError(
        400,
        "没有可应用的资料：先生成/填写昵称、简介或选择头像、背景图",
      );
    }
    const device = await this.deviceControl.getDevice(account.deviceId);
    if (!device) throw new XhsOpsError(404, "设备不在线");
    if (device.status !== "idle")
      throw new XhsOpsError(409, "设备正在执行其他任务，请稍后再试");

    const short = account.id.slice(0, 8);
    const images: DevicePushMediaBody["images"] = [];
    let avatarFilename: string | null = null;
    let coverFilename: string | null = null;
    if (draft.avatarPath) {
      avatarFilename = `tabby-avatar-${short}${path.extname(draft.avatarPath).toLowerCase() || ".jpg"}`;
      images.push(
        await this.readMediaForPush(draft.avatarPath, avatarFilename),
      );
    }
    if (draft.coverPath) {
      coverFilename = `tabby-cover-${short}${path.extname(draft.coverPath).toLowerCase() || ".jpg"}`;
      images.push(await this.readMediaForPush(draft.coverPath, coverFilename));
    }
    if (images.length > 0) {
      const pushed: DevicePushMediaResponse =
        await this.deviceControl.pushMedia(account.deviceId, { images });
      const failed = pushed.results.filter((r) => !r.success);
      if (failed.length > 0) {
        throw new XhsOpsError(
          409,
          `图片推送到手机失败：${failed.map((f) => f.error ?? f.mediaId).join("；")}`,
        );
      }
    }

    const task = buildProfileApplyTask({
      label: account.label,
      nickname: wantNickname ? draft.nickname : null,
      bio: wantBio ? draft.bio : null,
      avatarFilename,
      coverFilename,
    });
    const body: DeviceExecuteTaskBody = {
      task,
      allowedApps: [XHS_PACKAGE],
      taskPolicy: XHS_TASK_POLICY,
      maxSteps: XHS_PROFILE_APPLY_MAX_STEPS,
      timeout: XHS_PROFILE_APPLY_TIMEOUT_MS,
    };
    const { result } = await this.deviceControl.executeTask(
      account.deviceId,
      body,
    );
    const outcome = this.interpret(result, {
      wantNickname,
      wantBio,
      wantAvatar: !!avatarFilename,
      wantCover: !!coverFilename,
    });
    const updated = await this.store.updateAccount(accountId, {
      profileDraft: {
        ...draft,
        appliedAt:
          outcome.status === "failed" ? draft.appliedAt : this.nowIso(),
        applyStatus: outcome.status,
        applyResult: outcome.summary,
      },
    });
    if (!updated) throw new XhsOpsError(404, "账号不存在");
    return updated;
  }

  private interpret(
    result: TaskResult,
    want: {
      wantNickname: boolean;
      wantBio: boolean;
      wantAvatar: boolean;
      wantCover: boolean;
    },
  ): { status: XhsOpsProfileApplyStatus; summary: string } {
    const parsed = parseProfileJson(result.message);
    if (!parsed) {
      return {
        status: result.success ? "partial" : "failed",
        summary: `手机未返回结构化记录（${result.success ? "任务完成" : "任务失败"}）：${(result.message ?? "").slice(0, 200)}`,
      };
    }
    const requested: Array<[keyof typeof want, keyof typeof parsed]> = [
      ["wantNickname", "nickname"],
      ["wantBio", "bio"],
      ["wantAvatar", "avatar"],
      ["wantCover", "cover"],
    ];
    const outcomes = requested
      .filter(([w]) => want[w])
      .map(([, k]) => parsed[k] as string);
    const done = outcomes.filter((o) => o === "done").length;
    const status: XhsOpsProfileApplyStatus =
      outcomes.length > 0 && done === outcomes.length
        ? "applied"
        : done > 0
          ? "partial"
          : "failed";
    const summary = `昵称=${parsed.nickname} 简介=${parsed.bio} 头像=${parsed.avatar} 背景=${parsed.cover}${parsed.note ? `｜${parsed.note}` : ""}`;
    return { status, summary };
  }
}
