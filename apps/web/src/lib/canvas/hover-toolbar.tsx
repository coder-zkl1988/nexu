/**
 * hover-toolbar.tsx — per-node floating action pill (W3.1).
 *
 * Rendered inside CanvasNodeView (world-space, moves with the node).
 * Positioned absolutely above the frame. Visibility driven by the node's
 * group hover class; always visible when selected.
 *
 * Base tools: info / download / replace / lock / delete.
 * Later W3 tasks (crop/split/upscale/mask/angle) extend this component.
 */

import {
  AArrowDown,
  AArrowUp,
  Crop,
  Download,
  Grid3x3,
  ImagePlus,
  Info,
  Lock,
  RefreshCw,
  Trash2,
  Unlock,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { openCanvasDialog } from "./canvas-dialogs";
import { readFilesAsDataUrls } from "./canvas-ingest";
import {
  type CanvasNode,
  removeNodes,
  setNodeTask,
  updateNode,
} from "./canvas-store";
import { nextFontSize, textNodeToImage } from "./text-node-utils";

// ── Helpers ─────────────────────────────────────────────────────

const MEDIA_TYPES = new Set(["image", "video", "audio"]);
const CONTENT_MEDIA_TYPES = new Set(["image", "video"]);

/** Return a sane default extension for a media node title without a dot. */
function defaultExtension(type: string): string {
  if (type === "video") return "mp4";
  if (type === "audio") return "mp3";
  return "png";
}

/** Trigger a browser download for a data URL / servable URL. */
function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Component ───────────────────────────────────────────────────

export function HoverToolbar({
  node,
  selected,
}: {
  node: CanvasNode;
  selected: boolean;
}) {
  // a2ui and team-step nodes keep minimal chrome — no toolbar.
  if (node.type === "a2ui" || node.type === "team-step") {
    return null;
  }

  const { id, title, type, size, metadata } = node;
  const { width, height } = size;
  const hasContent = Boolean(metadata.content);
  const isMedia = MEDIA_TYPES.has(type);
  const isContentMedia = CONTENT_MEDIA_TYPES.has(type) && hasContent;

  return (
    <ToolbarPill nodeId={id} selected={selected}>
      {/* info — ALL types */}
      <ToolbarButton
        actionKey="info"
        label="节点信息"
        title="节点信息"
        onClick={() => {
          toast.info(
            `${title} · ${type} · ${Math.round(width)}×${Math.round(height)}`,
          );
        }}
      >
        <Info size={13} />
      </ToolbarButton>

      {/* download — only when content present AND type in image/video/audio */}
      {hasContent && isMedia ? (
        <ToolbarButton
          actionKey="download"
          label="下载"
          title="下载"
          onClick={() => {
            const url = metadata.content as string;
            const hasDot = title.includes(".");
            const filename = hasDot
              ? title
              : `${title}.${defaultExtension(type)}`;
            triggerDownload(url, filename);
          }}
        >
          <Download size={13} />
        </ToolbarButton>
      ) : null}

      {/* replace — image/video/audio regardless of content */}
      {isMedia ? <ReplaceButton node={node} /> : null}

      {/* lock — image/video WITH content */}
      {isContentMedia ? (
        <ToolbarButton
          actionKey="lock"
          label="toggle aspect ratio lock"
          title={metadata.freeResize ? "锁定比例" : "解锁比例"}
          data-canvas-lock-toggle={id}
          onClick={() => {
            updateNode(id, {
              metadata: { freeResize: !metadata.freeResize },
            });
          }}
        >
          {metadata.freeResize ? <Unlock size={13} /> : <Lock size={13} />}
        </ToolbarButton>
      ) : null}

      {/* crop — image WITH content only */}
      {type === "image" && hasContent ? (
        <ToolbarButton
          actionKey="crop"
          label="裁剪图片"
          title="裁剪图片"
          onClick={() => {
            openCanvasDialog({ kind: "crop", nodeId: id });
          }}
        >
          <Crop size={13} />
        </ToolbarButton>
      ) : null}

      {/* split — image WITH content only */}
      {type === "image" && hasContent ? (
        <ToolbarButton
          actionKey="split"
          label="拆分图片"
          title="拆分图片"
          onClick={() => {
            openCanvasDialog({ kind: "split", nodeId: id });
          }}
        >
          <Grid3x3 size={13} />
        </ToolbarButton>
      ) : null}

      {/* upscale — image WITH content only */}
      {type === "image" && hasContent ? (
        <ToolbarButton
          actionKey="upscale"
          label="放大图片"
          title="放大图片"
          onClick={() => {
            openCanvasDialog({ kind: "upscale", nodeId: id });
          }}
        >
          <ZoomIn size={13} />
        </ToolbarButton>
      ) : null}

      {/* font-inc — text nodes only */}
      {type === "text" ? (
        <ToolbarButton
          actionKey="font-inc"
          label="字号+"
          title="字号+"
          onClick={() => {
            updateNode(id, {
              metadata: { fontSize: nextFontSize(metadata.fontSize, 1) },
            });
          }}
        >
          <AArrowUp size={13} />
        </ToolbarButton>
      ) : null}

      {/* font-dec — text nodes only */}
      {type === "text" ? (
        <ToolbarButton
          actionKey="font-dec"
          label="字号-"
          title="字号-"
          onClick={() => {
            updateNode(id, {
              metadata: { fontSize: nextFontSize(metadata.fontSize, -1) },
            });
          }}
        >
          <AArrowDown size={13} />
        </ToolbarButton>
      ) : null}

      {/* to-image — text nodes with non-empty content only */}
      {type === "text" && (metadata.content ?? "").trim() ? (
        <ToolbarButton
          actionKey="to-image"
          label="转图片"
          title="转图片"
          onClick={() => {
            textNodeToImage(id);
            toast.success("已创建生成节点");
          }}
        >
          <ImagePlus size={13} />
        </ToolbarButton>
      ) : null}

      {/* delete — ALL types */}
      <ToolbarButton
        actionKey="delete"
        label="删除节点"
        title="删除节点"
        className="text-danger"
        onClick={() => {
          removeNodes([id]);
        }}
      >
        <Trash2 size={13} />
      </ToolbarButton>
    </ToolbarPill>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function ToolbarPill({
  nodeId,
  selected,
  children,
}: {
  nodeId: string;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-canvas-hover-toolbar={nodeId}
      className={`absolute -top-9 left-1/2 z-40 -translate-x-1/2 flex items-center gap-0.5 rounded-lg border border-border bg-surface-1/95 px-1 py-0.5 shadow-md transition-opacity duration-150 ${selected ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function ToolbarButton({
  actionKey,
  label,
  title,
  onClick,
  className,
  "data-canvas-lock-toggle": lockToggle,
  children,
}: {
  actionKey: string;
  label: string;
  title: string;
  onClick: () => void;
  className?: string;
  "data-canvas-lock-toggle"?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-canvas-hover-action={actionKey}
      {...(lockToggle !== undefined
        ? { "data-canvas-lock-toggle": lockToggle }
        : {})}
      aria-label={label}
      title={title}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className={`rounded p-1 hover:bg-surface-2 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

function ReplaceButton({ node }: { node: CanvasNode }) {
  const accept =
    node.type === "video"
      ? "video/*"
      : node.type === "audio"
        ? "audio/*"
        : "image/*";

  return (
    <label
      data-canvas-hover-action="replace"
      aria-label="替换素材"
      title="替换素材"
      className="cursor-pointer rounded p-1 hover:bg-surface-2"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <RefreshCw size={13} />
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length === 0) return;
          void readFilesAsDataUrls(files).then((inputs) => {
            const first = inputs[0];
            if (!first) return;
            updateNode(node.id, {
              title: first.name,
              metadata: { content: first.dataUrl, mimeType: first.type },
            });
            // Clear stale error task overlay when replacing content.
            setNodeTask(node.id, null);
          });
          // Reset so the same file can be re-selected.
          event.target.value = "";
        }}
      />
    </label>
  );
}
