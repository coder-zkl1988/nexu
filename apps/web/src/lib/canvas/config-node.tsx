/**
 * config-node.tsx
 *
 * Config generation node UI (W2.4 + W5). Aggregates upstream inputs (shown as
 * typed chips), holds per-mode generation params + a base "组装提示词", and on
 * 生成 creates a downstream result node via the T2/T4 generation seam. Per-mode
 * params (model/quality/aspect/…) are best-effort hints.
 */

import { useState } from "react";
import { useCanvasModelOptions } from "./canvas-model-options";
import type { CanvasNode } from "./canvas-store";
import { updateNode } from "./canvas-store";
import {
  buildConfigGenerationPlan,
  runConfigGeneration,
} from "./config-node-logic";
import { usableReferencePaths } from "./prompt-panel-utils";
import { collectUpstream } from "./resource-references";

type SelectOption = { value: string; label: string };
const opt = (value: string, label = value): SelectOption => ({ value, label });

const IMAGE_ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const IMAGE_SIZES = ["1K", "2K", "4K"];
const VIDEO_ASPECTS = ["16:9", "9:16", "1:1"];
const AUDIO_FORMATS = ["mp3", "wav", "m4a", "ogg", "flac"] as const;

// ── ConfigNodeContent ──────────────────────────────────────────

