/**
 * config-node.tsx
 *
 * Config generation node UI (W2.4 + W5, reference-parity layout). Aggregates
 * upstream inputs (typed count chips), holds per-mode generation params + a
 * base "组装提示词", and on 开始生成 creates a downstream result node via the
 * T2/T4 generation seam. Per-mode params (model/quality/aspect/…) are
 * best-effort hints.
 *
 * Layout follows the reference config panel: header (title + icon segmented
 * mode control) → input chips row (+ composer toggle) → model / settings
 * grid → expandable pill-style params → full-width 开始生成 button.
 */

import {
  Image as ImageIcon,
  MessageSquare,
  Music2,
  Play,
  Settings2,
  SlidersHorizontal,
  Video,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useCanvasModelOptions } from "./canvas-model-options";
import type { CanvasNode } from "./canvas-store";
import { updateNode } from "./canvas-store";
import {
  buildConfigGenerationPlan,
  runConfigGeneration,
} from "./config-node-logic";
import { ParamPill, SettingsGroup } from "./param-pills";
import {
  imageSettingsSummary,
  usableReferencePaths,
} from "./prompt-panel-utils";
import { collectUpstream } from "./resource-references";

const IMAGE_ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const IMAGE_SIZES = ["1K", "2K", "4K"];
const VIDEO_ASPECTS = ["16:9", "9:16", "1:1"];
const AUDIO_FORMATS = ["mp3", "wav", "m4a", "ogg", "flac"] as const;
const AUDIO_SPEEDS = ["0.5", "0.75", "1", "1.25", "1.5", "2"];

const MODES = [
  { value: "image", label: "生图", icon: ImageIcon },
  { value: "text", label: "文本", icon: MessageSquare },
  { value: "video", label: "视频", icon: Video },
  { value: "audio", label: "音频", icon: Music2 },
] as const;

// ── ConfigNodeContent ──────────────────────────────────────────

