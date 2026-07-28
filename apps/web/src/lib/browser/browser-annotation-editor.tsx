import {
  ArrowUpRight,
  Circle,
  Eraser,
  Minus,
  Pencil,
  Plus,
  Square,
  Type,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type AnnotationPoint = { x: number; y: number };
type Annotation =
  | { type: "pen"; color: string; points: AnnotationPoint[] }
  | {
      type: "arrow" | "rect" | "circle";
      color: string;
      from: AnnotationPoint;
      to: AnnotationPoint;
    }
  | {
      type: "text";
      color: string;
      at: AnnotationPoint;
      text: string;
      fontSize: number;
    };
type Tool = "pen" | "arrow" | "rect" | "circle" | "text";
type PendingText = { at: AnnotationPoint; value: string };

type AnnotationTextInputPosition = {
  left: string;
  top: string;
  transform: string;
};

const COLORS = ["#ef4444", "#2563eb", "#16a34a", "#111827"];
const MIN_TEXT_SIZE = 14;
const MAX_TEXT_SIZE = 72;
const TEXT_SIZE_STEP = 2;

export function clampAnnotationFontSize(value: number): number {
  return Math.max(MIN_TEXT_SIZE, Math.min(MAX_TEXT_SIZE, value));
}

export function getAnnotationInputFontSize(
  fontSize: number,
  renderScale: number,
): number {
  const safeScale =
    Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
  return fontSize * safeScale;
}

export function getAnnotationTextInputPosition(
  at: AnnotationPoint,
  dimensions: { width: number; height: number },
): AnnotationTextInputPosition {
  const xRatio = Math.max(0, Math.min(1, at.x / dimensions.width));
  const yRatio = Math.max(0, Math.min(1, at.y / dimensions.height));
  return {
    left: `${xRatio * 100}%`,
    top: `${yRatio * 100}%`,
    transform: "translate(0, -100%)",
  };
}

function getArrowHeadPoints(
  from: AnnotationPoint,
  to: AnnotationPoint,
): [AnnotationPoint, AnnotationPoint] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const length = Math.min(24, Math.max(12, distance * 0.2));
  const spread = Math.PI / 7;
  return [
    {
      x: to.x - length * Math.cos(angle - spread),
      y: to.y - length * Math.sin(angle - spread),
    },
    {
      x: to.x - length * Math.cos(angle + spread),
      y: to.y - length * Math.sin(angle + spread),
    },
  ];
}

export function buildArrowPath(
  from: AnnotationPoint,
  to: AnnotationPoint,
): string {
  const [left, right] = getArrowHeadPoints(from, to);
  return `M ${from.x} ${from.y} L ${to.x} ${to.y} M ${left.x} ${left.y} L ${to.x} ${to.y} L ${right.x} ${right.y}`;
}

function pointFromEvent(
  event: React.PointerEvent<SVGSVGElement>,
  width: number,
  height: number,
): AnnotationPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * width,
    y: ((event.clientY - rect.top) / rect.height) * height,
  };
}

