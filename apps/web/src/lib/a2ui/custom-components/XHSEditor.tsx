import { isImeComposing } from "@/lib/keyboard";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getApiV1Devices } from "../../../../lib/api/sdk.gen";
import type { CustomComponentProps } from "./registry";
import { setRowStatus, updatePost } from "./xhs-batch-store";
import { publishXhsPost, reportXhsPublishResults } from "./xhs-publish";

interface XHSEditorProps extends CustomComponentProps {}

interface XHSCompData {
  title?: string;
  content?: string;
  images?: string[];
  hashtags?: string[];
  maxTitleLength?: number;
  /** Set when opened from the batch table → edits/status mirror to the store. */
  batchId?: string;
  postId?: string;
  /** The post's already-assigned device (batch mode). Seeds the selector so
   * opening the editor never silently reassigns the post to another phone. */
  deviceId?: string;
}

type PublishStatus =
  | { state: "idle" }
  | { state: "publishing"; step: string }
  | { state: "success" }
  | { state: "error"; message: string };

export function XHSEditor({ comp, onAction }: XHSEditorProps) {
  const data = comp as unknown as XHSCompData;
  const initialTitle = data.title ?? "";
  const initialContent = data.content ?? "";
  const initialImages: string[] = data.images ?? [];
  const initialHashtags: string[] = data.hashtags ?? [];
  const maxTitleLength: number = data.maxTitleLength ?? 20;
  const initialDeviceId: string = data.deviceId ?? "";
  const batchId = data.batchId;
  const postId = data.postId;
  const bound = Boolean(batchId && postId);

  // Local state
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [images, setImages] = useState<string[]>(initialImages);
  const [hashtags, setHashtags] = useState<string[]>(initialHashtags);
  const [newTag, setNewTag] = useState("");
  const [deviceId, setDeviceId] = useState<string>(initialDeviceId);
  const [publish, setPublish] = useState<PublishStatus>({ state: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Batch binding: mirror every local edit back to the shared store so the
  // inline table row reflects edits in real time.
  useEffect(() => {
    if (bound && batchId && postId) {
      updatePost(batchId, postId, {
        title,
        content,
        images,
        hashtags,
        deviceId,
      });
    }
  }, [bound, batchId, postId, title, content, images, hashtags, deviceId]);

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
    // In batch mode the table row owns device assignment (seeded via
    // `initialDeviceId`); never auto-pick the first device, or opening the
    // editor would silently reassign every post to devices[0]. Only default in
    // standalone use, where the editor is the sole place to choose a device.
    if (bound) return;
    if (!deviceId && devices.length > 0) {
      setDeviceId(devices[0]?.deviceId ?? "");
    }
  }, [bound, deviceId, devices]);

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

  const reportResult = (status: "success" | "error", message?: string) => {
    reportXhsPublishResults(onAction, {
      source: "editor",
      batchId,
      results: [{ postId, title, deviceId, status, message }],
    });
  };

  // Publish via the shared helper (push images + dispatch task). The action
  // round-trip happens only AFTER the phone returns a terminal result, so the
  // bot can report or ask a follow-up without executing the publish twice.
  const handlePublish = async () => {
    if (!deviceId) {
      const message = "请先选择一台在线设备";
      setPublish({ state: "error", message });
      reportResult("error", message);
      return;
    }
    const post = { title, content, images, hashtags };
    try {
      await publishXhsPost(deviceId, post, (phase) => {
        if (bound && batchId && postId) setRowStatus(batchId, postId, phase);
        setPublish({
          state: "publishing",
          step:
            phase === "pushing"
              ? "正在推送图片到手机相册…"
              : "正在发送发布任务到手机…",
        });
      });
      if (bound && batchId && postId) setRowStatus(batchId, postId, "success");
      setPublish({ state: "success" });
      reportResult("success", "手机端已完成发布");
    } catch (err) {
      const message = err instanceof Error ? err.message : "发布失败";
      if (bound && batchId && postId)
        setRowStatus(batchId, postId, "error", message);
      setPublish({ state: "error", message });
      reportResult("error", message);
    }
  };

  return (
    <div
      className="xhs-editor"
      style={{
        // Flush inside the canvas node frame: no own radius/shadow (the node
        // chrome provides them) — avoids the double-border. Fills the node.
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
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
          flexShrink: 0,
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

      {/* Content region — flex column so the post-content textarea can grow to
          fill the remaining editor height; footer (device + publish) stays
          pinned to the bottom of the sidebar. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Image upload grid (compact thumbnails — 50% size, 6 per row) */}
        <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
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
                gap: 3,
                color: "#999",
                fontSize: 11,
              }}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
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
        <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={title}
              onChange={(e) =>
                setTitle(e.target.value.slice(0, maxTitleLength))
              }
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

        {/* Content textarea — flexes to fill the remaining editor height */}
        <div
          style={{
            padding: "8px 16px 0",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="在这里分享你的故事..."
            style={{
              flex: 1,
              minHeight: 80,
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              fontSize: 14,
              outline: "none",
              resize: "none",
              color: "#1a1a1a",
              boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Hashtags section */}
        <div style={{ padding: "8px 16px 0", flexShrink: 0 }}>
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
                  // Enter mid-composition picks the IME candidate, not the tag.
                  if (e.key === "Enter" && !isImeComposing(e)) {
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
      </div>

      {/* Footer: device selector + publish */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "12px 16px 16px",
          flexShrink: 0,
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
            flexShrink: 0,
            color:
              publish.state === "error"
                ? "#bb0028"
                : publish.state === "success"
                  ? "#00a365"
                  : "#666",
          }}
        >
          {publish.state === "publishing" && publish.step}
          {publish.state === "success" && "✅ 手机端已完成发布"}
          {publish.state === "error" && `⚠️ ${publish.message}`}
        </div>
      )}
    </div>
  );
}
