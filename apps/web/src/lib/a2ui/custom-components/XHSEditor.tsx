import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  getApiV1Devices,
  postApiV1DevicesByDeviceIdMedia,
  postApiV1DevicesByDeviceIdTasks,
} from "../../../../lib/api/sdk.gen";
import type { CustomComponentProps } from "./registry";

interface XHSEditorProps extends CustomComponentProps {}

interface XHSCompData {
  title?: string;
  content?: string;
  images?: string[];
  hashtags?: string[];
  maxTitleLength?: number;
}

type PublishStatus =
  | { state: "idle" }
  | { state: "publishing"; step: string }
  | { state: "success" }
  | { state: "error"; message: string };

/** "image/png" → "png" for a stable gallery filename extension. */
function extForMime(mimeType: string): string {
  const sub = mimeType.split("/")[1] ?? "png";
  return sub === "jpeg" ? "jpg" : sub;
}

export function XHSEditor({ comp, onAction }: XHSEditorProps) {
  const data = comp as unknown as XHSCompData;
  const initialTitle = data.title ?? "";
  const initialContent = data.content ?? "";
  const initialImages: string[] = data.images ?? [];
  const initialHashtags: string[] = data.hashtags ?? [];
  const maxTitleLength: number = data.maxTitleLength ?? 20;

  // Local state
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [images, setImages] = useState<string[]>(initialImages);
  const [hashtags, setHashtags] = useState<string[]>(initialHashtags);
  const [newTag, setNewTag] = useState("");
  const [deviceId, setDeviceId] = useState<string>("");
  const [publish, setPublish] = useState<PublishStatus>({ state: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Online devices for publishing. Every listed device is connected, so the
  // list itself is the "online" set; default to the first one.
  const { data: devicesData } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data: d } = await getApiV1Devices();
      return d;
    },
    refetchInterval: 10_000,
  });
  const devices = devicesData?.devices ?? [];
  useEffect(() => {
    if (!deviceId && devices.length > 0) {
      setDeviceId(devices[0]?.deviceId ?? "");
    }
  }, [deviceId, devices]);

  // Image upload handler (local FileReader, no server upload)
  const handleImageUpload = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setImages((prev) => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    }
  };

  // Remove image by URL
  const removeImage = (imgUrl: string) => {
    setImages((prev) => prev.filter((url) => url !== imgUrl));
  };

  // Add hashtag
  const addHashtag = () => {
    const tag = newTag.trim().replace(/^#/, "");
    if (tag && !hashtags.includes(tag)) {
      setHashtags((prev) => [...prev, tag]);
    }
    setNewTag("");
  };

  // Remove hashtag
  const removeHashtag = (tag: string) => {
    setHashtags((prev) => prev.filter((t) => t !== tag));
  };

  // Publish: push the configured images into the selected device's gallery,
  // then dispatch a Xiaohongshu publish task to that phone. Deterministic —
  // the image transfer is not left to the agent, only the in-app navigation is.
  const handlePublish = async () => {
    if (!deviceId) {
      setPublish({ state: "error", message: "请先选择一台在线设备" });
      return;
    }
    try {
      // 1. Push images (base64 → device gallery) one batch.
      if (images.length > 0) {
        setPublish({ state: "publishing", step: "正在推送图片到手机相册…" });
        const payload = images.map((dataUrl, i) => {
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
        const { data: pushRes } = await postApiV1DevicesByDeviceIdMedia({
          path: { deviceId },
          body: { images: payload },
        });
        const failed = (pushRes?.results ?? []).filter(
          (r: { success: boolean }) => !r.success,
        );
        if (failed.length > 0) {
          throw new Error(`图片推送失败 ${failed.length}/${images.length} 张`);
        }
      }

      // 2. Dispatch the publish task to the phone.
      setPublish({ state: "publishing", step: "正在发送发布任务到手机…" });
      const tagLine =
        hashtags.length > 0
          ? `\n话题：${hashtags.map((t) => `#${t}`).join(" ")}`
          : "";
      const imageLine =
        images.length > 0
          ? `\n从相册选择最新的 ${images.length} 张图片（刚推送的）`
          : "";
      const task = `打开小红书发布一篇笔记。\n标题：${title}\n正文：${content}${tagLine}${imageLine}\n填写完成后进入发布页，但在最终点击「发布」前停下，让我确认。`;
      await postApiV1DevicesByDeviceIdTasks({
        path: { deviceId },
        body: { task, allowedApps: ["com.xingin.xhs"] },
      });

      setPublish({ state: "success" });
      // Surface a chip in the conversation (no base64 — just a signal).
      onAction?.("xhs_editor_publish", {
        deviceId,
        title,
        hashtags,
        imageCount: images.length,
      });
    } catch (err) {
      setPublish({
        state: "error",
        message: err instanceof Error ? err.message : "发布失败",
      });
    }
  };

  return (
    <div
      className="xhs-editor"
      style={{
        maxWidth: 640,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
        background: "#ffffff",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid #e5e5e5",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#bb0028"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>
            小红书内容编辑
          </span>
        </div>
      </div>

      {/* Image upload grid */}
      <div style={{ padding: "12px 16px 0" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
          }}
        >
          {images.map((img) => (
            <div
              key={img}
              style={{
                position: "relative",
                aspectRatio: "1",
                borderRadius: 8,
                overflow: "hidden",
                background: "#f5f5f5",
              }}
            >
              <img
                src={img}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
              <button
                type="button"
                onClick={() => removeImage(img)}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.5)",
                  border: "none",
                  cursor: "pointer",
                  color: "#fff",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              aspectRatio: "1",
              borderRadius: 8,
              border: "2px dashed #d9d9d9",
              background: "#fafafa",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: "#999",
              fontSize: 12,
            }}
          >
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加图片
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleImageUpload(e.target.files)}
            style={{ display: "none" }}
          />
        </div>
      </div>

      {/* Title input */}
      <div style={{ padding: "12px 16px 0" }}>
        <div style={{ position: "relative" }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, maxTitleLength))}
            placeholder="填写标题，更有吸引力"
            maxLength={maxTitleLength}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              fontSize: 14,
              outline: "none",
              color: "#1a1a1a",
              boxSizing: "border-box",
            }}
          />
          <span
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 12,
              color: "#999",
            }}
          >
            {title.length}/{maxTitleLength}
          </span>
        </div>
      </div>

      {/* Content textarea */}
      <div style={{ padding: "8px 16px 0" }}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="在这里分享你的故事..."
          rows={4}
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid #e5e5e5",
            borderRadius: 8,
            fontSize: 14,
            outline: "none",
            resize: "vertical",
            color: "#1a1a1a",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />
      </div>

      {/* Hashtags section */}
      <div style={{ padding: "8px 16px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 13, color: "#666", fontWeight: 500 }}>
            添加话题
          </span>
          {hashtags.map((tag) => (
            <span
              key={tag}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 4,
                background: "#fff1f0",
                color: "#bb0028",
                fontSize: 12,
              }}
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeHashtag(tag)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  color: "#bb0028",
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <input
              ref={tagInputRef}
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addHashtag();
                }
              }}
              placeholder="输入话题"
              style={{
                width: 80,
                padding: "2px 6px",
                border: "1px solid #e5e5e5",
                borderRadius: 4,
                fontSize: 12,
                outline: "none",
                color: "#1a1a1a",
              }}
            />
            <button
              type="button"
              onClick={addHashtag}
              style={{
                background: "none",
                border: "1px solid #bb0028",
                borderRadius: 4,
                padding: "2px 8px",
                cursor: "pointer",
                color: "#bb0028",
                fontSize: 12,
              }}
            >
              +添加
            </button>
          </div>
        </div>
      </div>

      {/* Footer: device selector + publish */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "12px 16px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <span style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>
            发布到
          </span>
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "6px 8px",
              border: "1px solid #e5e5e5",
              borderRadius: 6,
              fontSize: 12,
              color: "#1a1a1a",
              background: "#fff",
              outline: "none",
            }}
          >
            {devices.length === 0 ? (
              <option value="">无在线设备</option>
            ) : (
              devices.map((d: { deviceId: string; name?: string }) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.name || d.deviceId}
                </option>
              ))
            )}
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            void handlePublish();
          }}
          disabled={
            publish.state === "publishing" || devices.length === 0 || !deviceId
          }
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "none",
            background:
              publish.state === "publishing" || devices.length === 0
                ? "#e3a3b0"
                : "#bb0028",
            cursor:
              publish.state === "publishing" || devices.length === 0
                ? "not-allowed"
                : "pointer",
            fontSize: 13,
            color: "#fff",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          {publish.state === "publishing" ? "发布中…" : "发布"}
        </button>
      </div>

      {/* Status line */}
      {publish.state !== "idle" && (
        <div
          style={{
            padding: "0 16px 14px",
            fontSize: 12,
            color:
              publish.state === "error"
                ? "#bb0028"
                : publish.state === "success"
                  ? "#00a365"
                  : "#666",
          }}
        >
          {publish.state === "publishing" && publish.step}
          {publish.state === "success" &&
            "✅ 已发送到手机，请在手机上确认最终发布"}
          {publish.state === "error" && `⚠️ ${publish.message}`}
        </div>
      )}
    </div>
  );
}
