/** Node content views extracted from infinite-canvas.tsx (W3.0). */
import { A2UIRenderer } from "@/lib/a2ui";
import { AudioLines, Clapperboard, ImagePlus } from "lucide-react";
import { type ReactNode, memo, useState } from "react";
import { generateImageIntoNode, retryNodeTask } from "./canvas-generation";
import { type CanvasNode, getA2UIPayload, updateNode } from "./canvas-store";
import { ConfigNodeContent } from "./config-node";
import { TeamStepNodeContent } from "./team-step-node";

/** Node content re-renders only on content changes, never on geometry. */
export const NodeBody = memo(
  function NodeBody({ node }: { node: CanvasNode }) {
    return <NodeContent node={node} />;
  },
  (prev, next) =>
    prev.node.id === next.node.id &&
    prev.node.type === next.node.type &&
    prev.node.title === next.node.title &&
    prev.node.metadata === next.node.metadata,
);

// ── Node content by type ───────────────────────────────────────

function EmptyMediaHint({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-tertiary">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2">
        <span className="opacity-40">{icon}</span>
      </div>
      <span className="text-[10px] tracking-[0.18em] opacity-70">{label}</span>
    </div>
  );
}

function NodeContent({ node }: { node: CanvasNode }): ReactNode {
  if (node.type === "team-step") {
    return <TeamStepNodeContent node={node} />;
  }

  // Config nodes have their own inline UI — they never get the task spinner
  // (the RESULT node carries the task, not the config node).
  if (node.type === "config") {
    return <ConfigNodeContent node={node} />;
  }

  // Task status overlay: applies before per-type media rendering for image/video/audio.
  if (node.metadata.task?.status === "generating") {
    return (
      <div
        data-canvas-node-generating={node.id}
        className="flex h-full w-full flex-col items-center justify-center gap-3"
      >
        <div className="size-10 animate-spin rounded-full border-2 border-border border-t-sky-500" />
        <span className="text-[11px] tracking-[0.18em] text-text-tertiary">
          生成中
        </span>
      </div>
    );
  }
  if (node.metadata.task?.status === "error") {
    return (
      <div
        data-canvas-node-error={node.id}
        className="flex h-full w-full flex-col items-center justify-center gap-2"
      >
        <p className="text-[11px] text-danger">
          {node.metadata.task.error ?? "生成失败，请重试"}
        </p>
        <button
          type="button"
          data-canvas-node-retry={node.id}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => retryNodeTask(node.id)}
          className="rounded-full border border-border px-3 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
        >
          重试
        </button>
      </div>
    );
  }

  if (node.type === "video") {
    return node.metadata.content ? (
      // biome-ignore lint/a11y/useMediaCaption: user-provided clips have no captions
      <video
        src={node.metadata.content}
        controls
        className="h-full w-full bg-black object-contain"
      />
    ) : (
      <EmptyMediaHint icon={<Clapperboard size={22} />} label="空视频节点" />
    );
  }
  if (node.type === "audio") {
    return node.metadata.content ? (
      <div className="flex h-full w-full flex-col justify-center">
        {/* biome-ignore lint/a11y/useMediaCaption: user-provided clips have no captions */}
        <audio src={node.metadata.content} controls className="w-full" />
      </div>
    ) : (
      <EmptyMediaHint icon={<AudioLines size={22} />} label="空音频节点" />
    );
  }
  if (node.type === "a2ui") {
    const payload = node.metadata.surfaceId
      ? getA2UIPayload(node.metadata.surfaceId)
      : null;
    if (!payload) {
      return (
        <p className="text-xs text-text-tertiary">
          内容已过期 — 从原入口（运行卡/编辑器）重新打开即可恢复。
        </p>
      );
    }
    return (
      <A2UIRenderer messages={payload.messages} onAction={payload.onAction} />
    );
  }
  if (node.type === "text") {
    return (
      <textarea
        className="h-full w-full select-text resize-none bg-transparent text-sm outline-none"
        style={{ fontSize: node.metadata.fontSize ?? 14 }}
        placeholder="输入文本…"
        value={node.metadata.content ?? ""}
        onChange={(event) =>
          updateNode(node.id, { metadata: { content: event.target.value } })
        }
      />
    );
  }
  // image
  if (node.metadata.content) {
    return (
      <img
        src={node.metadata.content}
        alt={node.title}
        className="pointer-events-none h-full w-full select-none object-contain"
        draggable={false}
      />
    );
  }
  return <EmptyImageNode node={node} />;
}

/**
 * Empty image node: upload a file OR generate one from a prompt via the S7
 * controller channel (POST /api/v1/media/generate-image).
 *
 * Generating/error state lives in node.metadata.task (store-level); this
 * component holds only the local prompt input state.
 */
function EmptyImageNode({ node }: { node: CanvasNode }) {
  const [prompt, setPrompt] = useState("");
  const isGenerating = node.metadata.task?.status === "generating";

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <label className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs text-text-tertiary hover:bg-surface-2/50">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2">
          <ImagePlus size={22} className="opacity-40" />
        </div>
        <span className="text-[10px] tracking-[0.18em] opacity-70">
          上传或在下方生成
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              updateNode(node.id, {
                title: file.name,
                metadata: { content: String(reader.result) },
              });
            };
            reader.readAsDataURL(file);
          }}
        />
      </label>
      <div className="flex shrink-0 items-center gap-1">
        <input
          value={prompt}
          disabled={isGenerating}
          placeholder="描述要生成的图片…"
          onChange={(event) => setPrompt(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
        />
        <button
          type="button"
          disabled={isGenerating || !prompt.trim()}
          data-canvas-generate-image={node.id}
          onClick={() => {
            void generateImageIntoNode(node.id, prompt.trim());
          }}
          className="shrink-0 rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-2 py-1 text-xs font-bold text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
        >
          生成
        </button>
      </div>
    </div>
  );
}
