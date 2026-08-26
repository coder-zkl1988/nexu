import {
  getApiV1DevicesByDeviceId,
  postApiV1DevicesByDeviceIdMedia,
  postApiV1DevicesByDeviceIdTasks,
} from "../../../../lib/api/sdk.gen";

export interface XHSPublishPost {
  title: string;
  content: string;
  images: string[]; // data URLs or browser-loadable URLs
  hashtags: string[];
}

export interface XHSPublishResultItem {
  postId?: string;
  title: string;
  deviceId: string;
  status: "success" | "error" | "unknown";
  message?: string;
}

export type XHSPublishResultSource = "editor" | "batch";
export type XHSPublishPhase = "waiting" | "pushing" | "publishing";

export class XhsPublishStatusUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XhsPublishStatusUnknownError";
  }
}

type XHSPublishActionHandler = (
  name: string,
  context: Record<string, unknown>,
) => void;

function resultNeedsUserInput(result: XHSPublishResultItem): boolean {
  if (result.status !== "error" || !result.message) return false;
  return /请问|请选择|选择|确认|继续|还是|是否|需要/.test(result.message);
}

/**
 * Report a user-triggered publish result back to the originating chat agent.
 * The component already dispatched the phone task, so this reports the outcome
 * rather than issuing another publish request. Keep the payload small: post
 * body and base64 images must never be copied into the chat transcript.
 */
export function reportXhsPublishResults(
  onAction: XHSPublishActionHandler | undefined,
  input: {
    source: XHSPublishResultSource;
    batchId?: string;
    results: XHSPublishResultItem[];
  },
): void {
  if (!onAction || input.results.length === 0) return;

  const successCount = input.results.filter(
    (result) => result.status === "success",
  ).length;
  const unknownCount = input.results.filter(
    (result) => result.status === "unknown",
  ).length;
  const errorCount = input.results.length - successCount - unknownCount;
  const requiresUserInput = input.results.some(resultNeedsUserInput);

  onAction("xhs_publish_result", {
    source: input.source,
    batchId: input.batchId,
    terminal: unknownCount === 0,
    successCount,
    errorCount,
    unknownCount,
    requiresUserInput,
    results: input.results,
    agentInstruction:
      unknownCount > 0
        ? "部分手机任务仍可能在执行，结果尚未确认。不要自动重复发布，避免产生重复帖子；请向用户说明待确认状态。"
        : "这是桌面组件已执行完成的手机端结果，不要自动重复发布。请向用户汇报结果；若 requiresUserInput 为 true，请根据失败消息向用户提问并等待答复。",
  });
}

const DEVICE_IDLE_POLL_INTERVAL_MS = 2_000;
/**
 * How long the device may stop reporting in before we treat it as gone.
 *
 * This is the only clock this component keeps, and it measures *silence*, not
 * duration: publishing is a task like any other, and how long a task may run is
 * the phone's and the desktop's call, not a UI component's. A wall-clock cap
 * here meant a phone that was still working — heartbeating, making progress —
 * had its row marked failed while it went on to publish.
 */
const DEVICE_UNRESPONSIVE_MS = 90_000;
const XHS_MEDIA_ALBUM_NAME = "Tabby";

interface XhsMediaSelection {
  albumName: string;
  filenames: string[];
}

function readApiErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

function isDeviceBusyMessage(message: string): boolean {
  return /TASK_ALREADY_RUNNING|device .* is busy|设备.*忙/i.test(message);
}

async function waitForDeviceIdle(
  deviceId: string,
  onPhase?: (phase: XHSPublishPhase) => void,
): Promise<void> {
  while (true) {
    const { data, error } = await getApiV1DevicesByDeviceId({
      path: { deviceId },
    });
    if (error || !data) {
      throw new Error(readApiErrorMessage(error, "无法读取设备状态"));
    }
    if (data.status === "idle") return;
    if (data.status === "error") {
      throw new Error("设备状态异常，请检查手机端后重试");
    }
    // Busy is not a problem to time out of — the phone is working through the
    // queue. Only a device that has stopped checking in is one we can no longer
    // wait on, and `lastSeen` is what says so.
    if (Date.now() - data.lastSeen > DEVICE_UNRESPONSIVE_MS) {
      throw new Error("手机已失联，本篇尚未开始发布");
    }
    onPhase?.("waiting");
    await new Promise((resolve) =>
      setTimeout(resolve, DEVICE_IDLE_POLL_INTERVAL_MS),
    );
  }
}

