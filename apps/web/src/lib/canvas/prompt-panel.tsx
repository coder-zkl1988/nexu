/**
 * prompt-panel.tsx
 *
 * Per-node prompt panel (W2.4) — rendered INSIDE the world-space transform
 * layer of CanvasSurface, anchored under the selected node.
 *
 * Visibility rule: exactly ONE node selected AND type ∈ {image, video, audio}.
 *
 * @mention contract:
 *   Mentions typed in the prompt textarea are PLAIN TEXT — they add human
 *   context to the prompt but do NOT directly control which images are fed.
 *   Image references auto-attach from the upstream graph via
 *   `usableReferencePaths(collectUpstream(nodeId).images)` at generate time.
 */

import { isImeComposing } from "@/lib/keyboard";
import { ArrowUp, BookOpen, SlidersHorizontal } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { openCanvasDialog } from "./canvas-dialogs";
import {
  generateAudioIntoNode,
  generateImageIntoNode,
  generateVideoIntoNode,
} from "./canvas-generation";
import { useCanvasModelOptions } from "./canvas-model-options";
import type { CanvasNode } from "./canvas-store";
import { setDraft, useDraft } from "./prompt-drafts";
import {
  type AudioFormat,
  type ImageQuality,
  buildAudioGenOpts,
  buildImageGenOpts,
  buildVideoGenOpts,
  imageQualityLabel,
  imageSettingsSummary,
  mentionQueryAt,
  upstreamSummary,
  usableReferencePaths,
} from "./prompt-panel-utils";
import { collectUpstream, collectUpstreamNodes } from "./resource-references";

// ── Panel ──────────────────────────────────────────────────────

type PromptPanelProps = {
  node: CanvasNode;
};

