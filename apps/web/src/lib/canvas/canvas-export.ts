/**
 * canvas-export.ts — export the board (or selected elements) as a ZIP.
 *
 * Interaction paradigm borrowed from the reference infinite-canvas app
 * (AGPL — no code reuse; implementation is original). Zero library deps per
 * repo rules: hand-rolled ZIP writer using the STORE method — media content
 * (png/jpg/mp4/mp3) is already compressed, so deflate would buy nothing.
 *
 * Board export layout:
 *   board.json        — PersistedCanvas-shaped snapshot; media node content
 *                       is rewritten to a relative `files/...` path
 *   files/<node>.<ext> — one file per media node with resolvable content
 *
 * Element export layout: media → files, text → .txt, everything else → .json.
 * A2UI surfaces live outside the store (runtime map) and are not exported.
 */

import { getCanvasBoards } from "./canvas-boards";
import type { CanvasConnection, CanvasNode } from "./canvas-store";
import { getCanvasState } from "./canvas-store";

// ── Minimal ZIP writer (STORE method) ──────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE 802.3), as required by the ZIP format. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc =
      (CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

/**
 * Build an uncompressed (STORE) ZIP archive. Names are UTF-8 (general
 * purpose flag bit 11 set) so Chinese filenames survive extraction.
 */
export function buildZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [
    v & 0xff,
    (v >>> 8) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 24) & 0xff,
  ];

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    // version 20, flags: bit 11 (UTF-8 names), method 0 (STORE), zeroed DOS time
    const common = [
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(name.length),
      ...u16(0),
    ];
    const local = new Uint8Array([...u32(0x04034b50), ...common]);
    chunks.push(local, name, entry.data);

    const centralHeader = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...common,
      ...u16(0), // comment len
      ...u16(0), // disk start
      ...u16(0), // internal attrs
      ...u32(0), // external attrs
      ...u32(offset),
    ]);
    central.push(centralHeader, name);
    offset += local.length + name.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ]);

  return new Blob([...chunks, ...central, eocd] as BlobPart[], {
    type: "application/zip",
  });
}

// ── Content resolution ─────────────────────────────────────────

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

function extForMime(mime: string, nodeType: string): string {
  const known = MIME_EXT[mime.split(";")[0] ?? ""];
  if (known) return known;
  if (nodeType === "image") return "png";
  if (nodeType === "video") return "mp4";
  if (nodeType === "audio") return "mp3";
  return "bin";
}

/** Keep CJK/word characters; collapse everything else to `-`. */
function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "元素";
}

type ResolvedContent = { bytes: Uint8Array; mime: string };

/**
 * Resolve a media node's content string (data URL or servable URL) into
 * bytes. Returns null when it cannot be resolved — the caller keeps the
 * original inline content so the export never silently drops data.
 */
async function resolveContent(
  content: string,
): Promise<ResolvedContent | null> {
  try {
    if (content.startsWith("data:")) {
      const comma = content.indexOf(",");
      if (comma < 0) return null;
      const header = content.slice(5, comma);
      const body = content.slice(comma + 1);
      const mime = (header.split(";")[0] || "application/octet-stream").trim();
      if (header.includes("base64")) {
        const binary = atob(body);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return { bytes, mime };
      }
      return {
        bytes: new TextEncoder().encode(decodeURIComponent(body)),
        mime,
      };
    }
    const response = await fetch(content);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return {
      bytes: new Uint8Array(buffer),
      mime: response.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

const MEDIA_TYPES = new Set(["image", "video", "audio"]);

// ── Board export ───────────────────────────────────────────────

export type BoardExportPayload = {
  app: "nexu-canvas";
  version: 1;
  exportedAt: string;
  boardName: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
};

/**
 * Assemble the ZIP entries for a full-board export. Media node content is
 * externalized into `files/`; nodes whose content cannot be resolved keep
 * their inline content in board.json.
 */
export async function buildBoardExport(
  boardName: string,
  nodes: CanvasNode[],
  connections: CanvasConnection[],
): Promise<ZipEntry[]> {
  const files: ZipEntry[] = [];
  const used = new Set<string>();

  const exportedNodes: CanvasNode[] = [];
  for (const node of nodes) {
    const content = node.metadata?.content;
    if (!MEDIA_TYPES.has(node.type) || !content) {
      exportedNodes.push(node);
      continue;
    }
    const resolved = await resolveContent(content);
    if (!resolved) {
      exportedNodes.push(node);
      continue;
    }
    const ext = extForMime(resolved.mime, node.type);
    let path = `files/${safeFileName(node.title || node.id)}.${ext}`;
    for (let i = 1; used.has(path); i++) {
      path = `files/${safeFileName(node.title || node.id)}-${i}.${ext}`;
    }
    used.add(path);
    files.push({ name: path, data: resolved.bytes });
    exportedNodes.push({
      ...node,
      metadata: { ...node.metadata, content: path },
    });
  }

  const payload: BoardExportPayload = {
    app: "nexu-canvas",
    version: 1,
    exportedAt: new Date().toISOString(),
    boardName,
    nodes: exportedNodes,
    connections,
  };
  return [
    {
      name: "board.json",
      data: new TextEncoder().encode(JSON.stringify(payload, null, 2)),
    },
    ...files,
  ];
}

// ── Element export ─────────────────────────────────────────────

/**
 * Assemble ZIP entries for a set of selected nodes: media become files,
 * text notes become .txt, everything else serializes to .json.
 */
export async function buildNodesExport(
  nodes: CanvasNode[],
): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  const encoder = new TextEncoder();

  const uniquePath = (base: string, ext: string): string => {
    let path = `${safeFileName(base)}.${ext}`;
    for (let i = 1; used.has(path); i++) {
      path = `${safeFileName(base)}-${i}.${ext}`;
    }
    used.add(path);
    return path;
  };

  for (const node of nodes) {
    const base = node.title || node.id;
    const content = node.metadata?.content;
    if (MEDIA_TYPES.has(node.type) && content) {
      const resolved = await resolveContent(content);
      if (resolved) {
        entries.push({
          name: uniquePath(base, extForMime(resolved.mime, node.type)),
          data: resolved.bytes,
        });
        continue;
      }
    }
    if (node.type === "text") {
      entries.push({
        name: uniquePath(base, "txt"),
        data: encoder.encode(content ?? ""),
      });
      continue;
    }
    entries.push({
      name: uniquePath(base, "json"),
      data: encoder.encode(JSON.stringify(node, null, 2)),
    });
  }
  return entries;
}

// ── Download orchestration ─────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Export the active board (nodes + connections + media files) as a ZIP. */
export async function exportBoardAsZip(): Promise<void> {
  const state = getCanvasState();
  const boards = getCanvasBoards();
  const boardName =
    boards.boards.find((b) => b.id === boards.activeId)?.name ?? "画布";
  const entries = await buildBoardExport(
    boardName,
    state.nodes,
    state.connections,
  );
  downloadBlob(buildZip(entries), `${safeFileName(boardName)}.zip`);
}

/** Export specific nodes (multi-select batch) as a ZIP of standalone files. */
export async function exportNodesAsZip(nodeIds: string[]): Promise<void> {
  const wanted = new Set(nodeIds);
  const nodes = getCanvasState().nodes.filter((n) => wanted.has(n.id));
  if (nodes.length === 0) return;
  const entries = await buildNodesExport(nodes);
  downloadBlob(buildZip(entries), "画布元素.zip");
}
