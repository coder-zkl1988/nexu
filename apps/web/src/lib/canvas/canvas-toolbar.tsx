/**
 * canvas-toolbar.tsx — Bottom dock toolbar for the canvas workbench.
 *
 * Visual language (reference-parity, own implementation): a floating,
 * centered dock — tall rounded pill with backdrop blur and a deep soft
 * shadow — holding 32px icon-only buttons. Hovering a button shows an
 * instant dark tooltip ABOVE the dock (rendered outside the scrolling
 * dock so it never clips); groups are separated by hairline dividers;
 * destructive actions render red. The appearance popover and board panel
 * open above the dock with the same glass styling.
 *
 * The reference project is AGPL — this file re-implements the LOOK with
 * our own components and design tokens (no antd, zero code reuse).
 */

import { isImeComposing } from "@/lib/keyboard";
import {
  AudioLines,
  ChevronDown,
  CircleDot,
  Clapperboard,
  Eraser,
  Grid2x2,
  Group,
  ImagePlus,
  Library,
  Map as MapIcon,
  Maximize2,
  Palette,
  Redo2,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { renameBoard, useCanvasBoards } from "./canvas-boards";
import { openCanvasDialog } from "./canvas-dialogs";
import { ingestFilesAsNodes, readFilesAsDataUrls } from "./canvas-ingest";
import {
  type CanvasViewport,
  addNode,
  clearCanvas,
  deleteSelection,
  redo,
  setViewport,
  undo,
  useCanvas,
} from "./canvas-store";
import { setCanvasUiPref, useCanvasUiPrefs } from "./canvas-ui-prefs";

/** Dock tooltip state: which label to show, at which x inside the wrapper. */
type DockTip = { label: string; x: number };

/** Icon size inside dock buttons (reference: size-4.5 ≈ 18px). */
const ICON = 18;

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
  const [tip, setTip] = useState<DockTip | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Escape closes the appearance panel (mount-once; harmless when panel closed).
  useEffect(() => {
    if (!appearanceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAppearanceOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appearanceOpen]);

  // Tooltip x is measured against the OUTER wrapper (not the scrolling dock)
  // so the tip tracks the button even when the dock is scrolled.
  function showTip(label: string) {
    return (event: ReactMouseEvent<HTMLElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const wrapBox = wrap.getBoundingClientRect();
      const box = event.currentTarget.getBoundingClientRect();
      setTip({ label, x: box.left - wrapBox.left + box.width / 2 });
    };
  }
  const hideTip = () => setTip(null);

  return (
    <div
      ref={wrapRef}
      className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-24px)] -translate-x-1/2 justify-center"
    >
      {tip ? (
        <span
          className="pointer-events-none absolute bottom-[calc(100%+8px)] -translate-x-1/2 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs text-white shadow-lg"
          style={{ left: tip.x }}
        >
          {tip.label}
        </span>
      ) : null}

      {/* W4.2: Appearance panel — opens above the dock, same glass styling */}
      {appearanceOpen ? (
        <div
          data-canvas-appearance-panel="true"
          className="absolute bottom-[calc(100%+10px)] left-1/2 w-[248px] -translate-x-1/2 rounded-xl border border-border bg-surface-1/95 p-2.5 shadow-xl backdrop-blur"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {/* Theme follows the app global theme (no canvas-local toggle by design). */}
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-sm font-medium text-text-secondary">画布外观</p>
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
          <p className="px-1 pb-1.5 text-[11px] font-medium text-text-tertiary">
            网格样式
          </p>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
            {(
              [
                { mode: "dots", label: "点", icon: <CircleDot size={14} /> },
                { mode: "lines", label: "线", icon: <Grid2x2 size={14} /> },
                { mode: "blank", label: "空白", icon: <Square size={14} /> },
              ] as const
            ).map(({ mode, label, icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setCanvasUiPref("gridMode", mode)}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-xs transition ${
                  gridMode === mode
                    ? "bg-surface-1 text-text-primary shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
            <span className="text-[11px] font-medium text-text-secondary">
              图片信息
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showImageInfo}
              aria-label="图片信息"
              onClick={() => setCanvasUiPref("showImageInfo", !showImageInfo)}
              className={`relative h-4 w-7 rounded-full transition-colors ${showImageInfo ? "bg-sky-500" : "bg-surface-3"}`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${showImageInfo ? "translate-x-3.5" : "translate-x-0.5"}`}
              />
            </button>
          </div>
        </div>
      ) : null}

      <div
        data-canvas-toolbar="true"
        className="no-scrollbar flex h-14 max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border bg-surface-1/85 px-2 shadow-[0_16px_40px_rgba(0,0,0,0.16)] backdrop-blur [&>*]:shrink-0"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <BoardBadge onTipEnter={showTip} onTipLeave={hideTip} />
        <Divider />
        <ToolButton
          label="撤销"
          onClick={undo}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <Undo2 size={ICON} />
        </ToolButton>
        <ToolButton
          label="重做"
          onClick={redo}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <Redo2 size={ICON} />
        </ToolButton>
        <Divider />
        <ToolButton
          label="文本"
          onClick={() => addNode({ type: "text", title: "文本" })}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <Type size={ICON} />
        </ToolButton>
        <ToolButton
          label="图片"
          onClick={() => addNode({ type: "image", title: "图片" })}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <ImagePlus size={ICON} />
        </ToolButton>
        <ToolButton
          label="视频"
          onClick={() => addNode({ type: "video", title: "视频" })}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <Clapperboard size={ICON} />
        </ToolButton>
        <ToolButton
          label="音频"
          onClick={() => addNode({ type: "audio", title: "音频" })}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <AudioLines size={ICON} />
        </ToolButton>
        <ToolButton
          label="生成配置"
          onClick={() =>
            addNode({
              type: "config",
              title: "生成配置",
              metadata: { config: { mode: "image" } },
            })
          }
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <SlidersHorizontal size={ICON} />
        </ToolButton>
        <ToolButton
          label="组"
          onClick={() => addNode({ type: "group", title: "组" })}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <Group size={ICON} />
        </ToolButton>
        <label
          aria-label="上传素材"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary"
          onMouseEnter={showTip("上传素材")}
          onMouseLeave={hideTip}
        >
          <Upload size={ICON} />
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
        <Divider />
        <ToolButton
          label="素材库"
          dataAttr={{ name: "data-canvas-asset-library", value: "true" }}
          onClick={() => openCanvasDialog({ kind: "assets" })}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <Library size={ICON} />
        </ToolButton>
        <ToolButton
          label="小地图"
          active={minimapVisible}
          dataAttr={{ name: "data-canvas-minimap-toggle", value: "true" }}
          onClick={() => setCanvasUiPref("minimapVisible", !minimapVisible)}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <MapIcon size={ICON} />
        </ToolButton>
        <ToolButton
          label="画布外观"
          active={appearanceOpen}
          dataAttr={{ name: "data-canvas-appearance-toggle", value: "true" }}
          onClick={() => setAppearanceOpen((v) => !v)}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <Palette size={ICON} />
        </ToolButton>
        <Divider />
        <ToolButton
          label="适配全部"
          onClick={() => setViewport(fitViewport(nodes, getContainerSize()))}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <Maximize2 size={ICON} />
        </ToolButton>
        <span className="px-1 text-[11px] tabular-nums text-text-tertiary">
          {Math.round(viewport.scale * 100)}%
        </span>
        {hasSelection ? (
          <>
            <Divider />
            <ToolButton
              label="删除选中"
              danger
              onClick={deleteSelection}
              onTipEnter={showTip}
              onTipLeave={hideTip}
            >
              <Trash2 size={ICON} />
            </ToolButton>
          </>
        ) : null}
        <Divider />
        <ToolButton
          label="清空画布"
          danger
          onClick={() => {
            if (
              nodes.length === 0 ||
              window.confirm("清空画布上的全部节点？")
            ) {
              clearCanvas();
            }
          }}
          onTipEnter={showTip}
          onTipLeave={hideTip}
        >
          <Eraser size={ICON} />
        </ToolButton>
      </div>
    </div>
  );
}

/**
 * W5: Current-board badge + rename popover. With boards bound 1:1 to chat
 * sessions, both manual switching AND deleting are gone from the UI:
 * switching would be silently undone on the next session focus, and deleting
 * another session's board would silently destroy that session's canvas
 * (deleting the active one just recreates it empty on the next bind).
 * The only remaining user-facing board operation is renaming the CURRENT one.
 */
function BoardBadge({
  onTipEnter,
  onTipLeave,
}: {
  onTipEnter: (label: string) => (event: ReactMouseEvent<HTMLElement>) => void;
  onTipLeave: () => void;
}) {
  const { boards, activeId } = useCanvasBoards();
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  // Escape closes the popover (mount-once; harmless when closed).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const activeBoard = boards.find((b) => b.id === activeId);
  const activeName = activeBoard?.name ?? "画布";

  function togglePanel() {
    setDraftName(activeName);
    setOpen((v) => !v);
  }

  function commitRename() {
    if (activeBoard) renameBoard(activeBoard.id, draftName);
    setOpen(false);
  }

  return (
    <div className="relative">
      {open ? (
        <div
          data-canvas-board-panel="true"
          className="absolute bottom-[calc(100%+18px)] left-0 w-[220px] rounded-xl border border-border bg-surface-1/95 p-2.5 shadow-xl backdrop-blur"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-sm font-medium text-text-secondary">当前画布</p>
            <button
              type="button"
              aria-label="关闭画布面板"
              data-canvas-board-close="true"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
            >
              <X size={12} />
            </button>
          </div>
          <input
            // biome-ignore lint/a11y/noAutofocus: inline rename edit needs immediate focus
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              // Board names are Chinese — don't commit on the IME's
              // candidate-confirming Enter.
              if (event.key === "Enter" && !isImeComposing(event)) {
                commitRename();
              }
            }}
            className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary"
          />
          <p className="px-1 pt-2 text-[11px] leading-4 text-text-tertiary">
            画布跟随会话自动切换
          </p>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="画布"
        data-canvas-board-switcher="true"
        onClick={togglePanel}
        onMouseEnter={onTipEnter("重命名画布")}
        onMouseLeave={onTipLeave}
        className={`flex h-8 max-w-[120px] items-center gap-1 rounded-lg px-2 text-xs hover:bg-surface-2 ${open ? "bg-sky-500/15 text-sky-500" : "text-text-secondary hover:text-text-primary"}`}
      >
        <span className="truncate">{activeName}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  onTipEnter,
  onTipLeave,
  active = false,
  danger = false,
  dataAttr,
  children,
}: {
  label: string;
  onClick: () => void;
  onTipEnter: (label: string) => (event: ReactMouseEvent<HTMLElement>) => void;
  onTipLeave: () => void;
  active?: boolean;
  danger?: boolean;
  dataAttr?: { name: string; value: string };
  children: ReactNode;
}) {
  const stateClass = active
    ? "bg-sky-500/15 text-sky-500"
    : danger
      ? "text-danger/80 hover:bg-danger/10 hover:text-danger"
      : "text-text-secondary hover:bg-surface-2 hover:text-text-primary";
  return (
    <button
      type="button"
      aria-label={label}
      {...(dataAttr ? { [dataAttr.name]: dataAttr.value } : {})}
      onClick={onClick}
      onMouseEnter={onTipEnter(label)}
      onMouseLeave={onTipLeave}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${stateClass}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px shrink-0 bg-border" />;
}