/** "image/png" → "png" for a stable gallery filename extension. */
function extForMime(mimeType: string): string {
  const sub = mimeType.split("/")[1] ?? "png";
  return sub === "jpeg" ? "jpg" : sub;
}

/** Resolve a generated/connected image URL to the data URL required by the
 * device media-push API. Local uploads are already data URLs and pass through. */
async function imageSourceToDataUrl(source: string): Promise<string> {
  if (source.startsWith("data:")) return source;

  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    if (typeof window !== "undefined") {
      try {
        const url = new URL(source, window.location.href);
        if (url.origin !== window.location.origin)
          image.crossOrigin = "anonymous";
      } catch {
        // Let the browser resolve non-standard but renderable sources.
      }
    }
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0 || canvas.height === 0) {
        reject(new Error("图片读取失败"));
        return;
      }
      try {
        context.drawImage(image, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        reject(new Error("图片无法转换，请重新上传本地图片"));
      }
    };
    image.onerror = () => reject(new Error("图片加载失败，请检查图片来源"));
    image.src = source;
  });
}

/**
 * Xiaohongshu notes are plain text — they don't render Markdown, and the title
 * is a separate field. The post generator (an LLM) tends to write the body in
 * Markdown, often leading with a `# heading` that restates the title; on the
 * phone that heading looks like the title, so the agent types the body's first
 * line into the title field and stalls. Strip Markdown syntax to plain text,
 * keeping the words, emojis, and line breaks (and ordered "1." numbering, which
 * is real content) intact.
 */
