import {
  type DeviceTaskHistoryEntry,
  type DeviceTaskHistoryIndex,
  deviceTaskHistoryIndexSchema,
} from "@nexu/shared";
import { LowDbStore } from "./lowdb-store.js";

const MAX_ENTRIES = 200;

export class DeviceTaskHistoryStore {
  private readonly store: LowDbStore<DeviceTaskHistoryIndex>;

  constructor(filePath: string) {
    this.store = new LowDbStore<DeviceTaskHistoryIndex>(
      filePath,
      deviceTaskHistoryIndexSchema,
      () => ({ schemaVersion: 1, entries: [] }),
    );
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
    await this.store.update((current) => ({
      ...current,
      entries: [entry, ...current.entries].slice(0, MAX_ENTRIES),
    }));
  }
}
