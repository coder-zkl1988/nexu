import { access, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { devLogsPath, readDevLock } from "@nexu/dev-utils";

import {
  controllerDevLockPath,
  desktopDevLockPath,
  openclawDevLockPath,
  webDevLockPath,
} from "./paths.js";

export const defaultLogTailLineCount = 200;

export const devLogSessionRetentionCount = 10;

/**
 * Prune old dev log session directories, keeping the most recent
 * `keepCount` plus any directory referenced by an active service lock.
 * Session directory names are run ids (ISO timestamps), so lexicographic
 * order is chronological. Returns the removed directory names.
 */
export async function pruneDevLogSessions(
  keepCount = devLogSessionRetentionCount,
): Promise<string[]> {
  const entries = await readdir(devLogsPath, { withFileTypes: true }).catch(
    () => [],
  );

  const runDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  const activeSessionIds = new Set<string>();
  for (const lockPath of [
    controllerDevLockPath,
    webDevLockPath,
    openclawDevLockPath,
    desktopDevLockPath,
  ]) {
    try {
      const lock = await readDevLock(lockPath);
      activeSessionIds.add(lock.runId);
      if (lock.sessionId) {
        activeSessionIds.add(lock.sessionId);
      }
    } catch {
      // No lock — service is not running.
    }
  }

  const removed: string[] = [];
  for (const runDirectory of runDirectories.slice(keepCount)) {
    if (activeSessionIds.has(runDirectory)) {
      continue;
    }
    try {
      await rm(join(devLogsPath, runDirectory), {
        recursive: true,
        force: true,
      });
      removed.push(runDirectory);
    } catch {
      // Best effort — a locked/unremovable directory must not block startup.
    }
  }

  return removed;
}

export type DevLogTail = {
  content: string;
  logFilePath: string;
  totalLineCount: number;
};

function normalizeLogLines(content: string): string[] {
  const lines = content.split(/\r?\n/);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

export function renderLogTail(
  lines: string[],
  maxLines = defaultLogTailLineCount,
): string {
  if (lines.length === 0) {
    return "";
  }

  return `${lines.slice(-maxLines).join("\n")}\n`;
}

export async function readLogTailFromFile(
  logFilePath: string,
  maxLines = defaultLogTailLineCount,
): Promise<DevLogTail> {
  const content = await readFile(logFilePath, "utf8");
  const lines = normalizeLogLines(content);

  return {
    content: renderLogTail(lines, maxLines),
    logFilePath,
    totalLineCount: lines.length,
  };
}

export async function readLatestNamedLogTail(
  logFileName: string,
  maxLines = defaultLogTailLineCount,
): Promise<DevLogTail | null> {
  const entries = await readdir(devLogsPath, { withFileTypes: true }).catch(
    () => [],
  );

  const runDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  for (const runDirectory of runDirectories) {
    const logFilePath = join(devLogsPath, runDirectory, logFileName);

    try {
      await access(logFilePath);
      return await readLogTailFromFile(logFilePath, maxLines);
    } catch {}
  }

  return null;
}
