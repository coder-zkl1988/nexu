import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  opendir,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  CHAT_ATTACHMENT_LIMITS,
  type DesktopAttachmentPickerKind,
  type DesktopStagedAttachment,
} from "@nexu/shared";

const INBOUND_TTL_MS = 24 * 60 * 60 * 1000;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type InspectedPath = {
  sourcePath: string;
  filename: string;
  size: number;
  isDirectory: boolean;
};

function inboundRoot(openclawStateDir: string): string {
  if (!openclawStateDir.trim()) {
    throw new Error("Attachment staging requires an OpenClaw state directory.");
  }
  return path.resolve(openclawStateDir, "media", "inbound");
}

function sanitizeEntryName(raw: string): string {
  let cleaned = "";
  for (const character of raw) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) continue;
    cleaned += character === "/" || character === "\\" ? "_" : character;
  }
  cleaned = cleaned.trim();
  return (cleaned || "attachment").slice(0, 180);
}

function mimeForPath(filePath: string, isDirectory: boolean): string {
  if (isDirectory) return "application/x-directory";
  return (
    MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

async function inspectSelectedPath(sourcePath: string): Promise<InspectedPath> {
  const resolved = path.resolve(sourcePath);
  const sourceStat = await lstat(resolved);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(
      `Symbolic links cannot be attached: ${path.basename(resolved)}`,
    );
  }
  if (sourceStat.isFile()) {
    if (sourceStat.size > CHAT_ATTACHMENT_LIMITS.maxFileBytes) {
      throw new Error(
        `${path.basename(resolved)} exceeds the 100 MB attachment limit.`,
      );
    }
    return {
      sourcePath: resolved,
      filename: path.basename(resolved),
      size: sourceStat.size,
      isDirectory: false,
    };
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(`Unsupported attachment type: ${path.basename(resolved)}`);
  }

  let size = 0;
  const pending = [resolved];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const directory = await opendir(current);
    for await (const entry of directory) {
      const childPath = path.join(current, entry.name);
      const childStat = await lstat(childPath);
      if (childStat.isSymbolicLink()) {
        throw new Error(
          `Directories containing symbolic links cannot be attached: ${entry.name}`,
        );
      }
      if (childStat.isDirectory()) {
        pending.push(childPath);
        continue;
      }
      if (!childStat.isFile()) {
        throw new Error(`Unsupported directory entry: ${entry.name}`);
      }
      if (childStat.size > CHAT_ATTACHMENT_LIMITS.maxFileBytes) {
        throw new Error(`${entry.name} exceeds the 100 MB attachment limit.`);
      }
      size += childStat.size;
      if (size > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
        throw new Error("Selected attachments exceed the 500 MB total limit.");
      }
    }
  }

  return {
    sourcePath: resolved,
    filename: path.basename(resolved),
    size,
    isDirectory: true,
  };
}

async function copyWithoutLinks(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const sourceStat = await lstat(sourcePath);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(`Symbolic links cannot be attached: ${sourcePath}`);
  }
  if (sourceStat.isFile()) {
    await copyFile(sourcePath, targetPath);
    return;
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(`Unsupported attachment type: ${sourcePath}`);
  }

  await mkdir(targetPath, { recursive: true });
  const directory = await opendir(sourcePath);
  for await (const entry of directory) {
    await copyWithoutLinks(
      path.join(sourcePath, entry.name),
      path.join(targetPath, entry.name),
    );
  }
}

export async function cleanupStaleDesktopAttachments(
  openclawStateDir: string,
  now = Date.now(),
): Promise<void> {
  const root = inboundRoot(openclawStateDir);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) return;
      const batchPath = path.join(root, entry.name);
      const batchStat = await stat(batchPath).catch(() => null);
      if (batchStat && batchStat.mtimeMs < now - INBOUND_TTL_MS) {
        await rm(batchPath, { recursive: true, force: true });
      }
    }),
  );
}

export async function stageDesktopAttachmentPaths(input: {
  openclawStateDir: string;
  kind: DesktopAttachmentPickerKind;
  sourcePaths: string[];
}): Promise<DesktopStagedAttachment[]> {
  if (input.sourcePaths.length > CHAT_ATTACHMENT_LIMITS.maxCount) {
    throw new Error(
      `You can attach up to ${CHAT_ATTACHMENT_LIMITS.maxCount} items at once.`,
    );
  }
  await cleanupStaleDesktopAttachments(input.openclawStateDir);
  const inspected = await Promise.all(
    input.sourcePaths.map(inspectSelectedPath),
  );
  if (
    input.kind === "directory" &&
    inspected.some((entry) => !entry.isDirectory)
  ) {
    throw new Error("The directory picker only accepts directories.");
  }
  if (
    input.kind !== "directory" &&
    inspected.some((entry) => entry.isDirectory)
  ) {
    throw new Error("The file picker only accepts files.");
  }

  const totalBytes = inspected.reduce((total, entry) => total + entry.size, 0);
  if (totalBytes > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
    throw new Error("Selected attachments exceed the 500 MB total limit.");
  }
  if (
    input.kind === "image" &&
    inspected.some((entry) => entry.size > CHAT_ATTACHMENT_LIMITS.maxImageBytes)
  ) {
    throw new Error("Images must be 25 MB or smaller.");
  }

  const batchRoot = path.join(
    inboundRoot(input.openclawStateDir),
    randomUUID(),
  );
  await mkdir(batchRoot, { recursive: true });
  const staged: DesktopStagedAttachment[] = [];
  try {
    for (const [index, entry] of inspected.entries()) {
      const stagedName = `${String(index + 1).padStart(3, "0")}-${sanitizeEntryName(entry.filename)}`;
      const stagedPath = path.join(batchRoot, stagedName);
      await copyWithoutLinks(entry.sourcePath, stagedPath);
      staged.push({
        type: input.kind,
        filename: entry.filename,
        mimeType: mimeForPath(entry.sourcePath, entry.isDirectory),
        size: entry.size,
        stagedPath,
      });
    }
    return staged;
  } catch (error) {
    await rm(batchRoot, { recursive: true, force: true });
    throw error;
  }
}