export function ConfigNodeContent({ node }: { node: CanvasNode }) {
  const cfg = node.metadata.config;
  const mode = cfg?.mode ?? "image";
  const models = useCanvasModelOptions();
  const [composerOpen, setComposerOpen] = useState(false);

  const upstream = collectUpstream(node.id);
  const chips = [
    { label: "提示词", n: upstream.prompts.length },
    { label: "参考图", n: usableReferencePaths(upstream.images).length },
    { label: "参考视频", n: upstream.videos.length },
    { label: "参考音频", n: upstream.audios.length },
  ].filter((c) => c.n > 0);

  const plan = buildConfigGenerationPlan(node.id);
  const hasPlanError = "error" in plan;
  const noPrompt = hasPlanError && plan.error === "no-prompt";

  function stopProp(e: React.PointerEvent) {
    e.stopPropagation();
  }

  // Switching mode drops every mode-specific param and the model hint — a model
  // picked for images means nothing for audio, and our model list carries no
  // capability metadata to check it against, so fall back to the default. Only
  // the modality-agnostic composedPrompt survives.
  function setMode(newMode: "image" | "video" | "audio" | "text") {
    updateNode(node.id, {
      metadata: {
        config: {
          mode: newMode,
          ...(cfg?.composedPrompt !== undefined
            ? { composedPrompt: cfg.composedPrompt }
            : {}),
        },
      },
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
      {/* Typed upstream input chips */}
      <div className="flex flex-wrap gap-1">
        {chips.length === 0 ? (
          <span className="text-[10px] text-text-tertiary">无上游输入</span>
        ) : (
          chips.map((c) => (
            <span
              key={c.label}
              className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary"
            >
              {c.label} {c.n}
            </span>
          ))
        )}
      </div>

      {/* Mode segmented control */}
      <div className="flex shrink-0 rounded-md border border-border text-[11px]">
        {(
          [
            { value: "image", label: "图" },
            { value: "video", label: "视频" },
            { value: "audio", label: "音频" },
            { value: "text", label: "文本" },
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

      {/* Per-mode params */}
      {mode === "image" && (
        <div className="flex flex-col gap-1">
          <ParamSelect
            label="质量"
            value={cfg?.quality ?? "auto"}
            onChange={(v) =>
              setParam({ quality: v as "auto" | "high" | "medium" | "low" })
            }
            options={[opt("auto"), opt("high"), opt("medium"), opt("low")]}
            stopProp={stopProp}
          />
          <ParamSelect
            label="比例"
            value={cfg?.aspectRatio ?? ""}
            onChange={(v) => setParam({ aspectRatio: v || undefined })}
            options={[opt("", "默认"), ...IMAGE_ASPECTS.map((a) => opt(a))]}
            stopProp={stopProp}
          />
          <ParamSelect
            label="尺寸"
            value={cfg?.size ?? ""}
            onChange={(v) => setParam({ size: v || undefined })}
            options={[opt("", "默认"), ...IMAGE_SIZES.map((s) => opt(s))]}
            stopProp={stopProp}
          />
          <ParamSelect
            label="数量"
            value={String(cfg?.count ?? 1)}
            onChange={(v) => setParam({ count: Number(v) })}
            options={Array.from({ length: 12 }, (_, i) => opt(String(i + 1)))}
            stopProp={stopProp}
          />
        </div>
      )}

      {mode === "video" && (
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-1">
            <span className="w-12 shrink-0 text-text-tertiary">时长(秒)</span>
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
          <ParamSelect
            label="分辨率"
            value={cfg?.resolution ?? ""}
            onChange={(v) =>
              setParam({
                resolution: v === "" ? undefined : (v as "720p" | "1080p"),
              })
            }
            options={[opt("", "默认"), opt("720p"), opt("1080p")]}
            stopProp={stopProp}
          />
          <ParamSelect
            label="比例"
            value={cfg?.aspectRatio ?? ""}
            onChange={(v) => setParam({ aspectRatio: v || undefined })}
            options={[opt("", "默认"), ...VIDEO_ASPECTS.map((a) => opt(a))]}
            stopProp={stopProp}
          />
          <label className="flex items-center gap-1 text-[11px] text-text-secondary">
            <input
              type="checkbox"
              checked={cfg?.generateAudio ?? false}
              onPointerDown={stopProp}
              onChange={(e) =>
                setParam({ generateAudio: e.target.checked || undefined })
              }
            />
            生成声音
          </label>
          <label className="flex items-center gap-1 text-[11px] text-text-secondary">
            <input
              type="checkbox"
              checked={cfg?.watermark ?? false}
              onPointerDown={stopProp}
              onChange={(e) =>
                setParam({ watermark: e.target.checked || undefined })
              }
            />
            水印
          </label>
        </div>
      )}

      {mode === "audio" && (
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-1">
            <span className="w-12 shrink-0 text-text-tertiary">音色</span>
            <input
              type="text"
              value={cfg?.voice ?? ""}
              onPointerDown={stopProp}
              onChange={(e) => setParam({ voice: e.target.value || undefined })}
              placeholder="音色标识"
              className="flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-text-primary outline-none"
            />
          </div>
          <ParamSelect
            label="语速"
            value={cfg?.speed !== undefined ? String(cfg.speed) : ""}
            onChange={(v) =>
              setParam({ speed: v === "" ? undefined : Number(v) })
            }
            options={[
              opt("", "默认"),
              opt("0.5", "0.5x"),
              opt("0.75", "0.75x"),
              opt("1", "1x"),
              opt("1.25", "1.25x"),
              opt("1.5", "1.5x"),
              opt("2", "2x"),
            ]}
            stopProp={stopProp}
          />
          <ParamSelect
            label="格式"
            value={cfg?.format ?? ""}
            onChange={(v) =>
              setParam({
                format:
                  v === ""
                    ? undefined
                    : (v as "mp3" | "wav" | "m4a" | "ogg" | "flac"),
              })
            }
            options={[opt("", "默认"), ...AUDIO_FORMATS.map((f) => opt(f))]}
            stopProp={stopProp}
          />
          <div className="flex items-center gap-1">
            <span className="w-12 shrink-0 text-text-tertiary">声音指令</span>
            <input
              type="text"
              value={cfg?.instructions ?? ""}
              onPointerDown={stopProp}
              onChange={(e) =>
                setParam({ instructions: e.target.value || undefined })
              }
              placeholder="可选"
              className="flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-text-primary outline-none"
            />
          </div>
        </div>
      )}

      {/* Model picker (all modes) */}
      <ParamSelect
        label="模型"
        value={cfg?.model ?? ""}
        onChange={(v) => setParam({ model: v || undefined })}
        options={[opt("", "默认模型"), ...models.map((m) => opt(m.id, m.name))]}
        stopProp={stopProp}
      />

      {/* 组装提示词 composer (collapsed base prompt) */}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onPointerDown={stopProp}
          onClick={() => setComposerOpen((v) => !v)}
          className="self-start text-[10px] text-text-tertiary hover:text-text-secondary"
        >
          {composerOpen ? "▾ 组装提示词" : "▸ 组装提示词"}
        </button>
        {composerOpen && (
          <textarea
            value={cfg?.composedPrompt ?? ""}
            onPointerDown={stopProp}
            onChange={(e) =>
              setParam({ composedPrompt: e.target.value || undefined })
            }
            placeholder="在上游提示词前追加的基础提示词（可选）"
            rows={2}
            className="w-full resize-none rounded border border-border bg-transparent px-1 py-0.5 text-[11px] text-text-primary outline-none"
          />
        )}
      </div>

      {/* No-prompt hint */}
      {noPrompt && (
        <p className="text-[10px] text-text-tertiary">
          连入文本节点或填写组装提示词
        </p>
      )}

      {/* Generate button */}
      <button
        type="button"
        data-canvas-config-generate={node.id}
        disabled={hasPlanError}
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

// Small labelled select shared across the config node's param rows.
function ParamSelect({
  label,
  value,
  onChange,
  options,
  stopProp,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<SelectOption>;
  stopProp: (e: React.PointerEvent) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-[11px]">
      <span className="w-12 shrink-0 text-text-tertiary">{label}</span>
      <select
        value={value}
        onPointerDown={stopProp}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-text-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
