/** Canvas bottom toolbar extracted from infinite-canvas.tsx (W3.0). */
import {
  AudioLines,
  Clapperboard,
  Download,
  ImagePlus,
  Map as MapIcon,
  Maximize2,
  Palette,
  Redo2,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
import { setCanvasUiPref, useCanvasUiPrefs } from "./canvas-ui-prefs";

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
  const { minimapVisible, gridMode, showImageInfo } = useCanvasUiPrefs();
  const hasSelection = selectedNodeIds.length > 0 || !!selectedConnectionId;
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  // Escape closes the appearance panel (mount-once; harmless when panel closed).
  useEffect(() => {
    if (!appearanceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAppearanceOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appearanceOpen]);

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
      {/* W4.2: Appearance panel — toolbar-anchored, opens above the toolbar */}
      {appearanceOpen ? (
        <div
          data-canvas-appearance-panel="true"
          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 min-w-[180px] rounded-lg border border-border bg-surface-1/95 py-2 px-3 shadow-md text-xs"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {/* Theme follows the app global theme (no canvas-local toggle by design). */}
          <div className="mb-2 flex items-center justify-between">
            <p className="text-text-tertiary">外观</p>
            <button
              type="button"
              aria-label="关闭外观面板"
              data-canvas-appearance-close="true"
              onClick={() => setAppearanceOpen(false)}
              className="rounded p-0.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
            >
              <X size={12} />
            </button>
          </div>
          <div className="mb-2">
            <p className="mb-1 text-text-tertiary">网格</p>
            <div className="flex gap-1">
              {(["dots", "lines", "blank"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCanvasUiPref("gridMode", m)}
                  className={`rounded px-2 py-1 text-[11px] border ${gridMode === m ? "border-sky-500 text-sky-500 bg-sky-500/10" : "border-border text-text-secondary hover:bg-surface-2"}`}
                >
                  {m === "dots" ? "点" : m === "lines" ? "线" : "无"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-secondary">图片信息</span>
            <input
              type="checkbox"
              checked={showImageInfo}
              onChange={(event) =>
                setCanvasUiPref("showImageInfo", event.target.checked)
              }
            />
          </div>
        </div>
      ) : null}
      <div
        data-canvas-toolbar="true"
        className="flex items-center gap-1 rounded-lg border border-border bg-surface-1/95 px-2 py-1 shadow-md"
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
            if (
              nodes.length === 0 ||
              window.confirm("清空画布上的全部节点？")
            ) {
              clearCanvas();
            }
          }}
          className="rounded px-1.5 py-1 text-[10px] text-text-tertiary hover:bg-surface-2 hover:text-danger"
        >
          清空
        </button>
        <Divider />
        <button
          type="button"
          title="小地图"
          aria-label="小地图"
          data-canvas-minimap-toggle="true"
          onClick={() => setCanvasUiPref("minimapVisible", !minimapVisible)}
          className={`rounded p-1.5 hover:bg-surface-2 ${minimapVisible ? "text-sky-500" : "text-text-secondary hover:text-text-primary"}`}
        >
          <MapIcon size={14} />
        </button>
        <button
          type="button"
          title="外观"
          aria-label="外观"
          data-canvas-appearance-toggle="true"
          onClick={() => setAppearanceOpen((v) => !v)}
          className={`rounded p-1.5 hover:bg-surface-2 ${appearanceOpen ? "text-sky-500" : "text-text-secondary hover:text-text-primary"}`}
        >
          <Palette size={14} />
        </button>
      </div>
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