function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
): void {
  context.strokeStyle = annotation.color;
  context.fillStyle = annotation.color;
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (annotation.type === "text") {
    context.font = `${annotation.fontSize}px sans-serif`;
    context.fillText(annotation.text, annotation.at.x, annotation.at.y);
    return;
  }
  context.beginPath();
  if (annotation.type === "pen") {
    const [first, ...rest] = annotation.points;
    if (!first) return;
    context.moveTo(first.x, first.y);
    for (const point of rest) context.lineTo(point.x, point.y);
  } else if (annotation.type === "arrow") {
    const [left, right] = getArrowHeadPoints(annotation.from, annotation.to);
    context.moveTo(annotation.from.x, annotation.from.y);
    context.lineTo(annotation.to.x, annotation.to.y);
    context.moveTo(left.x, left.y);
    context.lineTo(annotation.to.x, annotation.to.y);
    context.lineTo(right.x, right.y);
  } else if (annotation.type === "rect") {
    context.rect(
      annotation.from.x,
      annotation.from.y,
      annotation.to.x - annotation.from.x,
      annotation.to.y - annotation.from.y,
    );
  } else {
    context.ellipse(
      (annotation.from.x + annotation.to.x) / 2,
      (annotation.from.y + annotation.to.y) / 2,
      Math.abs(annotation.to.x - annotation.from.x) / 2,
      Math.abs(annotation.to.y - annotation.from.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
  }
  context.stroke();
}

export function BrowserAnnotationEditor({
  imageUrl,
  onClose,
  onAddToChat,
}: {
  imageUrl: string;
  onClose: () => void;
  onAddToChat: (imageUrl: string) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [imageRenderScale, setImageRenderScale] = useState(1);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>("#ef4444");
  const [textFontSize, setTextFontSize] = useState(24);
  const [pendingText, setPendingText] = useState<PendingText | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);

  const visibleAnnotations = useMemo(
    () => (draft ? [...annotations, draft] : annotations),
    [annotations, draft],
  );

  useEffect(() => {
    imageRef.current?.focus();
  }, []);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const syncRenderScale = (): void => {
      if (image.naturalWidth > 0) {
        setImageRenderScale(
          image.getBoundingClientRect().width / image.naturalWidth,
        );
      }
    };
    syncRenderScale();
    const observer = new ResizeObserver(syncRenderScale);
    observer.observe(image);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!pendingText) return;
    const input = textInputRef.current;
    input?.focus({ preventScroll: true });
    const frame = window.requestAnimationFrame(() => {
      input?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingText]);

  const commitPendingText = (): void => {
    if (!pendingText) return;
    const text = pendingText.value;
    if (text.trim()) {
      setAnnotations((current) => [
        ...current,
        {
          type: "text",
          color,
          at: pendingText.at,
          text,
          fontSize: textFontSize,
        },
      ]);
    }
    setPendingText(null);
  };

  const begin = (event: React.PointerEvent<SVGSVGElement>): void => {
    const at = pointFromEvent(event, dimensions.width, dimensions.height);
    if (tool === "text") {
      event.preventDefault();
      setPendingText({ at, value: "" });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft(
      tool === "pen"
        ? { type: "pen", color, points: [at] }
        : { type: tool, color, from: at, to: at },
    );
  };

  const move = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!draft || !event.currentTarget.hasPointerCapture(event.pointerId))
      return;
    const at = pointFromEvent(event, dimensions.width, dimensions.height);
    setDraft((current) => {
      if (!current) return null;
      return current.type === "pen"
        ? { ...current, points: [...current.points, at] }
        : current.type === "text"
          ? current
          : { ...current, to: at };
    });
  };

  const finish = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (draft) setAnnotations((current) => [...current, draft]);
    setDraft(null);
  };

  const exportImage = async (): Promise<void> => {
    const image = imageRef.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    for (const annotation of annotations) drawAnnotation(context, annotation);
    onAddToChat(canvas.toDataURL("image/png"));
  };

  const toolButtons = [
    ["pen", Pencil, "画笔"],
    ["arrow", ArrowUpRight, "箭头"],
    ["rect", Square, "矩形"],
    ["circle", Circle, "圆形"],
    ["text", Type, "文字"],
  ] as const;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-surface-1">
      <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        {toolButtons.map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            title={label}
            aria-label={label}
            onClick={() => {
              setPendingText(null);
              setTool(value);
            }}
            className={`flex size-8 items-center justify-center rounded-md ${tool === value ? "bg-surface-3 text-text-primary" : "text-text-muted hover:bg-surface-2"}`}
          >
            <Icon size={15} />
          </button>
        ))}
        {COLORS.map((value) => (
          <button
            key={value}
            type="button"
            title={value}
            aria-label={`color ${value}`}
            onClick={() => setColor(value)}
            className={`size-5 rounded-full border-2 ${color === value ? "border-text-primary" : "border-transparent"}`}
            style={{ backgroundColor: value }}
          />
        ))}
        {tool === "text" && (
          <div
            className="ml-1 flex h-8 items-center rounded-md border border-border bg-surface-1"
            aria-label="文字大小"
          >
            <button
              type="button"
              title="减小文字"
              aria-label="减小文字"
              disabled={textFontSize <= MIN_TEXT_SIZE}
              onClick={() =>
                setTextFontSize((size) =>
                  clampAnnotationFontSize(size - TEXT_SIZE_STEP),
                )
              }
              className="flex size-7 items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-30"
            >
              <Minus size={13} />
            </button>
            <span className="w-9 text-center text-[11px] tabular-nums text-text-secondary">
              {textFontSize}
            </span>
            <button
              type="button"
              title="增大文字"
              aria-label="增大文字"
              disabled={textFontSize >= MAX_TEXT_SIZE}
              onClick={() =>
                setTextFontSize((size) =>
                  clampAnnotationFontSize(size + TEXT_SIZE_STEP),
                )
              }
              className="flex size-7 items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-30"
            >
              <Plus size={13} />
            </button>
          </div>
        )}
        <button
          type="button"
          title="撤销"
          aria-label="撤销"
          disabled={annotations.length === 0}
          onClick={() => setAnnotations((current) => current.slice(0, -1))}
          className="ml-auto flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 disabled:opacity-30"
        >
          <Eraser size={15} />
        </button>
        <button
          type="button"
          onClick={() => void exportImage()}
          className="h-8 rounded-md bg-text-primary px-3 text-xs font-medium text-surface-1"
        >
          加入对话
        </button>
        <button
          type="button"
          title="关闭"
          aria-label="关闭"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"
        >
          <X size={16} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto bg-surface-2 p-3">
        <div className="relative mx-auto w-fit max-w-full shadow-sm">
          <img
            ref={imageRef}
            src={imageUrl}
            alt="页面截图"
            tabIndex={-1}
            onLoad={(event) => {
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
              setImageRenderScale(
                event.currentTarget.getBoundingClientRect().width /
                  event.currentTarget.naturalWidth,
              );
            }}
            className="block max-h-full max-w-full select-none"
            draggable={false}
          />
          <svg
            viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
            data-annotation-hit-layer="true"
            className={`pointer-events-auto absolute inset-0 size-full touch-none ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={finish}
          >
            <title>页面标注层</title>
            <rect
              width={dimensions.width}
              height={dimensions.height}
              fill="transparent"
              pointerEvents="all"
            />
            {visibleAnnotations.map((annotation, index) => {
              const key = `${annotation.type}:${index}`;
              if (annotation.type === "text") {
                return (
                  <text
                    key={key}
                    x={annotation.at.x}
                    y={annotation.at.y}
                    fill={annotation.color}
                    fontSize={annotation.fontSize}
                    fontFamily="sans-serif"
                    pointerEvents="none"
                  >
                    {annotation.text}
                  </text>
                );
              }
              if (annotation.type === "pen") {
                return (
                  <polyline
                    key={key}
                    points={annotation.points
                      .map((point) => `${point.x},${point.y}`)
                      .join(" ")}
                    fill="none"
                    stroke={annotation.color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                );
              }
              if (annotation.type === "arrow") {
                return (
                  <path
                    key={key}
                    d={buildArrowPath(annotation.from, annotation.to)}
                    fill="none"
                    stroke={annotation.color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                );
              }
              if (annotation.type === "rect") {
                return (
                  <rect
                    key={key}
                    x={Math.min(annotation.from.x, annotation.to.x)}
                    y={Math.min(annotation.from.y, annotation.to.y)}
                    width={Math.abs(annotation.to.x - annotation.from.x)}
                    height={Math.abs(annotation.to.y - annotation.from.y)}
                    fill="none"
                    stroke={annotation.color}
                    strokeWidth="4"
                    pointerEvents="none"
                  />
                );
              }
              return (
                <ellipse
                  key={key}
                  cx={(annotation.from.x + annotation.to.x) / 2}
                  cy={(annotation.from.y + annotation.to.y) / 2}
                  rx={Math.abs(annotation.to.x - annotation.from.x) / 2}
                  ry={Math.abs(annotation.to.y - annotation.from.y) / 2}
                  fill="none"
                  stroke={annotation.color}
                  strokeWidth="4"
                  pointerEvents="none"
                />
              );
            })}
            {pendingText?.value && (
              <text
                data-annotation-pending-text="true"
                x={pendingText.at.x}
                y={pendingText.at.y}
                fill={color}
                fontSize={textFontSize}
                fontFamily="sans-serif"
                pointerEvents="none"
              >
                {pendingText.value}
              </text>
            )}
          </svg>
          {pendingText && (
            <input
              ref={textInputRef}
              value={pendingText.value}
              onChange={(event) =>
                setPendingText((current) =>
                  current ? { ...current, value: event.target.value } : null,
                )
              }
              onBlur={commitPendingText}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") setPendingText(null);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label="截图文字"
              className="absolute z-10 w-[220px] appearance-none border-0 bg-transparent p-0 text-transparent shadow-none outline-none ring-1 ring-blue-500"
              style={{
                ...getAnnotationTextInputPosition(pendingText.at, dimensions),
                caretColor: color,
                fontFamily: "sans-serif",
                fontSize: getAnnotationInputFontSize(
                  textFontSize,
                  imageRenderScale,
                ),
                lineHeight: 1,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
