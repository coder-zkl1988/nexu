/**
 * canvas-op-card.tsx
 *
 * S8 "chat drives the canvas" (W4.5b) — the confirm card that appears inline in
 * chat when the agent emits a canvas-op batch. The user reviews a compact op
 * list and chooses 应用 (apply) or 忽略 (dismiss).
 *
 * Confirm-only by design (this task). A future trust/auto-apply mode would skip
 * this card and call applyCanvasOps() directly on arrival — the executor is
 * already the single apply seam, so that hook needs no executor change.
 */

import type { CanvasOp } from "@nexu/shared";
import { LayoutGrid } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { applyCanvasOps } from "./canvas-ops-executor";

export interface CanvasOpBatchView {
  ops: CanvasOp[];
  summary?: string;
}

/** One-line human label for an op (compact op-list rendering). */
function opLabel(op: CanvasOp): string {
  switch (op.op) {
    case "add_node":
      return `+ ${nodeTypeLabel(op.nodeType)}节点`;
    case "update_node":
      return "更新节点";
    case "delete_node":
      return "删除节点";
    case "connect":
      return "连接";
    case "delete_connection":
      return "删除连接";
    case "set_viewport":
      return "设视口";
    case "select":
      return "选择节点";
    case "run_generation":
      return "运行生成";
    case "crop_image":
      return "裁剪";
    case "split_image":
      return `拆分为 ${op.rows}×${op.cols}`;
    case "upscale_image":
      return `放大到 ${
        op.targetLongEdge >= 4096
          ? "4K"
          : op.targetLongEdge >= 2048
            ? "2K"
            : "1K"
      }`;
    case "enhance_image":
      return op.operation === "multi-angle" ? "多角度" : "超分";
    case "describe_image":
      return "反推提示词";
    case "save_asset":
      return "存入素材库";
    case "insert_asset":
      return "从素材库插入";
  }
}

function nodeTypeLabel(type: string): string {
  switch (type) {
    case "text":
      return "文本";
    case "image":
      return "图片";
    case "video":
      return "视频";
    case "audio":
      return "音频";
    case "config":
      return "生成配置";
    default:
      return "节点";
  }
}

export function CanvasOpCard({ batch }: { batch: CanvasOpBatchView }) {
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <div
        data-canvas-op-card
        data-canvas-op-state="dismissed"
        className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1.5 text-[12px] text-text-muted"
      >
        已忽略画布操作
      </div>
    );
  }

  const summaryText = batch.summary ?? `${batch.ops.length} 项操作`;

  const handleApply = () => {
    const result = applyCanvasOps(batch);
    toast.success(`已应用 ${result.applied} 项`);
    if (result.errors.length > 0) {
      toast.error(`${result.errors.length} 项未能应用`);
    }
    setApplied(true);
  };

  return (
    <div
      data-canvas-op-card
      data-canvas-op-state={applied ? "applied" : "pending"}
      className="mt-1 w-full min-w-[18rem] max-w-full rounded-[20px] border border-border bg-surface-1 px-4 py-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-[var(--color-info-subtle)] text-[var(--color-info)]">
          <LayoutGrid className="size-[14px]" />
        </span>
        <span className="text-[13px] font-medium text-text-primary">
          画布操作
        </span>
      </div>

      <div className="mt-1.5 text-[12px] text-text-secondary">
        {summaryText}
      </div>

      <ul className="mt-2 flex flex-col gap-0.5">
        {batch.ops.map((op, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: ops are a static, order-stable batch
            key={i}
            data-canvas-op-line
            className="text-[11px] text-text-muted"
          >
            {opLabel(op)}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-canvas-op-apply
          disabled={applied}
          onClick={handleApply}
          className="inline-flex items-center rounded-full bg-surface-3 px-3.5 py-1.5 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-default disabled:opacity-60"
        >
          {applied ? "已应用" : "应用"}
        </button>
        <button
          type="button"
          data-canvas-op-dismiss
          disabled={applied}
          onClick={() => setDismissed(true)}
          className="inline-flex items-center rounded-full border border-border px-3.5 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-2 disabled:cursor-default disabled:opacity-60"
        >
          忽略
        </button>
      </div>
    </div>
  );
}
