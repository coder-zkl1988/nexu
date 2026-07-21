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
import { ParamPill, SettingsGroup } from "./param-pills";
import { setDraft, useDraft } from "./prompt-drafts";
import {
  type AudioFormat,
  type ImageQuality,
  audioSettingsSummary,
  buildAudioGenOpts,
  buildImageGenOpts,
  buildVideoGenOpts,
  imageQualityLabel,
  imageSettingsSummary,
  mentionQueryAt,
  mergeUpstreamPrompt,
  upstreamSummary,
  usableReferencePaths,
  videoSettingsSummary,
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
  const [imageTransparent, setImageTransparent] = useState(false);
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

  // Available models for the picker (shared ["models"] cache), narrowed to
  // the node's modality (image → tabby-image/tabby-image-free, video →
  // tabby-video; audio has no dedicated backend yet → full list).
  const models = useCanvasModelOptions(
    node.type as "image" | "video" | "audio",
  );

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
  // Image references only ever reach the backend request in image mode —
  // video/audio generation has no reference-media field at all. Showing the
  // image thumbnails/count for a video/audio node would promise something
  // that silently never happens, so the summary only reflects what THIS
  // node's generate call actually consumes. Upstream video/audio content has
  // no consumer anywhere yet, so it never appears in the summary either.
  const isImageNode = node.type === "image";
  const summary = upstreamSummary(
    {
      prompts: upstream.prompts,
      images: isImageNode ? upstream.images : [],
      videos: [],
      audios: [],
    },
    isImageNode ? usablePaths.length : 0,
  );
  // The actual prompt sent to generation: the panel's own draft plus any
  // connected upstream text nodes (matches config-node-logic.ts's plan
  // builder so the "文本 N" badge above isn't a decoration).
  const mergedPrompt = mergeUpstreamPrompt(prompt, upstream.prompts);

  // Mention candidates: upstream nodes with non-empty titles. Image nodes
  // carry their content as a thumbnail so the dropdown shows the real
  // picture being referenced (reference-parity v0.9 paradigm).
  const mentionCandidates = upstreamNodes
    .filter((n) => n.title.trim() !== "")
    .map((n) => ({
      title: n.title,
      thumbnail:
        n.type === "image" && n.metadata.content ? n.metadata.content : null,
    }));

  // Filter by query (case-insensitive contains)
  const filteredCandidates = mentionActive
    ? mentionCandidates.filter((c) =>
        c.title.toLowerCase().includes(mentionQuery.toLowerCase()),
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
        if (candidate !== undefined) insertMention(candidate.title);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setMentionActive(false);
      }
    },
    [mentionActive, filteredCandidates, mentionHighlight, insertMention],
  );

  // Fire generation
  const handleGenerate = useCallback(() => {
    if (!mergedPrompt || isGenerating) return;
    if (node.type === "image") {
      void generateImageIntoNode(
        nodeId,
        mergedPrompt,
        buildImageGenOpts({
          referenceImages: usablePaths.length > 0 ? usablePaths : undefined,
          count: imageCount,
          model,
          quality: imageQuality,
          aspectRatio: imageAspect,
          size: imageSize,
          transparentBackground: imageTransparent,
        }),
      );
    } else if (node.type === "video") {
      void generateVideoIntoNode(
        nodeId,
        mergedPrompt,
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
        mergedPrompt,
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
    mergedPrompt,
    isGenerating,
    node.type,
    nodeId,
    usablePaths,
    model,
    imageCount,
    imageQuality,
    imageAspect,
    imageSize,
    imageTransparent,
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
      {/* Upstream summary line: real thumbnails of the images that will feed
          generation (max 4 = backend reference cap), then the text summary.
          Image-only — video/audio generation has no reference-media field,
          so showing thumbnails there would imply a feed that never happens. */}
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        {isImageNode
          ? upstream.images
              .slice(0, 4)
              .map((src) => (
                <img
                  key={src}
                  src={src}
                  alt=""
                  className="size-6 shrink-0 rounded object-cover ring-1 ring-border"
                  draggable={false}
                />
              ))
          : null}
        {isImageNode && upstream.images.length > 4 ? (
          <span className="shrink-0 text-text-tertiary">
            +{upstream.images.length - 4}
          </span>
        ) : null}
        <span className="min-w-0 truncate text-text-tertiary">{summary}</span>
      </div>

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
            {filteredCandidates.map((candidate, idx) => (
              <li key={candidate.title}>
                <button
                  type="button"
                  className={
                    idx === mentionHighlight
                      ? "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs bg-surface-2 text-text-primary"
                      : "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-surface-2 text-text-secondary"
                  }
                  onPointerDown={(e: MouseEvent) => {
                    // Prevent blur on the textarea
                    e.preventDefault();
                  }}
                  onClick={() => insertMention(candidate.title)}
                >
                  {candidate.thumbnail ? (
                    <img
                      src={candidate.thumbnail}
                      alt=""
                      className="size-5 shrink-0 rounded object-cover ring-1 ring-border"
                      draggable={false}
                    />
                  ) : null}
                  <span className="min-w-0 truncate">@{candidate.title}</span>
                </button>
              </li>
            ))}
          </ul>
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
            {node.type === "image"
              ? imageSettingsSummary({
                  quality: imageQuality,
                  aspectRatio: imageAspect,
                  size: imageSize,
                  count: imageCount,
                })
              : node.type === "video"
                ? videoSettingsSummary({
                    durationSeconds: videoDuration,
                    resolution: videoResolution,
                    aspectRatio: videoAspect,
                  })
                : audioSettingsSummary({
                    voice: audioVoice,
                    speed: audioSpeed,
                    format: audioFormat,
                  })}
          </span>
        </button>

        {/* Send — flex-pushed to end, circular (reference dock) */}
        <button
          type="button"
          data-canvas-panel-generate="true"
          aria-label="生成"
          disabled={isGenerating || !mergedPrompt}
          onClick={handleGenerate}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <ArrowUp size={15} />
        </button>

        {/* 生成设置 popover — anchored above the bottom row (reference) */}
        {settingsOpen ? (
          <div
            data-canvas-image-settings-panel="true"
            className="absolute bottom-[calc(100%+10px)] right-0 z-50 w-[264px] rounded-xl border border-border bg-surface-1/95 p-3 shadow-xl backdrop-blur"
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          >
            <p className="pb-2 text-sm font-medium text-text-primary">
              {node.type === "image"
                ? "图像设置"
                : node.type === "video"
                  ? "视频设置"
                  : "音频设置"}
            </p>
            {node.type === "image" && (
              <>
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
                <SettingsGroup label="透明背景">
                  <ParamPill
                    active={!imageTransparent}
                    onClick={() => setImageTransparent(false)}
                  >
                    关
                  </ParamPill>
                  <ParamPill
                    active={imageTransparent}
                    onClick={() => setImageTransparent(true)}
                  >
                    开
                  </ParamPill>
                </SettingsGroup>
              </>
            )}
            {node.type === "video" && (
              <>
                <div className="flex items-center gap-2 pb-2.5 text-xs">
                  <span className="shrink-0 text-[11px] font-medium text-text-tertiary">
                    时长(秒)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={videoDuration}
                    onChange={(e) => setVideoDuration(Number(e.target.value))}
                    className="w-20 rounded-lg border-0 bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none"
                  />
                </div>
                <SettingsGroup label="分辨率">
                  {(["720p", "1080p"] as const).map((r) => (
                    <ParamPill
                      key={r}
                      active={videoResolution === r}
                      onClick={() => setVideoResolution(r)}
                    >
                      {r}
                    </ParamPill>
                  ))}
                </SettingsGroup>
                <SettingsGroup label="宽高比">
                  <ParamPill
                    active={videoAspect === ""}
                    onClick={() => setVideoAspect("")}
                  >
                    默认
                  </ParamPill>
                  {["16:9", "9:16", "1:1"].map((r) => (
                    <ParamPill
                      key={r}
                      active={videoAspect === r}
                      onClick={() => setVideoAspect(r)}
                    >
                      {r}
                    </ParamPill>
                  ))}
                </SettingsGroup>
                <SettingsGroup label="其他">
                  <ParamPill
                    active={videoGenerateAudio}
                    onClick={() => setVideoGenerateAudio((v) => !v)}
                  >
                    生成声音
                  </ParamPill>
                  <ParamPill
                    active={videoWatermark}
                    onClick={() => setVideoWatermark((v) => !v)}
                  >
                    水印
                  </ParamPill>
                </SettingsGroup>
              </>
            )}
            {node.type === "audio" && (
              <>
                <div className="flex items-center gap-2 pb-2.5 text-xs">
                  <span className="shrink-0 text-[11px] font-medium text-text-tertiary">
                    音色
                  </span>
                  <input
                    type="text"
                    value={audioVoice}
                    onChange={(e) => setAudioVoice(e.target.value)}
                    placeholder="默认"
                    className="min-w-0 flex-1 rounded-lg border-0 bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none"
                  />
                </div>
                <SettingsGroup label="语速">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                    <ParamPill
                      key={s}
                      active={audioSpeed === s}
                      onClick={() => setAudioSpeed(s)}
                    >
                      {s}x
                    </ParamPill>
                  ))}
                </SettingsGroup>
                <SettingsGroup label="格式">
                  <ParamPill
                    active={audioFormat === ""}
                    onClick={() => setAudioFormat("")}
                  >
                    默认
                  </ParamPill>
                  {(["mp3", "wav", "m4a", "ogg", "flac"] as const).map((f) => (
                    <ParamPill
                      key={f}
                      active={audioFormat === f}
                      onClick={() => setAudioFormat(f)}
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
                    value={audioInstructions}
                    onChange={(e) => setAudioInstructions(e.target.value)}
                    placeholder="可选"
                    className="min-w-0 flex-1 rounded-lg border-0 bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none"
                  />
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
