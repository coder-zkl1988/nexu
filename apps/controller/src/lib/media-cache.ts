/**
 * media-cache.ts
 *
 * Durable mirror for OpenClaw transcript media.
 *
 * OpenClaw TTL-cleans `<state-dir>/media/` (inbound uploads, generated
 * images) while the JSONL transcripts referencing those files live forever.
 * The chat-history endpoint mirrors referenced files into
 * `<NEXU_HOME>/media-cache/` at read time so `/api/v1/media/state-file` can
 * keep serving them after the originals are deleted.
 *
 * Cache keys are sha1(original absolute path) + original extension, so the
 * public URL (`?path=<original>`) never changes and the route can resolve
 * the mirror without an index file.
 */

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";

export type MediaFileResolution =
  | { status: "file"; originalPath: string; realPath: string }
  | { status: "missing" | "unsafe"; originalPath: string };

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Resolve an existing regular file beneath OpenClaw's media root. Both the
 * lexical path and canonical path are checked so a symlink inside media cannot
 * expose or cache files outside the app-owned tree.
 */
export async function resolveMediaFileWithinRoot(
  mediaRoot: string,
  candidatePath: string,
): Promise<MediaFileResolution> {
  const root = path.resolve(mediaRoot);
  const originalPath = path.resolve(candidatePath);
  if (!isPathInside(root, originalPath)) {
    return { status: "unsafe", originalPath };
  }

  try {
    if ((await lstat(originalPath)).isSymbolicLink()) {
      return { status: "unsafe", originalPath };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      status: code === "ENOENT" ? "missing" : "unsafe",
      originalPath,
    };
  }

  let realRoot: string;
  let realPath: string;
  try {
    [realRoot, realPath] = await Promise.all([
      realpath(root),
      realpath(originalPath),
    ]);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      status: code === "ENOENT" ? "missing" : "unsafe",
      originalPath,
    };
  }

  if (!isPathInside(realRoot, realPath)) {
    return { status: "unsafe", originalPath };
  }
  const fileStat = await stat(realPath).catch(() => null);
  if (!fileStat?.isFile()) {
    return { status: "unsafe", originalPath };
  }
  return { status: "file", originalPath, realPath };
}

/** Directory under the controller home where transcript media is mirrored. */
export function mediaCacheDir(nexuHomeDir: string): string {
  return path.join(nexuHomeDir, "media-cache");
}

/** Deterministic mirror location for an absolute transcript media path. */
export function mediaCachePathFor(
  cacheDir: string,
  absolutePath: string,
): string {
  const hash = createHash("sha1").update(absolutePath).digest("hex");
  return path.join(
    cacheDir,
    `${hash}${path.extname(absolutePath).toLowerCase()}`,
  );
}

/**
 * Mirror a transcript-referenced media file into the durable cache.
 * Idempotent and best-effort: a no-op when the mirror already exists or the
 * source has already been TTL-cleaned.
 */
export async function ensureMediaCached(
  cacheDir: string,
  absolutePath: string,
  mediaRoot?: string,
): Promise<void> {
  const resolution = mediaRoot
    ? await resolveMediaFileWithinRoot(mediaRoot, absolutePath)
    : ({
        status: "file",
        originalPath: path.resolve(absolutePath),
        realPath: path.resolve(absolutePath),
      } as const);
  if (resolution.status !== "file") return;
  try {
    await access(resolution.realPath, fsConstants.R_OK);
  } catch {
    return; // source already TTL-cleaned — nothing to mirror
  }
  const target = mediaCachePathFor(cacheDir, resolution.originalPath);
  await mkdir(cacheDir, { recursive: true });
  try {
    await copyFile(resolution.realPath, target, fsConstants.COPYFILE_EXCL);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EEXIST: already mirrored.  ENOENT: source deleted between the access
    // check and the copy (TTL sweep race).
    if (code === "EEXIST" || code === "ENOENT") return;
    throw err;
  }
}
