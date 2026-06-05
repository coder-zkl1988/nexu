import { useState, useRef } from "react";
import type { CustomComponentProps } from "./registry";

interface XHSEditorProps extends CustomComponentProps {}

interface XHSCompData {
  title?: string;
  content?: string;
  images?: string[];
  hashtags?: string[];
  maxTitleLength?: number;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentFileInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

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

  // Confirm action
  const handleConfirm = () => {
    onAction?.("xhs_editor_confirm", {
      title,
      content,
      images,
      hashtags,
    });
  };

  // Cancel action
  const handleCancel = () => {
    onAction?.("xhs_editor_cancel", {});
  };

  return (
    <div
      className="xhs-editor"
      style={{
        maxWidth: 640,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow:
          "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
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
        <button
          type="button"
          onClick={handleCancel}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "#999",
          }}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
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

      {/* Content-area image upload */}
      <div style={{ padding: "4px 16px 0" }}>
        <button
          type="button"
          onClick={() => contentFileInputRef.current?.click()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            border: "1px solid #e5e5e5",
            borderRadius: 6,
            background: "#fafafa",
            cursor: "pointer",
            fontSize: 12,
            color: "#666",
          }}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          插入图片
        </button>
        <input
          ref={contentFileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleImageUpload(e.target.files)}
          style={{ display: "none" }}
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

      {/* Footer buttons */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "12px 16px 16px",
        }}
      >
        <button
          type="button"
          onClick={handleCancel}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "1px solid #d9d9d9",
            background: "#fff",
            cursor: "pointer",
            fontSize: 13,
            color: "#666",
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "none",
            background: "#bb0028",
            cursor: "pointer",
            fontSize: 13,
            color: "#fff",
            fontWeight: 500,
          }}
        >
          确认更新
        </button>
      </div>
    </div>
  );
}
