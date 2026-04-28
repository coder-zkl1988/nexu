import { unlink } from "node:fs/promises";
import path from "node:path";
import {
  type DeviceTaskHistoryEntry,
  type DeviceTaskHistoryIndex,
  deviceTaskHistoryIndexSchema,
} from "@nexu/shared";
import { LowDbStore } from "./lowdb-store.js";

const MAX_ENTRIES = 200;

export class DeviceTaskHistoryStore {
  private readonly store: LowDbStore<DeviceTaskHistoryIndex>;
  private appendQueue: Promise<void> = Promise.resolve();
  private readonly screenshotsDir: string;

  constructor(filePath: string, screenshotsDir: string) {
    this.store = new LowDbStore<DeviceTaskHistoryIndex>(
      filePath,
      deviceTaskHistoryIndexSchema,
      () => ({ schemaVersion: 1, entries: [] }),
    );
    this.screenshotsDir = screenshotsDir;
  }

  async list(): Promise<DeviceTaskHistoryEntry[]> {
    const data = await this.store.read();
    return data.entries;
  }

  async getByTaskId(taskId: string): Promise<DeviceTaskHistoryEntry | null> {
    const entries = await this.list();
    return entries.find((entry) => entry.taskId === taskId) ?? null;
  }

  async append(entry: DeviceTaskHistoryEntry): Promise<void> {
    const next = this.appendQueue.then(async () => {
      await this.store.update((current) => {
        const trimmed = current.entries.slice(MAX_ENTRIES - 1);
        // Clean up screenshot files for trimmed entries
        for (const oldEntry of trimmed) {
          const fs = oldEntry.result.finalScreenshot;
          if (fs) {
            const filename = path.basename(fs);
            unlink(path.join(this.screenshotsDir, filename)).catch(() => {});
          }
        }
        return {
          ...current,
          entries: [entry, ...current.entries].slice(0, MAX_ENTRIES),
        };
      });
    });
    this.appendQueue = next.catch(() => undefined);
    return next;
  }
}
