/**
 * attachment-store.ts
 *
 * Persists webchat-uploaded attachments to a filesystem path that OpenClaw's
 * on-demand media tools (pdf, image, web-fetch, …) can resolve via their
 * built-in local-roots policy.
 *
 * Why disk-backed, not just inline base64?
 * -----------------------------------------
 * OpenClaw's chat.send RPC drops non-image attachments at the gateway, so
 * base64 file content can't ride the request.  Meanwhile OpenClaw's `pdf`
 * tool is a *sub-agent* style helper: give it a path + a prompt, it runs its
 * own model call in isolation and returns only a short text answer — the
 * full PDF content never enters the main conversation context.  That is
 * exactly the behaviour we want for large documents.
 *
 * OpenClaw's media-tool path policy (`buildMediaLocalRoots` in
 * `dist/local-roots-*.js`) trusts:
 *   <state-dir>/media/, <state-dir>/canvas/, <state-dir>/workspace/,
 *   <state-dir>/sandboxes/, <config-dir>/media/, and the preferred tmp dir.
 * Notably, `<state-dir>/agents/` is NOT in the default roots.
 * We pick `<state-dir>/workspace/<botId>/attachments/<sessionKey>/…` so every
 * attachment is scoped to the owning bot+session and stays inside an
 * already-trusted root.
 *
 * Lifecycle
 * ---------
 * A startup sweep (`cleanupExpired`) deletes attachments older than the
 * configured TTL.  We deliberately do not tie lifetime to "session ended"
 * because webchat sessions have no clean end signal and the agent may still
 * reference the file via tool calls for follow-up questions.
 */

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  opendir,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { CHAT_ATTACHMENT_LIMITS } from "@nexu/shared";

import { logger } from "../lib/logger.js";

/**
 * Seven days.  Long enough for a user to ask follow-up questions about an
 * uploaded doc across a lunch break, short enough to keep disk usage sane.
 * If you need longer, move to per-attachment TTL stored alongside the file.
 */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard cap on raw file size, matching the extractor. */
const MAX_INLINE_ATTACHMENT_BYTES = CHAT_ATTACHMENT_LIMITS.maxInlineFileBytes;

export interface SaveAttachmentInput {
  botId: string;
  sessionKey: string;
  /** Pure base64 (no `data:` prefix). */
  base64: string;
  filename?: string;
  mimeType: string;
}

export interface SaveAttachmentResult {
  /** Absolute path to the stored file.  Safe to hand to OpenClaw tools. */
  absolutePath: string;
  /** Sanitized filename actually used on disk (may differ from input). */
  storedFilename: string;
  /** Size in bytes of the decoded, saved file. */
  sizeBytes: number;
}

export interface ImportedStagedAttachmentResult extends SaveAttachmentResult {
  /** Original app-owned inbound path, used to restore a failed chat request. */
  stagedPath: string;
}

export interface ImportStagedAttachmentInput {
  botId: string;
  sessionKey: string;
  stagedPath: string;
  filename?: string;
  kind: "file" | "directory";
  /** Remaining byte budget for this message. Checked before the move. */
  maxBytes?: number;
}

export interface AttachmentStoreOptions {
  /** Root where all attachments live; typically `env.openclawStateDir`. */
  openclawStateDir: string;
  /** Override the default 7-day expiry for testing. */
  ttlMs?: number;
}

/**
 * Normalize a bot-supplied filename into something safe to drop on disk.
 * - Strips directory separators (`/`, `\`) and null bytes.
 * - Collapses control characters and whitespace.
 * - Caps length at 128 chars so paths stay portable.
 */
function sanitizeFilename(raw: string | undefined): string {
  if (!raw) return "file";
  let stripped = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    // Drop C0 controls (0x00-0x1F) and DEL (0x7F).  Inlined as a loop so
    // biome's noControlCharactersInRegex doesn't fire on a char-class regex.
    if (code < 0x20 || code === 0x7f) continue;
    stripped += ch === "/" || ch === "\\" ? "_" : ch;
  }
  const normalized = stripped.replace(/\s+/g, " ").trim();
  if (!normalized) return "file";
  return normalized.length > 128 ? normalized.slice(0, 128) : normalized;
}

/**
 * Normalize a sessionKey (`agent:<botId>:main`) into a filesystem-safe
 * directory name: colons → underscores, lowercased.
 */
function sanitizeSessionDir(sessionKey: string): string {
  const cleaned = sessionKey.replace(/[^A-Za-z0-9._-]+/g, "_");
  return cleaned || "session";
}

function sanitizeBotId(botId: string): string {
  const cleaned = botId.replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!cleaned) throw new Error("AttachmentStore: botId is empty");
  return cleaned;
}

function decodeBase64(data: string): Buffer | null {
  // Defensive strip of any `data:<mime>;base64,` prefix; frontend should
  // send pure base64 but the runtime check is cheap.
  const cleaned = data.includes(",") ? (data.split(",").pop() ?? data) : data;
  try {
    const buf = Buffer.from(cleaned, "base64");
    return buf.byteLength === 0 ? null : buf;
  } catch {
    return null;
  }
}

