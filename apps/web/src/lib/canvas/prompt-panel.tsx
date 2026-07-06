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
import type { CanvasNode } from "./canvas-store";
import { getDraft, setDraft } from "./prompt-drafts";
import {
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
      void generateImageIntoNode(nodeId, trimmed, {
        referenceImages: usablePaths.length > 0 ? usablePaths : undefined,
        count: imageCount > 1 ? imageCount : undefined,
      });
    } else if (node.type === "video") {
      void generateVideoIntoNode(nodeId, trimmed, {
        durationSeconds: videoDuration,
        resolution: videoResolution,
      });
    } else if (node.type === "audio") {
      void generateAudioIntoNode(nodeId, trimmed, {
        voice: audioVoice.trim() || undefined,
        speed: audioSpeed !== 1 ? audioSpeed : undefined,
      });
    }
  }, [
    prompt,
    isGenerating,
    node.type,
    nodeId,
    usablePaths,
    imageCount,
    videoDuration,
    videoResolution,
    audioVoice,
    audioSpeed,
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

      {/* Per-type params row */}
      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
        {node.type === "image" ? (
          <>
            <label className="flex items-center gap-1 text-text-secondary">
              数量
              <select
                value={imageCount}
                onChange={(e) => setImageCount(Number(e.target.value))}
                className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
                onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              >
                {[1, 2, 3, 4].map((n) => (
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
          </>
        ) : null}

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
