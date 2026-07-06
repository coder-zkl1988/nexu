/**
 * crop-dialog.tsx — interactive crop dialog + CanvasDialogs mount point (W3.2).
 *
 * CanvasDialogs is mounted ONCE inside CanvasSurface (screen-space, after menus).
 * It switches on useCanvasDialog().kind to render the appropriate dialog.
 *
 * Media bytes loading strategy:
 *   fetch(url) → blob() → createImageBitmap(blob)
 *   This sidesteps canvas cross-origin taint: drawing a cross-origin <img> via
 *   drawImage would cause canvas.toDataURL() to throw SecurityError.  Fetching
 *   the bytes first + createImageBitmap avoids CORS taint entirely.
 *   NOTE: This is a media-bytes fetch, NOT an API call. The raw-fetch ban applies
 *   to API data only (SDK-only); media blob loading via fetch is the sanctioned
 *   approach per the brief.
 *   dataURLs are also passed through fetch() — the browser supports data: URLs.
 *
 * Servable URLs like /api/v1/media/state-file?path=... are relative to the web
 * origin when running inside Vite dev (proxied to controller). In Electron, the
 * web app resolves against the same origin (controller base URL injected via
 * VITE_API_BASE_URL or left relative). We resolve them against the SDK client's
 * configured baseUrl so the same code works in both environments.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Crop } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type CanvasDialogState,
  closeCanvasDialog,
  useCanvasDialog,
} from "./canvas-dialogs";
import { addNode, getCanvasState } from "./canvas-store";
import {
  type CropBox,
  type CropHandle,
  applyCropDrag,
  fitScale,
} from "./crop-geometry";
import { resolveMediaUrl } from "./load-image-bitmap";
import { SplitDialog } from "./split-dialog";
import { UpscaleDialog } from "./upscale-dialog";

// ── Constants ──────────────────────────────────────────────────────────────

const PREVIEW_MAX_W = 640;
const PREVIEW_MAX_H = 400;
const HANDLE_SIZE = 10; // px, visual dot

// ── CanvasDialogs — the single mount point ─────────────────────────────────

/** Mount once inside CanvasSurface. Switches on dialog kind. */
export function CanvasDialogs() {
  const dialog = useCanvasDialog();
  if (!dialog) return null;
  if (dialog.kind === "crop") return <CropDialog state={dialog} />;
  if (dialog.kind === "split") return <SplitDialog state={dialog} />;
  if (dialog.kind === "upscale") return <UpscaleDialog state={dialog} />;
  return null;
}

// ── CropDialog ─────────────────────────────────────────────────────────────

