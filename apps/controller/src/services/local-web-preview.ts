import type { Dirent } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ControllerArtifact } from "../store/schemas.js";

const BOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ENCODED_ROOT_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_SCAN_DEPTH = 6;
const MAX_SCANNED_ENTRIES = 2_000;
const MAX_LOCAL_PREVIEWS = 10;

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".cache",
  "agent",
  "attachments",
  "memory",
  "node_modules",
  "sessions",
  "skills",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

type LocalIndexFile = {
  entryFile: string;
  projectRoot: string;
  modifiedAtMs: number;
};

export type LocalWebPreviewFile = {
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
};

export function localWebPreviewAssetPathFromUrl(input: {
  requestUrl: string;
  botId: string;
  encodedRoot: string;
}): string | null {
  try {
    const pathname = new URL(input.requestUrl).pathname;
    const prefix = `/api/v1/artifacts/local-preview/${encodeURIComponent(input.botId)}/${encodeURIComponent(input.encodedRoot)}/`;
    if (!pathname.startsWith(prefix)) return null;
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function botIdFromSessionKey(sessionKey: string): string | null {
  const match = /^agent:([^:]+):/.exec(sessionKey);
  const botId = match?.[1] ?? null;
  return botId && BOT_ID_PATTERN.test(botId) ? botId : null;
}

async function findIndexFiles(
  workspaceRoot: string,
): Promise<LocalIndexFile[]> {
  const matches: LocalIndexFile[] = [];
  let scannedEntries = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH || scannedEntries >= MAX_SCANNED_ENTRIES) {
      return;
    }

    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries > MAX_SCANNED_ENTRIES) return;

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
          await visit(entryPath, depth + 1);
        }
        continue;
      }

      if (
        !entry.isFile() ||
        (entry.name !== "index.html" && entry.name !== "index.htm")
      ) {
        continue;
      }

      try {
        const fileStat = await stat(entryPath);
        matches.push({
          entryFile: entry.name,
          projectRoot: directory,
          modifiedAtMs: fileStat.mtimeMs,
        });
      } catch {
        // The file may have been replaced while the Bot was writing it.
      }
    }
  };

  await visit(workspaceRoot, 0);
  return matches
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
    .slice(0, MAX_LOCAL_PREVIEWS);
}

export async function discoverLocalWebPreviews(input: {
  openclawStateDir: string;
  sessionKey: string;
  requestOrigin: string;
}): Promise<ControllerArtifact[]> {
  const botId = botIdFromSessionKey(input.sessionKey);
  if (!botId) return [];

  const agentsRoot = path.resolve(input.openclawStateDir, "agents");
  const workspaceRoot = path.resolve(agentsRoot, botId);
  if (!isPathInside(agentsRoot, workspaceRoot)) return [];

  let canonicalWorkspaceRoot: string;
  try {
    canonicalWorkspaceRoot = await realpath(workspaceRoot);
  } catch {
    return [];
  }

  const indexes = await findIndexFiles(canonicalWorkspaceRoot);
  return indexes.map((index) => {
    const relativeRoot = path.relative(
      canonicalWorkspaceRoot,
      index.projectRoot,
    );
    const encodedRoot = Buffer.from(relativeRoot || ".", "utf8").toString(
      "base64url",
    );
    const previewUrl = new URL(
      `/api/v1/artifacts/local-preview/${encodeURIComponent(botId)}/${encodedRoot}/${encodeURIComponent(index.entryFile)}`,
      input.requestOrigin,
    );
    previewUrl.searchParams.set("v", String(Math.trunc(index.modifiedAtMs)));
    const timestamp = new Date(index.modifiedAtMs).toISOString();
    const projectName = relativeRoot
      ? path.basename(index.projectRoot)
      : "Workspace";

    return {
      id: `local-web:${botId}:${encodedRoot}:${Math.trunc(index.modifiedAtMs)}`,
      botId,
      sessionKey: input.sessionKey,
      channelType: null,
      channelId: null,
      title: `${projectName} preview`,
      artifactType: "code",
      source: "coding",
      contentType: "text/html",
      status: "live",
      previewUrl: previewUrl.toString(),
      deployTarget: "local-workspace",
      linesOfCode: null,
      fileCount: null,
      durationMs: null,
      metadata: {
        local: true,
        relativeRoot,
        entryFile: index.entryFile,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

export async function readLocalWebPreviewFile(input: {
  openclawStateDir: string;
  botId: string;
  encodedRoot: string;
  assetPath: string;
}): Promise<LocalWebPreviewFile | null> {
  if (
    !BOT_ID_PATTERN.test(input.botId) ||
    !ENCODED_ROOT_PATTERN.test(input.encodedRoot)
  ) {
    return null;
  }

  let relativeRoot: string;
  try {
    relativeRoot = Buffer.from(input.encodedRoot, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const agentsRoot = path.resolve(input.openclawStateDir, "agents");
  const workspaceRoot = path.resolve(agentsRoot, input.botId);
  const projectRoot = path.resolve(workspaceRoot, relativeRoot);
  const requestedPath = path.resolve(projectRoot, input.assetPath);
  if (
    !isPathInside(agentsRoot, workspaceRoot) ||
    !isPathInside(workspaceRoot, projectRoot) ||
    !isPathInside(projectRoot, requestedPath)
  ) {
    return null;
  }

  try {
    const [canonicalWorkspaceRoot, canonicalProjectRoot, canonicalFile] =
      await Promise.all([
        realpath(workspaceRoot),
        realpath(projectRoot),
        realpath(requestedPath),
      ]);
    if (
      !isPathInside(canonicalWorkspaceRoot, canonicalProjectRoot) ||
      !isPathInside(canonicalProjectRoot, canonicalFile)
    ) {
      return null;
    }

    const fileStat = await stat(canonicalFile);
    if (!fileStat.isFile()) return null;

    const fileData = await readFile(canonicalFile);
    const data = new Uint8Array(fileData.byteLength);
    data.set(fileData);

    return {
      data,
      contentType:
        CONTENT_TYPES[path.extname(canonicalFile).toLowerCase()] ??
        "application/octet-stream",
    };
  } catch {
    return null;
  }
}
