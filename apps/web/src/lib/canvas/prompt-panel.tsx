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

import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  generateAudioIntoNode,
  generateImageIntoNode,
  generateVideoIntoNode,
} from "./canvas-generation";
import { useCanvasModelOptions } from "./canvas-model-options";
import type { CanvasNode } from "./canvas-store";
import { getDraft, setDraft } from "./prompt-drafts";
import {
  type AudioFormat,
  type ImageQuality,
  buildAudioGenOpts,
  buildImageGenOpts,
  buildVideoGenOpts,
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
  // Per-node draft backed by module-level Map (survives selection changes)
  const [prompt, setPromptState] = useState(() => getDraft(node.id));

  // Re-sync prompt when the selected node changes
  const nodeId = node.id;
  useEffect(() => {
    setPromptState(getDraft(nodeId));
  }, [nodeId]);

  const updatePrompt = useCallback(
    (value: string) => {
      setPromptState(value);
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
  // Shared across modes: model hint ("" = default model).
  const [model, setModel] = useState<string>("");
  // Image-only
  const [imageQuality, setImageQuality] = useState<ImageQuality>("auto");
  const [imageAspect, setImageAspect] = useState<string>("");
  const [imageSize, setImageSize] = useState<string>("");
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

  return (
    <div
      data-canvas-prompt-panel={nodeId}
      className="rounded-xl border-2 border-border bg-surface-1 shadow-lg p-2 text-xs"
      style={{
        position: "absolute",
        left: node.position.x,
        top: node.position.y + node.size.height + 12,
        width: Math.max(node.size.width, 320),
      }}
      onPointerDown={(e: React.PointerEvent) => {
        // Prevent panel interactions from starting pans or clearing selection
        e.stopPropagation();
      }}
    >
      {/* Upstream summary line */}
      <div className="mb-1.5 text-text-tertiary truncate">{summary}</div>

      {/* Prompt textarea + mention dropdown (relative container) */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="w-full select-text resize-none rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
          rows={2}
          placeholder="描述要生成的内容…"
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

      {/* Per-type params row — best-effort generation hints */}
      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
        {node.type === "image" ? (
          <>
            <label className="flex items-center gap-1 text-text-secondary">
              质量
              <select
                value={imageQuality}
                onChange={(e) =>
                  setImageQuality(e.target.value as ImageQuality)
                }
                className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              >
                <option value="auto">auto</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              比例
              <select
                value={imageAspect}
                onChange={(e) => setImageAspect(e.target.value)}
                className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              >
                <option value="">默认</option>
                {["1:1", "3:4", "4:3", "9:16", "16:9"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              尺寸
              <select
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value)}
                className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              >
                <option value="">默认</option>
                {["1K", "2K", "4K"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-text-secondary">
              数量
              <select
                value={imageCount}
                onChange={(e) => setImageCount(Number(e.target.value))}
                className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : node.type === "video" ? (
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

      {/* Model picker + generate row (model is a shared best-effort hint) */}
      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
        <label className="flex items-center gap-1 text-text-secondary">
          模型
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="max-w-[140px] rounded border border-border bg-transparent px-1 py-0.5 text-xs"
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

        {/* Generate button — flex-pushed to end */}
        <div className="ml-auto">
          <button
            type="button"
            data-canvas-panel-generate="true"
            disabled={isGenerating || !prompt.trim()}
            onClick={handleGenerate}
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
            className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-2 py-1 text-xs font-bold text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
          >
            生成
          </button>
        </div>
      </div>
    </div>
  );
}
