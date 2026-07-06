/**
 * config-node.tsx
 *
 * Config generation node UI (W2.4). Aggregates upstream inputs, holds
 * per-mode params, and on 生成 creates a downstream result node via the
 * T2/T4 generation seam.
 *
 * NOTE: model/aspect-ratio pickers are intentionally absent — the channels
 * do not accept those params yet. Add them when the channels do.
 */

import type { CanvasNode } from "./canvas-store";
import { updateNode } from "./canvas-store";
import {
  buildConfigGenerationPlan,
  runConfigGeneration,
} from "./config-node-logic";
import { upstreamSummary, usableReferencePaths } from "./prompt-panel-utils";
import { collectUpstream } from "./resource-references";

// ── ConfigNodeContent ──────────────────────────────────────────

export function ConfigNodeContent({ node }: { node: CanvasNode }) {
  const cfg = node.metadata.config;
  const mode = cfg?.mode ?? "image";

  const upstream = collectUpstream(node.id);
  const usableImages = usableReferencePaths(upstream.images).length;
  const summary = upstreamSummary(upstream, usableImages);

  const plan = buildConfigGenerationPlan(node.id);
  // "no-config" should not happen during normal use (mode always defaults to image)
  const noPrompt = "error" in plan && plan.error === "no-prompt";

  function stopProp(e: React.PointerEvent) {
    e.stopPropagation();
  }

  function setMode(newMode: "image" | "video" | "audio") {
    // Switching mode resets all mode-specific params to undefined.
    updateNode(node.id, {
      metadata: { config: { mode: newMode } },
    });
  }

  function setParam(
    patch: Partial<NonNullable<CanvasNode["metadata"]["config"]>>,
  ) {
    updateNode(node.id, {
      metadata: { config: { ...(cfg ?? { mode: "image" }), ...patch } },
    });
  }

  return (
    <div
      className="flex h-full w-full flex-col gap-2 select-text"
      onPointerDown={stopProp}
    >
      {/* Upstream summary */}
      <div className="text-[10px] text-text-tertiary">{summary}</div>

      {/* Mode segmented control */}
      <div className="flex shrink-0 rounded-md border border-border text-[11px]">
        {(
          [
            { value: "image", label: "图" },
            { value: "video", label: "视频" },
            { value: "audio", label: "音频" },
          ] as const
        ).map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onPointerDown={stopProp}
            onClick={() => setMode(value)}
            className={`flex-1 py-0.5 text-center transition-colors ${
              mode === value
                ? "bg-surface-3 font-medium text-text-primary"
                : "text-text-secondary hover:bg-surface-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Per-mode param row */}
      {mode === "image" && (
        <div className="flex items-center gap-1 text-[11px]">
          <span className="shrink-0 text-text-tertiary">数量</span>
          <select
            value={cfg?.count ?? 1}
            onPointerDown={stopProp}
            onChange={(e) => setParam({ count: Number(e.target.value) })}
            className="flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-text-primary"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === "video" && (
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-text-tertiary">时长(秒)</span>
            <input
              type="number"
              min={1}
              max={60}
              value={cfg?.durationSeconds ?? ""}
              onPointerDown={stopProp}
              onChange={(e) =>
                setParam({
                  durationSeconds: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              placeholder="1-60"
              className="flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-text-primary outline-none"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-text-tertiary">分辨率</span>
            <select
              value={cfg?.resolution ?? ""}
              onPointerDown={stopProp}
              onChange={(e) =>
                setParam({
                  resolution:
                    e.target.value === ""
                      ? undefined
                      : (e.target.value as "720p" | "1080p"),
                })
              }
              className="flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-text-primary"
            >
              <option value="">默认</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </div>
        </div>
      )}

      {mode === "audio" && (
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-text-tertiary">音色</span>
            <input
              type="text"
              value={cfg?.voice ?? ""}
              onPointerDown={stopProp}
              onChange={(e) => setParam({ voice: e.target.value || undefined })}
              placeholder="音色标识"
              className="flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-text-primary outline-none"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-text-tertiary">语速</span>
            <select
              value={cfg?.speed ?? ""}
              onPointerDown={stopProp}
              onChange={(e) =>
                setParam({
                  speed:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
              className="flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-text-primary"
            >
              <option value="">默认</option>
              <option value="0.5">0.5x</option>
              <option value="0.75">0.75x</option>
              <option value="1">1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>
          </div>
        </div>
      )}

      {/* No-prompt hint */}
      {noPrompt && (
        <p className="text-[10px] text-text-tertiary">连入文本节点作为提示词</p>
      )}

      {/* Generate button */}
      <button
        type="button"
        data-canvas-config-generate={node.id}
        disabled={noPrompt}
        onPointerDown={stopProp}
        onClick={() => {
          void runConfigGeneration(node.id);
        }}
        className="mt-auto shrink-0 rounded-full border border-[var(--color-accent)] bg-[var(--color-accent)] py-1 text-[11px] font-bold text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
      >
        生成
      </button>
    </div>
  );
}
