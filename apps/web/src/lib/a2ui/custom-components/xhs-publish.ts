import {
  postApiV1DevicesByDeviceIdMedia,
  postApiV1DevicesByDeviceIdTasks,
} from "../../../../lib/api/sdk.gen";

export interface XHSPublishPost {
  title: string;
  content: string;
  images: string[]; // data URLs
  hashtags: string[];
}

export interface XHSPublishResultItem {
  postId?: string;
  title: string;
  deviceId: string;
  status: "success" | "error";
  message?: string;
}

export type XHSPublishResultSource = "editor" | "batch";

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
 * The component already executed the phone task, so this is a terminal result
 * event rather than another publish request. Keep the payload small: post body
 * and base64 images must never be copied into the chat transcript.
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
  const errorCount = input.results.length - successCount;
  const requiresUserInput = input.results.some(resultNeedsUserInput);

  onAction("xhs_publish_result", {
    source: input.source,
    batchId: input.batchId,
    terminal: true,
    successCount,
    errorCount,
    requiresUserInput,
    results: input.results,
    agentInstruction:
      "这是桌面组件已执行完成的手机端结果，不要自动重复发布。请向用户汇报结果；若 requiresUserInput 为 true，请根据失败消息向用户提问并等待答复。",
  });
}

/** "image/png" → "png" for a stable gallery filename extension. */
function extForMime(mimeType: string): string {
  const sub = mimeType.split("/")[1] ?? "png";
  return sub === "jpeg" ? "jpg" : sub;
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
 * Build the publish task for one XHS post — WHAT to publish only (title,
 * plain-text body, hashtags, image source). The HOW (open the publish entry,
 * the "TYPE replaces / fill each field once" discipline, putting hashtags into
 * the body instead of via the #话题 button, hitting publish) lives in the
 * phone-side tabby-rednote skill (references/post.md), which the device VLM
 * loads when com.xingin.xhs is foreground — one source of truth for the
 * on-device flow, so the desktop never drifts from it.
 */
export function buildXhsPublishTask(post: XHSPublishPost): string {
  const parts: string[] = [
    "发布一篇小红书图文笔记，请按小红书「发布笔记」流程操作。内容如下：",
  ];
  if (post.images.length > 0) {
    parts.push(
      `【配图】从手机相册选择最新的 ${post.images.length} 张图片（刚从桌面推送的）。`,
    );
  }
  parts.push(`【标题】\n<<<标题开始>>>\n${post.title}\n<<<标题结束>>>`);
  parts.push(
    `【正文】\n<<<正文开始>>>\n${stripMarkdownForXhs(post.content)}\n<<<正文结束>>>`,
  );
  if (post.hashtags.length > 0) {
    parts.push(`【话题】${post.hashtags.join("、")}`);
  }
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
  onPhase?: (phase: "pushing" | "publishing") => void,
): Promise<void> {
  if (post.images.length > 0) {
    onPhase?.("pushing");
    const payload = post.images.map((dataUrl, i) => {
      const mimeType =
        dataUrl.match(/^data:([^;]+);base64,/)?.[1] ?? "image/png";
      const base64 = dataUrl.includes(",")
        ? dataUrl.slice(dataUrl.indexOf(",") + 1)
        : dataUrl;
      return {
        filename: `xhs-${Date.now()}-${i}.${extForMime(mimeType)}`,
        mimeType,
        dataBase64: base64,
      };
    });
    const { data } = await postApiV1DevicesByDeviceIdMedia({
      path: { deviceId },
      body: { images: payload },
    });
    const failed = (data?.results ?? []).filter(
      (r: { success: boolean }) => !r.success,
    );
    if (failed.length > 0) {
      throw new Error(`图片推送失败 ${failed.length}/${post.images.length} 张`);
    }
  }

  onPhase?.("publishing");
  const task = buildXhsPublishTask(post);
  const dispatch = async () => {
    const { data } = await postApiV1DevicesByDeviceIdTasks({
      path: { deviceId },
      body: {
        task,
        allowedApps: ["com.xingin.xhs"],
      },
    });
    return data?.result;
  };

  let result = await dispatch();
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
    throw new Error("设备未返回任务结果，发布状态未知");
  }
  if (!result.success) {
    throw new Error(
      result.message ||
        `发布失败${result.failedAtStep ? `（第 ${result.failedAtStep} 步）` : ""}`,
    );
  }
}