export function stripMarkdownForXhs(text: string): string {
  return (
    text
      .split("\n")
      .map((line) =>
        line
          // Heading markers ("# ", "## " …) → keep the text, drop the marker.
          .replace(/^\s{0,3}#{1,6}\s+/, "")
          // Blockquote marker ("> ") → drop.
          .replace(/^\s{0,3}>\s?/, "")
          // Unordered list markers ("- ", "* ", "+ ") → drop the marker.
          .replace(/^(\s{0,3})[-*+]\s+/, "$1"),
      )
      .join("\n")
      // Links [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Bold (**x**, __x__) → x
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      // Italic (*x*) → x, only when it clearly wraps emphasis (no edge spaces),
      // so arithmetic like "2*3" or a lone asterisk is left untouched.
      .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "$1")
      // Inline code `x` → x
      .replace(/`([^`\n]+)`/g, "$1")
  );
}

/**
 * Build a self-contained publish task for one XHS post. Device skills still own
 * the general app flow, but the task repeats the destructive-input rules that
 * are specific to this payload: TYPE replaces the whole field, so the body and
 * hashtags must be written together exactly once.
 */
export function buildXhsPublishTask(
  post: XHSPublishPost,
  mediaSelection?: XhsMediaSelection,
): string {
  const hasImages = post.images.length > 0;
  const parts: string[] = [
    hasImages
      ? "发布一篇小红书图文笔记，请按小红书「发布笔记」流程操作，并严格遵守以下输入规则："
      : "发布一篇小红书文字笔记。本次没有外部图片素材：点击底部发布按钮后必须选择「写文字」，不得选择「从相册选择」；若已经进入相册页，立即返回发布类型面板并改选「写文字」，不得选取任何已有图片。进入文字封面页后，使用下方标题作为封面短句，再继续到正式发帖页。",
    "【发布授权】用户已经在桌面组件完成内容、图片模式、话题和目标设备选择，并主动点击「发布」或「全部发布」；该点击就是本次公开发布的最终确认。未指定的文字封面样式等非关键选项使用平台默认值，不要中途询问偏好。核对任务内容一致后，必须直接点击手机端最终「发布」或「发布笔记」按钮，不得再次询问用户是否确认。只有遇到账号状态异常、需人工身份校验、平台风控、内容审核，或素材与任务不一致时才停止并报告。",
    "标题输入框只执行一次 TYPE。正文输入框也只执行一次 TYPE；TYPE 会替换整个字段，必须把下方【正文与话题】文本块原样一次性写入，并保留其中全部换行和空行。不得再单独输入话题，也不得点击「#话题」按钮。",
  ];
  if (hasImages) {
    const albumName = mediaSelection?.albumName ?? XHS_MEDIA_ALBUM_NAME;
    const filenames = mediaSelection?.filenames ?? [];
    const filenameInstruction =
      filenames.length > 0
        ? ` 本批文件名为：${filenames.map((filename) => `「${filename}」`).join("、")}。`
        : "";
    parts.push(
      `【配图】桌面端已确认向这台手机推送 ${post.images.length} 张图片，保存位置是相册「${albumName}」。${filenameInstruction}必须先切换到相册「${albumName}」，只选择该相册中与本批文件对应、刚新增且数量完全一致的最新 ${post.images.length} 张；不得在「全部」「最近项目」或其他相册中猜选。若看不到、数量不一致或无法确认是刚推送的图片，立即停止并报告“找不到刚推送的图片”，绝不能选择相册第一张或其他已有图片。`,
    );
  }
  parts.push(`【标题】\n<<<标题开始>>>\n${post.title}\n<<<标题结束>>>`);

  const hashtags = [
    ...new Set(
      post.hashtags
        .map((hashtag) => hashtag.trim().replace(/^#+\s*/, ""))
        .filter(Boolean),
    ),
  ];
  const plainBody = stripMarkdownForXhs(post.content);
  const hashtagLine = hashtags.map((hashtag) => `#${hashtag}`).join(" ");
  const bodyWithHashtags = hashtagLine
    ? plainBody.length > 0
      ? `${plainBody.replace(/\n+$/, "")}\n\n${hashtagLine}`
      : hashtagLine
    : plainBody;
  parts.push(
    `【正文与话题（只写入一次）】\n<<<正文与话题开始>>>\n${bodyWithHashtags}\n<<<正文与话题结束>>>`,
  );
  parts.push(
    hasImages
      ? "发布前核对图片数量、标题、正文换行、空行和末尾话题均与上述内容一致；任一项不一致就停止并报告，不要点击发布。全部一致后才能发布。"
      : "发布前核对本次通过「写文字」生成文字封面、没有从相册选择任何图片，并确认标题、正文换行、空行和末尾话题均与上述内容一致；任一项不一致就停止并报告，不要点击发布。全部一致后才能发布。",
  );
  return parts.join("\n");
}

/**
 * Markers in a device task-result message meaning the phone wasn't ready yet —
 * Tabby's accessibility service instance isn't bound (typically right after the
 * device reconnected or its service was restarted). Such failures are transient
 * and worth one retry rather than surfacing as a hard publish failure.
 */
function isDeviceNotReady(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  const mentionsA11y =
    /无障碍/.test(message) || lower.includes("accessibility");
  const notBound =
    /尚未绑定|未绑定|未就绪|刚被系统重启|重新开关/.test(message) ||
    /not\s*(bound|ready)/.test(lower);
  return mentionsA11y && notBound;
}

/** Wait before retrying a task on a transient "device not ready" failure. */
const NOT_READY_RETRY_DELAY_MS = 4_000;

/**
 * Publish one post to one device: push its images into that device's gallery,
 * then dispatch the publish task and WAIT for the device's real task result.
 * The controller blocks until the phone finishes (or times out), so the
 * returned result reflects the actual on-device outcome. `onPhase` reports
 * progress for live status. Throws when the device reports failure (or no
 * result), so the caller maps a real success — not a mere dispatch ack — to the
 * "published" row state. Retries once if the phone wasn't ready yet.
 */