export class AttachmentStore {
  private readonly stateDir: string;
  private readonly ttlMs: number;

  constructor(options: AttachmentStoreOptions) {
    if (!options.openclawStateDir.trim()) {
      throw new Error("AttachmentStore: openclawStateDir is required");
    }
    this.stateDir = path.resolve(options.openclawStateDir);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Resolve the directory that holds attachments for a given bot+session.
   * Sits under `<stateDir>/workspace/<botId>/attachments/<sessionKey>/` —
   * inside OpenClaw's trusted `workspace/` root so the `pdf` / `image` tools
   * can open files without extra sandbox dance.
   *
   * NOTE: Previous versions used `agents/<botId>/attachments/`, but OpenClaw's
   * local-roots policy does NOT include `agents/` as a trusted root for media
   * tools.  The `workspace/` directory IS in the default roots returned by
   * `buildMediaLocalRoots()`, so files stored here are accessible to the
   * `pdf` sub-agent and other on-demand media tools.
   */
  private attachmentsDirFor(botId: string, sessionKey: string): string {
    return path.join(
      this.stateDir,
      "workspace",
      sanitizeBotId(botId),
      "attachments",
      sanitizeSessionDir(sessionKey),
    );
  }

  /** Root directory used by {@link cleanupExpired}. */
  private attachmentsRoot(): string {
    return path.join(this.stateDir, "workspace");
  }

  private inboundRoot(): string {
    return path.join(this.stateDir, "media", "inbound");
  }

  async saveAttachment(
    input: SaveAttachmentInput,
  ): Promise<SaveAttachmentResult> {
    const buffer = decodeBase64(input.base64);
    if (!buffer) {
      throw new Error("AttachmentStore: invalid base64 payload");
    }
    if (buffer.byteLength > MAX_INLINE_ATTACHMENT_BYTES) {
      throw new Error(
        `AttachmentStore: attachment exceeds ${MAX_INLINE_ATTACHMENT_BYTES}B inline limit (${buffer.byteLength}B)`,
      );
    }

    const dir = this.attachmentsDirFor(input.botId, input.sessionKey);
    await mkdir(dir, { recursive: true });

    const safeName = sanitizeFilename(input.filename);
    // UUID prefix avoids collisions when two users upload `report.pdf`.
    const storedFilename = `${randomUUID().slice(0, 8)}-${safeName}`;
    const absolutePath = path.join(dir, storedFilename);

    await writeFile(absolutePath, buffer);

    return {
      absolutePath,
      storedFilename,
      sizeBytes: buffer.byteLength,
    };
  }

  async importStagedAttachment(
    input: ImportStagedAttachmentInput,
  ): Promise<ImportedStagedAttachmentResult> {
    const inboundRoot = this.inboundRoot();
    const sourcePath = path.resolve(input.stagedPath);
    const relativeSource = path.relative(inboundRoot, sourcePath);
    if (
      !relativeSource ||
      relativeSource.startsWith(`..${path.sep}`) ||
      relativeSource === ".." ||
      path.isAbsolute(relativeSource)
    ) {
      throw new Error("AttachmentStore: staged path is outside inbound root");
    }

    const [lexicalSourceStat, realInboundRoot, realSourcePath] =
      await Promise.all([
        lstat(sourcePath),
        realpath(inboundRoot),
        realpath(sourcePath),
      ]);
    const realRelative = path.relative(realInboundRoot, realSourcePath);
    if (
      !realRelative ||
      realRelative.startsWith(`..${path.sep}`) ||
      realRelative === ".." ||
      path.isAbsolute(realRelative)
    ) {
      throw new Error(
        "AttachmentStore: staged path resolves outside inbound root",
      );
    }
    if (lexicalSourceStat.isSymbolicLink()) {
      throw new Error("AttachmentStore: symbolic links are not supported");
    }

    const sourceStat = await lstat(realSourcePath);
    if (sourceStat.isSymbolicLink()) {
      throw new Error("AttachmentStore: symbolic links are not supported");
    }
    if (input.kind === "directory" && !sourceStat.isDirectory()) {
      throw new Error("AttachmentStore: staged directory is not a directory");
    }
    if (input.kind === "file" && !sourceStat.isFile()) {
      throw new Error("AttachmentStore: staged file is not a file");
    }

    const maxBytes = Math.min(
      CHAT_ATTACHMENT_LIMITS.maxTotalBytes,
      input.maxBytes ?? CHAT_ATTACHMENT_LIMITS.maxTotalBytes,
    );
    if (maxBytes < 0) {
      throw new Error("AttachmentStore: attachment byte budget is exhausted");
    }

    let sizeBytes = 0;
    const pending = [realSourcePath];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      const currentStat = await lstat(current);
      if (currentStat.isSymbolicLink()) {
        throw new Error(
          "AttachmentStore: staged attachment contains a symbolic link",
        );
      }
      if (currentStat.isFile()) {
        if (currentStat.size > CHAT_ATTACHMENT_LIMITS.maxFileBytes) {
          throw new Error(
            "AttachmentStore: staged file exceeds the 100 MB limit",
          );
        }
        sizeBytes += currentStat.size;
        if (sizeBytes > maxBytes) {
          throw new Error(
            "AttachmentStore: staged attachment exceeds the remaining message byte budget",
          );
        }
        continue;
      }
      if (!currentStat.isDirectory()) {
        throw new Error(
          "AttachmentStore: staged attachment contains an unsupported entry",
        );
      }
      const directory = await opendir(current);
      for await (const entry of directory) {
        pending.push(path.join(current, entry.name));
      }
    }

    const destinationDir = this.attachmentsDirFor(
      input.botId,
      input.sessionKey,
    );
    await mkdir(destinationDir, { recursive: true });
    const safeName = sanitizeFilename(input.filename);
    const storedFilename = `${randomUUID().slice(0, 8)}-${safeName}`;
    const absolutePath = path.join(destinationDir, storedFilename);
    await rename(realSourcePath, absolutePath);
    await rmdir(path.dirname(realSourcePath)).catch(() => {
      // Other files from the same picker batch may still be waiting to send.
    });

    return { absolutePath, storedFilename, sizeBytes, stagedPath: sourcePath };
  }