function CropDialog({
  state,
}: {
  state: NonNullable<CanvasDialogState> & { kind: "crop" };
}) {
  const { nodeId } = state;
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [box, setBox] = useState<CropBox>({ x: 0, y: 0, width: 0, height: 0 });
  const [lockRatio, setLockRatio] = useState(false);

  // Drag state kept in ref to avoid closure identity issues
  const dragRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    startBox: CropBox;
    scale: number;
  } | null>(null);

  // Preview container ref for pointer capture
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Resolve the media URL for this node
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  const srcUrl = node?.metadata.content as string | undefined;
  const srcTitle = node?.title ?? "图片";

  useEffect(() => {
    if (!srcUrl) {
      toast.error("图片加载失败");
      closeCanvasDialog();
      return;
    }

    let cancelled = false;
    let createdObjUrl: string | null = null;

    (async () => {
      try {
        const resolvedUrl = resolveMediaUrl(srcUrl);
        const resp = await fetch(resolvedUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (cancelled) return;

        const bm = await createImageBitmap(blob);
        if (cancelled) {
          bm.close();
          return;
        }
        createdObjUrl = URL.createObjectURL(blob);
        setBitmap(bm);
        setObjUrl(createdObjUrl);
        setBox({ x: 0, y: 0, width: bm.width, height: bm.height });
      } catch {
        if (cancelled) return;
        toast.error("图片加载失败");
        closeCanvasDialog();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (createdObjUrl) URL.revokeObjectURL(createdObjUrl);
    };
  }, [srcUrl]);

  // Cleanup bitmap when dialog unmounts
  useEffect(() => {
    return () => {
      bitmap?.close();
    };
  }, [bitmap]);

  const scale = bitmap
    ? fitScale(bitmap.width, bitmap.height, PREVIEW_MAX_W, PREVIEW_MAX_H)
    : 1;

  const displayW = bitmap ? Math.round(bitmap.width * scale) : 0;
  const displayH = bitmap ? Math.round(bitmap.height * scale) : 0;

  // ── Drag handlers ────────────────────────────────────────────────

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, handle: CropHandle) => {
      e.preventDefault();
      e.stopPropagation();
      // Capture on the preview container so subsequent move/up events keep
      // firing there even when the pointer leaves the tiny handle dot.
      try {
        previewContainerRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // pointer capture is best-effort
      }
      dragRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startBox: box,
        scale,
      };
    },
    [box, scale],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || !bitmap) return;
      const rawDx = e.clientX - drag.startX;
      const rawDy = e.clientY - drag.startY;
      const dx = rawDx / drag.scale;
      const dy = rawDy / drag.scale;
      const newBox = applyCropDrag({
        handle: drag.handle,
        box: drag.startBox,
        dx,
        dy,
        bounds: { width: bitmap.width, height: bitmap.height },
        lockRatio,
      });
      setBox(newBox);
    },
    [bitmap, lockRatio],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Confirm: draw offscreen canvas, produce dataURL, add node ───

  const handleConfirm = useCallback(() => {
    if (!bitmap) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = Math.round(box.width);
    offscreen.height = Math.round(box.height);
    const ctx = offscreen.getContext("2d");
    if (!ctx) {
      toast.error("裁剪失败");
      return;
    }
    ctx.drawImage(
      bitmap,
      Math.round(box.x),
      Math.round(box.y),
      Math.round(box.width),
      Math.round(box.height),
      0,
      0,
      Math.round(box.width),
      Math.round(box.height),
    );
    const dataUrl = offscreen.toDataURL("image/png");
    // Read node live so a title rename between dialog-open and confirm is reflected.
    const src = getCanvasState().nodes.find((n) => n.id === nodeId);
    const liveTitle = src?.title ?? "图片";
    addNode({
      type: "image",
      title: `${liveTitle} 裁剪`,
      position: src
        ? { x: src.position.x + src.size.width + 40, y: src.position.y }
        : undefined,
      metadata: { content: dataUrl },
    });
    closeCanvasDialog();
    toast.success("已生成裁剪节点");
  }, [bitmap, box, nodeId]);

  // ── Overlay mask: four shaded divs around the crop box ──────────

  function renderMask() {
    if (!displayW || !displayH) return null;
    const bx = Math.round(box.x * scale);
    const by = Math.round(box.y * scale);
    const bw = Math.round(box.width * scale);
    const bh = Math.round(box.height * scale);

    const maskStyle: React.CSSProperties = {
      position: "absolute",
      background: "rgba(0,0,0,0.5)",
      pointerEvents: "none",
    };

    return (
      <>
        {/* top */}
        <div
          style={{ ...maskStyle, left: 0, top: 0, width: displayW, height: by }}
        />
        {/* bottom */}
        <div
          style={{
            ...maskStyle,
            left: 0,
            top: by + bh,
            width: displayW,
            height: displayH - by - bh,
          }}
        />
        {/* left */}
        <div
          style={{ ...maskStyle, left: 0, top: by, width: bx, height: bh }}
        />
        {/* right */}
        <div
          style={{
            ...maskStyle,
            left: bx + bw,
            top: by,
            width: displayW - bx - bw,
            height: bh,
          }}
        />
      </>
    );
  }

  // ── Handle dots positions ────────────────────────────────────────

  function renderHandles() {
    if (!displayW || !displayH) return null;
    const bx = Math.round(box.x * scale);
    const by = Math.round(box.y * scale);
    const bw = Math.round(box.width * scale);
    const bh = Math.round(box.height * scale);
    const half = HANDLE_SIZE / 2;

    const handles: Array<{
      handle: CropHandle;
      cx: number;
      cy: number;
      cursor: string;
    }> = [
      { handle: "nw", cx: bx, cy: by, cursor: "nwse-resize" },
      { handle: "n", cx: bx + bw / 2, cy: by, cursor: "ns-resize" },
      { handle: "ne", cx: bx + bw, cy: by, cursor: "nesw-resize" },
      { handle: "e", cx: bx + bw, cy: by + bh / 2, cursor: "ew-resize" },
      { handle: "se", cx: bx + bw, cy: by + bh, cursor: "nwse-resize" },
      { handle: "s", cx: bx + bw / 2, cy: by + bh, cursor: "ns-resize" },
      { handle: "sw", cx: bx, cy: by + bh, cursor: "nesw-resize" },
      { handle: "w", cx: bx, cy: by + bh / 2, cursor: "ew-resize" },
    ];

    return (
      <>
        {/* Move area (the inner crop box itself) */}
        <div
          style={{
            position: "absolute",
            left: bx,
            top: by,
            width: bw,
            height: bh,
            cursor: "move",
            boxSizing: "border-box",
            border: "1.5px solid rgba(255,255,255,0.8)",
          }}
          onPointerDown={(e) => onHandlePointerDown(e, "move")}
        />
        {/* 8 handle dots */}
        {handles.map(({ handle, cx, cy, cursor }) => (
          <div
            key={handle}
            data-crop-handle={handle}
            style={{
              position: "absolute",
              left: cx - half,
              top: cy - half,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              borderRadius: "50%",
              background: "white",
              border: "1.5px solid #1890ff",
              cursor,
              boxSizing: "border-box",
              zIndex: 10,
            }}
            onPointerDown={(e) => onHandlePointerDown(e, handle)}
          />
        ))}
      </>
    );
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeCanvasDialog();
      }}
    >
      <DialogContent className="max-w-[760px] w-full" style={{ maxWidth: 760 }}>
        <DialogHeader>
          <DialogTitle>裁剪图片</DialogTitle>
        </DialogHeader>
        <div data-canvas-crop-dialog="true" className="px-6 pb-6">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-text-secondary">
              加载中…
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Preview area */}
              <div
                ref={previewContainerRef}
                className="relative mx-auto overflow-hidden rounded-lg bg-surface-2"
                style={{ width: displayW, height: displayH }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              >
                {/* Background image (objectURL for cross-origin safety) */}
                {objUrl ? (
                  <img
                    src={objUrl}
                    alt={srcTitle}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: displayW,
                      height: displayH,
                      userSelect: "none",
                      pointerEvents: "none",
                    }}
                    draggable={false}
                  />
                ) : null}
                {/* Mask + handles */}
                {renderMask()}
                {renderHandles()}
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-text-primary">
                  <input
                    type="checkbox"
                    checked={lockRatio}
                    onChange={(e) => setLockRatio(e.target.checked)}
                    className="cursor-pointer"
                  />
                  锁定比例
                </label>

                <span className="text-text-secondary">
                  {Math.round(box.width)} × {Math.round(box.height)} px
                </span>

                <button
                  type="button"
                  data-canvas-crop-confirm="true"
                  onClick={handleConfirm}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-600"
                >
                  <Crop size={14} />
                  裁剪并生成节点
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