export function ConfigNodeContent({ node }: { node: CanvasNode }) {
  const cfg = node.metadata.config;
  const mode = cfg?.mode ?? "image";
  const models = useCanvasModelOptions(mode);
  const [composerOpen, setComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const upstream = collectUpstream(node.id);
  const imageCount = usableReferencePaths(upstream.images).length;

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

  const settingsSummary =
    mode === "image"
      ? imageSettingsSummary({
          quality: cfg?.quality ?? "auto",
          aspectRatio: cfg?.aspectRatio ?? "",
          size: cfg?.size ?? "",
          count: cfg?.count ?? 1,
        })
      : "设置";

  return (
    <div className="flex h-full w-full select-text flex-col gap-2.5 text-sm">
      {/* Header: title + icon segmented mode control (reference layout) */}
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-sm font-semibold text-text-primary">
          生成配置
        </span>
        <div
          className="grid shrink-0 grid-cols-4 gap-0.5 rounded-lg bg-surface-2 p-0.5 text-[11px]"
          onPointerDown={stopProp}
        >
          {MODES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`flex items-center justify-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
                mode === value
                  ? "bg-surface-1 text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Typed upstream input chips + composer toggle (reference chips row) */}
      <div className="flex flex-wrap gap-1.5" onPointerDown={stopProp}>
        <InputChip label="提示词" value={`${upstream.prompts.length} 个`} />
        <InputChip label="参考图" value={`${imageCount} 张`} />
        <InputChip label="参考视频" value={`${upstream.videos.length} 个`} />
        <InputChip label="参考音频" value={`${upstream.audios.length} 个`} />
        <button
          type="button"
          onClick={() => setComposerOpen((v) => !v)}
          className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors ${
            composerOpen
              ? "border-text-primary text-text-primary"
              : "border-border bg-surface-2/60 text-text-secondary hover:text-text-primary"
          }`}
        >
          <Settings2 size={12} />
          组装提示词
        </button>
      </div>

      {composerOpen && (
        <textarea
          value={cfg?.composedPrompt ?? ""}
          onPointerDown={stopProp}
          onChange={(e) =>
            setParam({ composedPrompt: e.target.value || undefined })
          }
          placeholder="在上游提示词前追加的基础提示词（可选）"
          rows={2}
          className="w-full resize-none rounded-lg border-0 bg-surface-2 px-2.5 py-2 text-xs text-text-primary outline-none placeholder:text-text-tertiary"
        />
      )}

      {/* Model picker + per-mode settings toggle (reference two-column grid) */}
      <div
        className={`grid min-w-0 items-center gap-1.5 ${mode === "text" ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_auto]"}`}
        onPointerDown={stopProp}
      >
        <label className="flex h-9 min-w-0 items-center rounded-lg border border-border px-2 text-xs text-text-secondary">
          <span className="shrink-0 pr-1.5 text-text-tertiary">模型</span>
          <select
            value={cfg?.model ?? ""}
            onChange={(e) => setParam({ model: e.target.value || undefined })}
            className="min-w-0 flex-1 cursor-pointer truncate bg-transparent text-xs outline-none"
          >
            <option value="">默认模型</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {mode !== "text" && (
          <button
            type="button"
            data-canvas-config-settings={node.id}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors ${
              settingsOpen
                ? "border-text-primary text-text-primary"
                : "border-border text-text-secondary hover:text-text-primary"
            }`}
          >
            <SlidersHorizontal size={13} />
            <span className="max-w-[120px] truncate whitespace-nowrap">
              {settingsSummary}
            </span>
          </button>
        )}
      </div>

      {/* Expandable per-mode params — pill groups (in-flow; the node body
          scrolls, so a popover would clip) */}
      {settingsOpen && mode !== "text" && (
        <div
          className="rounded-xl border border-border bg-surface-1 p-2.5"
          onPointerDown={stopProp}
        >
          {mode === "image" && (
            <>
              <SettingsGroup label="质量">
                {(["auto", "high", "medium", "low"] as const).map((q) => (
                  <ParamPill
                    key={q}
                    active={(cfg?.quality ?? "auto") === q}
                    onClick={() => setParam({ quality: q })}
                  >
                    {q === "auto"
                      ? "自动"
                      : q === "high"
                        ? "高"
                        : q === "medium"
                          ? "中"
                          : "低"}
                  </ParamPill>
                ))}
              </SettingsGroup>
              <SettingsGroup label="宽高比">
                <ParamPill
                  active={!cfg?.aspectRatio}
                  onClick={() => setParam({ aspectRatio: undefined })}
                >
                  默认
                </ParamPill>
                {IMAGE_ASPECTS.map((a) => (
                  <ParamPill
                    key={a}
                    active={cfg?.aspectRatio === a}
                    onClick={() => setParam({ aspectRatio: a })}
                  >
                    {a}
                  </ParamPill>
                ))}
              </SettingsGroup>
              <SettingsGroup label="尺寸">
                <ParamPill
                  active={!cfg?.size}
                  onClick={() => setParam({ size: undefined })}
                >
                  默认
                </ParamPill>
                {IMAGE_SIZES.map((s) => (
                  <ParamPill
                    key={s}
                    active={cfg?.size === s}
                    onClick={() => setParam({ size: s })}
                  >
                    {s}
                  </ParamPill>
                ))}
              </SettingsGroup>
              <SettingsGroup label="生成张数">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <ParamPill
                    key={n}
                    active={(cfg?.count ?? 1) === n}
                    onClick={() => setParam({ count: n })}
                  >
                    {n} 张
                  </ParamPill>
                ))}
              </SettingsGroup>
            </>
          )}

          {mode === "video" && (
            <>
              <div className="flex items-center gap-2 pb-2.5 text-xs">
                <span className="shrink-0 text-[11px] font-medium text-text-tertiary">
                  时长(秒)
                </span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={cfg?.durationSeconds ?? ""}
                  onChange={(e) =>
                    setParam({
                      durationSeconds: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                  placeholder="默认"
                  className="w-20 rounded-lg border-0 bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none"
                />
              </div>
              <SettingsGroup label="分辨率">
                <ParamPill
                  active={!cfg?.resolution}
                  onClick={() => setParam({ resolution: undefined })}
                >
                  默认
                </ParamPill>
                {(["720p", "1080p"] as const).map((r) => (
                  <ParamPill
                    key={r}
                    active={cfg?.resolution === r}
                    onClick={() => setParam({ resolution: r })}
                  >
                    {r}
                  </ParamPill>
                ))}
              </SettingsGroup>
              <SettingsGroup label="宽高比">
                <ParamPill
                  active={!cfg?.aspectRatio}
                  onClick={() => setParam({ aspectRatio: undefined })}
                >
                  默认
                </ParamPill>
                {VIDEO_ASPECTS.map((a) => (
                  <ParamPill
                    key={a}
                    active={cfg?.aspectRatio === a}
                    onClick={() => setParam({ aspectRatio: a })}
                  >
                    {a}
                  </ParamPill>
                ))}
              </SettingsGroup>
              <SettingsGroup label="其他">
                <ParamPill
                  active={cfg?.generateAudio ?? false}
                  onClick={() =>
                    setParam({
                      generateAudio: cfg?.generateAudio ? undefined : true,
                    })
                  }
                >
                  生成声音
                </ParamPill>
                <ParamPill
                  active={cfg?.watermark ?? false}
                  onClick={() =>
                    setParam({ watermark: cfg?.watermark ? undefined : true })
                  }
                >
                  水印
                </ParamPill>
              </SettingsGroup>
            </>
          )}

          {mode === "audio" && (
            <>
              <div className="flex items-center gap-2 pb-2.5 text-xs">
                <span className="shrink-0 text-[11px] font-medium text-text-tertiary">
                  音色
                </span>
                <input
                  type="text"
                  value={cfg?.voice ?? ""}
                  onChange={(e) =>
                    setParam({ voice: e.target.value || undefined })
                  }
                  placeholder="默认"
                  className="min-w-0 flex-1 rounded-lg border-0 bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none"
                />
              </div>
              <SettingsGroup label="语速">
                <ParamPill
                  active={cfg?.speed === undefined}
                  onClick={() => setParam({ speed: undefined })}
                >
                  默认
                </ParamPill>
                {AUDIO_SPEEDS.map((s) => (
                  <ParamPill
                    key={s}
                    active={cfg?.speed === Number(s)}
                    onClick={() => setParam({ speed: Number(s) })}
                  >
                    {s}x
                  </ParamPill>
                ))}
              </SettingsGroup>
              <SettingsGroup label="格式">
                <ParamPill
                  active={!cfg?.format}
                  onClick={() => setParam({ format: undefined })}
                >
                  默认
                </ParamPill>
                {AUDIO_FORMATS.map((f) => (
                  <ParamPill
                    key={f}
                    active={cfg?.format === f}
                    onClick={() => setParam({ format: f })}
                  >
                    {f}
                  </ParamPill>
                ))}
              </SettingsGroup>
              <div className="flex items-center gap-2 pt-0.5 text-xs">
                <span className="shrink-0 text-[11px] font-medium text-text-tertiary">
                  声音指令
                </span>
                <input
                  type="text"
                  value={cfg?.instructions ?? ""}
                  onChange={(e) =>
                    setParam({ instructions: e.target.value || undefined })
                  }
                  placeholder="可选"
                  className="min-w-0 flex-1 rounded-lg border-0 bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* No-prompt hint */}
      {noPrompt && (
        <p className="text-[11px] text-text-tertiary">
          连入文本节点或填写组装提示词
        </p>
      )}

      {/* Generate — full-width bottom button (reference layout) */}
      <button
        type="button"
        data-canvas-config-generate={node.id}
        disabled={hasPlanError}
        onPointerDown={stopProp}
        onClick={() => {
          void runConfigGeneration(node.id);
        }}
        className="mt-auto flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] text-xs font-medium text-[var(--color-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Play size={14} />
        开始生成
      </button>
    </div>
  );
}

/** Bordered input-count chip (reference InputChip). */
function InputChip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-2/60 px-2 text-[11px] text-text-secondary">
      <span>{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}
