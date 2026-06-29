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
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

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
): Promise<void> {
  try {
    await access(absolutePath, fsConstants.R_OK);
  } catch {
    return; // source already TTL-cleaned — nothing to mirror
  }
  const target = mediaCachePathFor(cacheDir, absolutePath);
  await mkdir(cacheDir, { recursive: true });
  try {
    await copyFile(absolutePath, target, fsConstants.COPYFILE_EXCL);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EEXIST: already mirrored.  ENOENT: source deleted between the access
    // check and the copy (TTL sweep race).
    if (code === "EEXIST" || code === "ENOENT") return;
    throw err;
  }
}
