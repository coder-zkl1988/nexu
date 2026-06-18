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

/** "image/png" → "png" for a stable gallery filename extension. */
function extForMime(mimeType: string): string {
  const sub = mimeType.split("/")[1] ?? "png";
  return sub === "jpeg" ? "jpg" : sub;
}

/**
 * Build the autonomous-agent task prompt for publishing one XHS post.
 * Explicit ordered steps — a terse task makes the phone agent improvise badly
 * (pastes body into title, dumps hashtags into the body, drops line breaks).
 */
export function buildXhsPublishTask(post: XHSPublishPost): string {
  const steps: string[] = ["在小红书发布一篇图文笔记，请严格按以下步骤操作："];
  let n = 1;
  if (post.images.length > 0) {
    steps.push(
      `${n++}. 先从手机相册选择最新的 ${post.images.length} 张图片（刚从桌面推送的）作为配图。`,
    );
  }
  steps.push(
    `${n++}. 点击「标题」输入框，只填入下面的标题，不要把正文填进标题：\n<<<标题开始>>>\n${post.title}\n<<<标题结束>>>`,
  );
  steps.push(
    `${n++}. 点击正文输入区，逐字输入下面的正文，必须原样保留所有换行和空行；如果弹出键盘的"粘贴"建议或系统AI改写浮窗，忽略它们直接输入文字：\n<<<正文开始>>>\n${post.content}\n<<<正文结束>>>`,
  );
  if (post.hashtags.length > 0) {
    steps.push(
      `${n++}. 添加话题：在发布页点击「#话题」按钮，逐个添加以下话题（每个都点「#话题」按钮→输入话题名→从候选列表中选中），不要把话题文字直接打进正文：${post.hashtags.join("、")}`,
    );
  }
  steps.push(
    `${n++}. 核对标题、正文、话题、配图都正确后，点击「发布」按钮完成发布。`,
  );
  return steps.join("\n");
}

/**
 * Publish one post to one device: push its images into that device's gallery,
 * then dispatch the publish task. `onPhase` reports progress for live status.
 * Throws on failure (caller maps to row error state).
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
  await postApiV1DevicesByDeviceIdTasks({
    path: { deviceId },
    body: {
      task: buildXhsPublishTask(post),
      allowedApps: ["com.xingin.xhs"],
      guidance:
        "输入文字时优先用输入法直接键入而非剪贴板粘贴，以避免粘贴建议和系统AI浮窗干扰；标题与正文是不同的输入框，不要混填。",
    },
  });
}
