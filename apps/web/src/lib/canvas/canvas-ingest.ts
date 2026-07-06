/**
 * canvas-ingest.ts
 *
 * Pure, DOM-free helpers for ingesting files and text into the canvas store
 * (plan items W1.2 + W1.3). No FileReader, no DragEvent, no ClipboardEvent
 * — all I/O is pre-resolved by the time these helpers are called, making them
 * trivially unit-testable in a plain Node environment.
 */

import { addNode } from "./canvas-store";

// ── MIME sniffing ──────────────────────────────────────────────

export function mediaTypeForMime(
  mime: string,
): "image" | "video" | "audio" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

// ── File ingestion ─────────────────────────────────────────────

export type IngestFileInput = { name: string; type: string; dataUrl: string };

/**
 * For each file with a recognized media type, add a node at `dropPoint`
 * offset by index (`x + index * 24`, `y + index * 24`).
 * Unrecognized MIME types are skipped.
 * Returns the number of nodes created.
 */
export function ingestFilesAsNodes(
  files: ReadonlyArray<IngestFileInput>,
  dropPoint: { x: number; y: number },
): number {
  let created = 0;
  for (const file of files) {
    const mediaType = mediaTypeForMime(file.type);
    if (mediaType === null) continue;
    addNode({
      type: mediaType,
      title: file.name,
      position: {
        x: dropPoint.x + created * 24,
        y: dropPoint.y + created * 24,
      },
      metadata: { content: file.dataUrl, mimeType: file.type },
    });
    created++;
  }
  return created;
}

// ── Text ingestion ─────────────────────────────────────────────

/**
 * Trim the text; if empty do nothing; else add a text node at `point`
 * with title = first 20 chars of the trimmed text, content = full trimmed text.
 */
export function ingestTextAsNode(
  text: string,
  point: { x: number; y: number },
): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  addNode({
    type: "text",
    title: trimmed.slice(0, 20),
    position: point,
    metadata: { content: trimmed },
  });
}