export async function publishXhsPost(
  deviceId: string,
  post: XHSPublishPost,
  onPhase?: (phase: XHSPublishPhase) => void,
): Promise<void> {
  await waitForDeviceIdle(deviceId, onPhase);

  let mediaSelection: XhsMediaSelection | undefined;
  if (post.images.length > 0) {
    onPhase?.("pushing");
    const resolvedImages = await Promise.all(
      post.images.map(imageSourceToDataUrl),
    );
    const mediaBatchId = Date.now();
    const payload = resolvedImages.map((dataUrl, i) => {
      const mimeType =
        dataUrl.match(/^data:([^;]+);base64,/)?.[1] ?? "image/png";
      const base64 = dataUrl.includes(",")
        ? dataUrl.slice(dataUrl.indexOf(",") + 1)
        : dataUrl;
      return {
        filename: `xhs-${mediaBatchId}-${i}.${extForMime(mimeType)}`,
        mimeType,
        dataBase64: base64,
      };
    });
    const { data, error } = await postApiV1DevicesByDeviceIdMedia({
      path: { deviceId },
      body: { images: payload },
    });
    if (error || !data) {
      throw new Error(
        `图片推送失败，已停止手机发布：${readApiErrorMessage(error, "设备未返回图片保存结果")}`,
      );
    }
    const confirmedCount = data.results.filter(
      (result) => result.success && result.mediaId.trim().length > 0,
    ).length;
    if (
      data.results.length !== payload.length ||
      confirmedCount !== payload.length
    ) {
      throw new Error(
        `图片推送未完成 ${confirmedCount}/${payload.length} 张，已停止手机发布`,
      );
    }
    mediaSelection = {
      albumName: XHS_MEDIA_ALBUM_NAME,
      filenames: payload.map((image) => image.filename),
    };
  }

  onPhase?.("publishing");
  const task = buildXhsPublishTask(post, mediaSelection);
  const dispatch = async () => {
    const { data, error, response } = await postApiV1DevicesByDeviceIdTasks({
      path: { deviceId },
      body: {
        task,
        allowedApps: ["com.xingin.xhs"],
        taskPolicy: {
          operationClass: "content.publish",
          targetPackages: ["com.xingin.xhs"],
          allowedAppRoles: [
            "target_app",
            "gallery",
            "file_picker",
            "system_dialog",
          ],
          allowedApps: ["com.xingin.xhs"],
        },
        // No `timeout`: how long a publish may run is the phone's call (it
        // re-arms its own idle window on every progress heartbeat) with the
        // desktop's ceiling behind it. A number chosen here would only ever be
        // a third opinion that cuts the other two short.
      },
    });
    if (error) {
      const message = readApiErrorMessage(error, "发布请求失败");
      if (response.status === 504) {
        throw new XhsPublishStatusUnknownError(
          "手机任务长时间未返回进度，发布结果待确认",
        );
      }
      throw new Error(message);
    }
    return data?.result;
  };

  let result: Awaited<ReturnType<typeof dispatch>>;
  try {
    result = await dispatch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isDeviceBusyMessage(message)) throw error;
    await waitForDeviceIdle(deviceId, onPhase);
    onPhase?.("publishing");
    result = await dispatch();
  }
  // The phone may have just (re)connected with its accessibility service not yet
  // bound — a transient state. Retry the dispatch once after a short wait before
  // giving up.
  if (result && !result.success && isDeviceNotReady(result.message)) {
    await new Promise((resolve) =>
      setTimeout(resolve, NOT_READY_RETRY_DELAY_MS),
    );
    result = await dispatch();
  }

  if (!result) {
    throw new XhsPublishStatusUnknownError(
      "设备未返回任务结果，发布状态待确认",
    );
  }
  if (!result.success) {
    throw new Error(
      result.message ||
        `发布失败${result.failedAtStep ? `（第 ${result.failedAtStep} 步）` : ""}`,
    );
  }
}