  /** Best-effort rollback for an imported attachment whose chat send failed. */
  async restoreStagedAttachment(
    imported: ImportedStagedAttachmentResult,
  ): Promise<void> {
    const stagedPath = path.resolve(imported.stagedPath);
    const relativeStagedPath = path.relative(this.inboundRoot(), stagedPath);
    try {
      if (
        !relativeStagedPath ||
        relativeStagedPath.startsWith(`..${path.sep}`) ||
        relativeStagedPath === ".." ||
        path.isAbsolute(relativeStagedPath)
      ) {
        throw new Error("staged path is outside inbound root");
      }

      const stagedPathExists = await lstat(stagedPath).then(
        () => true,
        () => false,
      );
      if (stagedPathExists) {
        throw new Error("staged path is already occupied");
      }

      await mkdir(path.dirname(stagedPath), { recursive: true });
      await rename(imported.absolutePath, stagedPath);
    } catch (error) {
      logger.warn(
        {
          stagedPath,
          importedPath: imported.absolutePath,
          error: error instanceof Error ? error.message : String(error),
        },
        "attachment-store: failed to restore staged attachment",
      );
    }
  }

  /**
   * Walk `<stateDir>/workspace/*\/attachments/` and delete any file or
   * directory older than the configured TTL. Runs on controller startup and
   * is safe to call concurrently with new saves — each `rm` is independent.
   *
   * Returns `{deleted, skipped}` counts for observability.
   */
  async cleanupExpired(): Promise<{ deleted: number; skipped: number }> {
    const cutoff = Date.now() - this.ttlMs;
    let deleted = 0;
    let skipped = 0;

    const root = this.attachmentsRoot();
    try {
      await access(root, fsConstants.R_OK);
    } catch {
      return { deleted: 0, skipped: 0 };
    }

    const botDirs = await readdir(root, { withFileTypes: true }).catch(
      () => [] as never[],
    );
    for (const botDirent of botDirs) {
      if (!botDirent.isDirectory()) continue;
      const attachmentsDir = path.join(root, botDirent.name, "attachments");
      const sessionDirs = await readdir(attachmentsDir, {
        withFileTypes: true,
      }).catch(() => [] as never[]);
      for (const sessionDirent of sessionDirs) {
        if (!sessionDirent.isDirectory()) continue;
        const sessionDir = path.join(attachmentsDir, sessionDirent.name);
        const entries = await readdir(sessionDir, {
          withFileTypes: true,
        }).catch(() => [] as never[]);
        for (const entry of entries) {
          if (!entry.isFile() && !entry.isDirectory()) continue;
          const entryPath = path.join(sessionDir, entry.name);
          let mtimeMs: number;
          try {
            mtimeMs = (await stat(entryPath)).mtimeMs;
          } catch {
            continue;
          }
          if (mtimeMs < cutoff) {
            try {
              await rm(entryPath, {
                recursive: entry.isDirectory(),
                force: true,
              });
              deleted += 1;
            } catch (err) {
              logger.warn(
                {
                  filePath: entryPath,
                  error: err instanceof Error ? err.message : String(err),
                },
                "attachment-store: cleanup delete failed",
              );
              skipped += 1;
            }
          }
        }
      }
    }

    if (deleted > 0 || skipped > 0) {
      logger.info(
        { deleted, skipped, ttlMs: this.ttlMs, root },
        "attachment-store: cleanup complete",
      );
    }
    return { deleted, skipped };
  }
}
