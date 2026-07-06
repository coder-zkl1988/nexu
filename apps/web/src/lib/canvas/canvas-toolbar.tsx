/** Canvas bottom toolbar extracted from infinite-canvas.tsx (W3.0). */
import {
  AudioLines,
  Clapperboard,
  Download,
  ImagePlus,
  Maximize2,
  Redo2,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { ingestFilesAsNodes, readFilesAsDataUrls } from "./canvas-ingest";
import {
  type CanvasExportFile,
  type CanvasViewport,
  addNode,
  clearCanvas,
  deleteSelection,
  exportCanvas,
  importCanvas,
  redo,
  setViewport,
  undo,
  useCanvas,
} from "./canvas-store";

export function CanvasToolbar({
  getContainerSize,
  fitViewport,
}: {
  getContainerSize: () => { width: number; height: number };
  fitViewport: (
    nodes: ReadonlyArray<{
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>,
    container: { width: number; height: number },
    padding?: number,
  ) => CanvasViewport;
}) {
  const { nodes, viewport, selectedNodeIds, selectedConnectionId } =
    useCanvas();
  const hasSelection = selectedNodeIds.length > 0 || !!selectedConnectionId;

  return (
    <div
      data-canvas-toolbar="true"
      className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-surface-1/95 px-2 py-1 shadow-md"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ToolButton label="撤销" onClick={undo}>
        <Undo2 size={14} />
      </ToolButton>
      <ToolButton label="重做" onClick={redo}>
        <Redo2 size={14} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="文本节点"
        onClick={() => addNode({ type: "text", title: "文本" })}
      >
        <Type size={14} />
      </ToolButton>
      <ToolButton
        label="图片节点"
        onClick={() => addNode({ type: "image", title: "图片" })}
      >
        <ImagePlus size={14} />
      </ToolButton>
      <ToolButton
        label="视频节点"
        onClick={() => addNode({ type: "video", title: "视频" })}
      >
        <Clapperboard size={14} />
      </ToolButton>
      <ToolButton
        label="音频节点"
        onClick={() => addNode({ type: "audio", title: "音频" })}
      >
        <AudioLines size={14} />
      </ToolButton>
      <ToolButton
        label="配置节点"
        onClick={() =>
          addNode({
            type: "config",
            title: "生成配置",
            metadata: { config: { mode: "image" } },
          })
        }
      >
        <SlidersHorizontal size={14} />
      </ToolButton>
      <label
        title="上传素材"
        className="cursor-pointer rounded p-1.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      >
        <Upload size={14} />
        <input
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length === 0) return;
            // Place at top-left cascade; ingestFilesAsNodes handles MIME detection.
            void readFilesAsDataUrls(files).then((inputs) => {
              ingestFilesAsNodes(inputs, { x: 32, y: 32 });
            });
          }}
        />
      </label>
      <ToolButton
        label="导出画布"
        onClick={() => {
          const file = exportCanvas();
          const json = JSON.stringify(file, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          const filename = `nexu-canvas-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        <Download size={14} />
      </ToolButton>
      <label
        title="导入画布"
        className="cursor-pointer rounded p-1.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      >
        <Upload size={14} />
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const parsed = JSON.parse(
                  String(reader.result),
                ) as CanvasExportFile;
                importCanvas(parsed);
              } catch {
                toast.error("导入失败：不是有效的画布文件");
              }
              event.target.value = "";
            };
            reader.onerror = () => {
              toast.error("导入失败：不是有效的画布文件");
              event.target.value = "";
            };
            reader.readAsText(file);
          }}
        />
      </label>
      <Divider />
      {hasSelection ? (
        <>
          <ToolButton label="删除选中" onClick={deleteSelection}>
            <Trash2 size={14} className="text-danger" />
          </ToolButton>
          <Divider />
        </>
      ) : null}
      <ToolButton
        label="适配全部"
        onClick={() => setViewport(fitViewport(nodes, getContainerSize()))}
      >
        <Maximize2 size={14} />
      </ToolButton>
      <span className="px-1 text-[10px] tabular-nums text-text-tertiary">
        {Math.round(viewport.scale * 100)}%
      </span>
      <Divider />
      <button
        type="button"
        onClick={() => {
          if (nodes.length === 0 || window.confirm("清空画布上的全部节点？")) {
            clearCanvas();
          }
        }}
        className="rounded px-1.5 py-1 text-[10px] text-text-tertiary hover:bg-surface-2 hover:text-danger"
      >
        清空
      </button>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded p-1.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-0.5 h-4 w-px bg-border" />;
}