export function PromptPanel({ node }: PromptPanelProps) {
  // Per-node draft backed by the subscribable prompt-drafts store — reactive
  // so the prompt-library dialog inserting a prompt updates the open panel.
  const nodeId = node.id;
  const prompt = useDraft(nodeId);

  const updatePrompt = useCallback(
    (value: string) => {
      setDraft(nodeId, value);
    },
    [nodeId],
  );

  // Per-type params
  const [imageCount, setImageCount] = useState<number>(1);
  const [videoDuration, setVideoDuration] = useState<number>(5);
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p">(
    "720p",
  );
  const [audioVoice, setAudioVoice] = useState<string>("");
  const [audioSpeed, setAudioSpeed] = useState<number>(1);

  // W5 settings — all ephemeral local state (no persistence, matching above).
  // Model hint ("" = default model). A model picked for one modality is
  // meaningless for another, and our model list carries no capability metadata
  // to validate it against — so the hint is dropped whenever the selected
  // node's type changes, and never leaks image → audio. (React's "adjust state
  // during render when a prop changes" pattern; an effect would lint-fail and
  // render one stale frame first.)
  const [model, setModel] = useState<string>("");
  const [modelNodeType, setModelNodeType] = useState(node.type);
  if (modelNodeType !== node.type) {
    setModelNodeType(node.type);
    setModel("");
  }
  // Image-only
  const [imageQuality, setImageQuality] = useState<ImageQuality>("auto");
  const [imageAspect, setImageAspect] = useState<string>("");
  const [imageSize, setImageSize] = useState<string>("");
  // Image settings popover (reference-parity: params live behind a summary
  // chip, not inline). Closed on node switch via the keyed state below.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNodeId, setSettingsNodeId] = useState(nodeId);
  if (settingsNodeId !== nodeId) {
    setSettingsNodeId(nodeId);
    setSettingsOpen(false);
  }
  // Video-only
  const [videoAspect, setVideoAspect] = useState<string>("");
  const [videoGenerateAudio, setVideoGenerateAudio] = useState<boolean>(false);
  const [videoWatermark, setVideoWatermark] = useState<boolean>(false);
  // Audio-only
  const [audioFormat, setAudioFormat] = useState<AudioFormat | "">("");
  const [audioInstructions, setAudioInstructions] = useState<string>("");

  // Available models for the picker (shared ["models"] cache).
  const models = useCanvasModelOptions();

  // @-mention dropdown state
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Compute upstream info at render (cheap, selected-node only)
  const upstream = collectUpstream(nodeId);
  const upstreamNodes = collectUpstreamNodes(nodeId);
  const usablePaths = usableReferencePaths(upstream.images);
  const summary = upstreamSummary(upstream, usablePaths.length);

  // Mention candidates: upstream nodes with non-empty titles
  const mentionCandidates = upstreamNodes
    .map((n) => n.title)
    .filter((t) => t.trim() !== "");

  // Filter by query (case-insensitive contains)
  const filteredCandidates = mentionActive
    ? mentionCandidates.filter((title) =>
        title.toLowerCase().includes(mentionQuery.toLowerCase()),
      )
    : [];

  const isGenerating = node.metadata.task?.status === "generating";

  // Update mention state on textarea value/caret changes
  const updateMentionState = useCallback((value: string, caret: number) => {
    const token = mentionQueryAt(value, caret);
    if (token) {
      setMentionActive(true);
      setMentionQuery(token.query);
      setMentionStart(token.start);
      setMentionHighlight(0);
    } else {
      setMentionActive(false);
    }
  }, []);

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      updatePrompt(value);
      const caret = e.target.selectionStart ?? value.length;
      updateMentionState(value, caret);
    },
    [updatePrompt, updateMentionState],
  );

  const handleTextareaCaret = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      updateMentionState(ta.value, ta.selectionStart ?? ta.value.length);
    },
    [updateMentionState],
  );

  // Insert a mention: replace the active @-token with `@<title> `
  const insertMention = useCallback(
    (title: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const before = prompt.slice(0, mentionStart);
      const after = prompt.slice(ta.selectionStart ?? prompt.length);
      const inserted = `${before}@${title} ${after}`;
      updatePrompt(inserted);
      setMentionActive(false);
      // Restore focus and set caret after the inserted mention
      setTimeout(() => {
        ta.focus();
        const pos = mentionStart + title.length + 2; // "@" + title + " "
        ta.setSelectionRange(pos, pos);
      }, 0);
    },
    [prompt, mentionStart, updatePrompt],
  );

  // Keyboard navigation inside the mention dropdown
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!mentionActive || filteredCandidates.length === 0) return;
      // While an IME composes, arrows/Enter drive its candidate list, not ours.
      if (isImeComposing(e)) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionHighlight((h) =>
          Math.min(h + 1, filteredCandidates.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const candidate = filteredCandidates[mentionHighlight];
        if (candidate !== undefined) insertMention(candidate);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setMentionActive(false);
      }
    },
    [mentionActive, filteredCandidates, mentionHighlight, insertMention],
  );

  // Fire generation
  const handleGenerate = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    if (node.type === "image") {
      void generateImageIntoNode(
        nodeId,
        trimmed,
        buildImageGenOpts({
          referenceImages: usablePaths.length > 0 ? usablePaths : undefined,
          count: imageCount,
          model,
          quality: imageQuality,
          aspectRatio: imageAspect,
          size: imageSize,
        }),
      );
    } else if (node.type === "video") {
      void generateVideoIntoNode(
        nodeId,
        trimmed,
        buildVideoGenOpts({
          durationSeconds: videoDuration,
          resolution: videoResolution,
          aspectRatio: videoAspect,
          generateAudio: videoGenerateAudio,
          watermark: videoWatermark,
          model,
        }),
      );
    } else if (node.type === "audio") {
      void generateAudioIntoNode(
        nodeId,
        trimmed,
        buildAudioGenOpts({
          voice: audioVoice,
          speed: audioSpeed,
          model,
          format: audioFormat,
          instructions: audioInstructions,
        }),
      );
    }
  }, [
    prompt,
    isGenerating,
    node.type,
    nodeId,
    usablePaths,
    model,
    imageCount,
    imageQuality,
    imageAspect,
    imageSize,
    videoDuration,
    videoResolution,
    videoAspect,
    videoGenerateAudio,
    videoWatermark,
    audioVoice,
    audioSpeed,
    audioFormat,
    audioInstructions,
  ]);

  const placeholder =
    node.type === "image"
      ? "描述要生成的图片内容"
      : node.type === "video"
        ? "描述要生成的视频内容"
        : "描述要生成的音频内容";

  // Fixed panel width, centered under the node (reference: w-[500px]
  // -translate-x-1/2). Never tracks the node's width — a narrow node must
  // not squeeze the bottom-row chips into wrapping their own text.
  const PANEL_WIDTH = 500;

  return (
    <div
      data-canvas-prompt-panel={nodeId}
      className="rounded-2xl border border-border bg-surface-1 shadow-xl p-2.5 text-xs"
      style={{
        position: "absolute",
        left: node.position.x + node.size.width / 2 - PANEL_WIDTH / 2,
        top: node.position.y + node.size.height + 16,
        width: PANEL_WIDTH,
      }}
      onPointerDown={(e: React.PointerEvent) => {
        // Prevent panel interactions from starting pans or clearing selection
        e.stopPropagation();
      }}
    >
      {/* Upstream summary line */}
      <div className="mb-1.5 px-1 text-text-tertiary truncate">{summary}</div>

      {/* Prompt textarea + mention dropdown (relative container) */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="w-full select-text resize-none rounded-xl border-0 bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-text-tertiary"
          rows={3}
          placeholder={placeholder}
          value={prompt}
          onChange={handleTextareaChange}
          onKeyUp={handleTextareaCaret}
          onClick={handleTextareaCaret}
          onKeyDown={handleKeyDown}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
        />

        {/* @-mention dropdown */}
        {mentionActive && filteredCandidates.length > 0 ? (
          <ul
            data-canvas-mention-list="true"
            className="absolute left-0 z-50 max-h-32 overflow-y-auto rounded border border-border bg-surface-1 shadow-md"
            style={{ bottom: "100%", marginBottom: 2, minWidth: 120 }}
          >
            {filteredCandidates.map((title, idx) => (
              <li key={title}>
                <button
                  type="button"
                  className={
                    idx === mentionHighlight
                      ? "w-full px-2 py-1 text-left text-xs bg-surface-2 text-text-primary"
                      : "w-full px-2 py-1 text-left text-xs hover:bg-surface-2 text-text-secondary"
                  }
                  onPointerDown={(e: MouseEvent) => {
                    // Prevent blur on the textarea
                    e.preventDefault();
                  }}
                  onClick={() => insertMention(title)}
                >
                  @{title}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Per-type params row — best-effort generation hints. Image params
          live in the settings popover (reference paradigm); video/audio keep
          inline rows. */}
      <div className="mt-2 flex flex-wrap gap-1 items-center">
        {node.type === "video" ? (
          <>
            <label className="flex items-center gap-1 text-text-secondary">
              时长(秒)
              <input
                type="number"
                min={1}
                max={60}
                value={videoDuration}
                onChange={(e) => setVideoDuration(Number(e.target.value))}
                className="w-14 rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              />
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              分辨率
              <select
                value={videoResolution}
                onChange={(e) =>
                  setVideoResolution(e.target.value as "720p" | "1080p")
                }
                className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              比例
              <select
                value={videoAspect}
                onChange={(e) => setVideoAspect(e.target.value)}
                className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              >
                <option value="">默认</option>
                {["16:9", "9:16", "1:1"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              <input
                type="checkbox"
                checked={videoGenerateAudio}
                onChange={(e) => setVideoGenerateAudio(e.target.checked)}
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              />
              生成声音
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              <input
                type="checkbox"
                checked={videoWatermark}
                onChange={(e) => setVideoWatermark(e.target.checked)}
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              />
              水印
            </label>
          </>
        ) : node.type === "audio" ? (
          <>
            <label className="flex items-center gap-1 text-text-secondary">
              音色
              <input
                type="text"
                value={audioVoice}
                onChange={(e) => setAudioVoice(e.target.value)}
                placeholder="默认"
                className="w-20 rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              />
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              语速
              <select
                value={audioSpeed}
                onChange={(e) => setAudioSpeed(Number(e.target.value))}
                className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              >
                {[0.5, 1, 1.5, 2].map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              格式
              <select
                value={audioFormat}
                onChange={(e) =>
                  setAudioFormat(e.target.value as AudioFormat | "")
                }
                className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              >
                <option value="">默认</option>
                {["mp3", "wav", "m4a", "ogg", "flac"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              声音指令
              <input
                type="text"
                value={audioInstructions}
                onChange={(e) => setAudioInstructions(e.target.value)}
                placeholder="可选"
                className="w-28 rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              />
            </label>
          </>
        ) : null}
      </div>

      {/* Bottom row: library · model pill · image settings chip · send */}
      <div className="relative mt-2 flex items-center gap-1.5">
        <button
          type="button"
          aria-label="提示词库"
          data-canvas-prompt-library-toggle="true"
          onClick={() => {
            setSettingsOpen(false);
            openCanvasDialog({ kind: "prompt-library", nodeId });
          }}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          <BookOpen size={15} />
        </button>
        <label
          aria-label="模型"
          className="flex h-8 min-w-0 shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-surface-1 px-1 text-xs text-text-secondary hover:text-text-primary"
        >
          <span className="pl-1.5 pr-1 text-text-tertiary">模型</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="max-w-[150px] cursor-pointer truncate bg-transparent pr-1 text-xs outline-none"
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          >
            <option value="">默认模型</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        {node.type === "image" ? (
          <button
            type="button"
            data-canvas-image-settings-toggle="true"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors ${settingsOpen ? "border-text-primary text-text-primary" : "border-border text-text-secondary hover:text-text-primary"}`}
          >
            <SlidersHorizontal size={13} />
            <span className="whitespace-nowrap">
              {imageSettingsSummary({
                quality: imageQuality,
                aspectRatio: imageAspect,
                size: imageSize,
                count: imageCount,
              })}
            </span>
          </button>
        ) : null}

        {/* Send — flex-pushed to end, circular (reference dock) */}
        <button
          type="button"
          data-canvas-panel-generate="true"
          aria-label="生成"
          disabled={isGenerating || !prompt.trim()}
          onClick={handleGenerate}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <ArrowUp size={15} />
        </button>

        {/* 图像设置 popover — anchored above the bottom row (reference) */}
        {node.type === "image" && settingsOpen ? (
          <div
            data-canvas-image-settings-panel="true"
            className="absolute bottom-[calc(100%+10px)] right-0 z-50 w-[264px] rounded-xl border border-border bg-surface-1/95 p-3 shadow-xl backdrop-blur"
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          >
            <p className="pb-2 text-sm font-medium text-text-primary">
              图像设置
            </p>
            <SettingsGroup label="质量">
              {(["auto", "high", "medium", "low"] as const).map((q) => (
                <ParamPill
                  key={q}
                  active={imageQuality === q}
                  onClick={() => setImageQuality(q)}
                >
                  {imageQualityLabel(q)}
                </ParamPill>
              ))}
            </SettingsGroup>
            <SettingsGroup label="宽高比">
              <ParamPill
                active={imageAspect === ""}
                onClick={() => setImageAspect("")}
              >
                默认
              </ParamPill>
              {["1:1", "3:4", "4:3", "9:16", "16:9"].map((r) => (
                <ParamPill
                  key={r}
                  active={imageAspect === r}
                  onClick={() => setImageAspect(r)}
                >
                  {r}
                </ParamPill>
              ))}
            </SettingsGroup>
            <SettingsGroup label="尺寸">
              <ParamPill
                active={imageSize === ""}
                onClick={() => setImageSize("")}
              >
                默认
              </ParamPill>
              {["1K", "2K", "4K"].map((s) => (
                <ParamPill
                  key={s}
                  active={imageSize === s}
                  onClick={() => setImageSize(s)}
                >
                  {s}
                </ParamPill>
              ))}
            </SettingsGroup>
            <SettingsGroup label="生成张数">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <ParamPill
                  key={n}
                  active={imageCount === n}
                  onClick={() => setImageCount(n)}
                >
                  {n} 张
                </ParamPill>
              ))}
            </SettingsGroup>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Labeled pill group inside the image settings popover. */
function SettingsGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="pb-2.5 last:pb-0">
      <p className="pb-1.5 text-[11px] font-medium text-text-tertiary">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** Selectable pill button (reference 图像设置 paradigm). */
function ParamPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-text-primary text-text-primary"
          : "border-border text-text-secondary hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
