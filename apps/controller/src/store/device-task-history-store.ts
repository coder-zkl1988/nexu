import {
  type DeviceTaskHistoryEntry,
  type DeviceTaskHistoryIndex,
  deviceTaskHistoryIndexSchema,
} from "@nexu/shared";
import { LowDbStore } from "./lowdb-store.js";

const MAX_ENTRIES = 200;

export class DeviceTaskHistoryStore {
  private readonly store: LowDbStore<DeviceTaskHistoryIndex>;
  // Serializes concurrent append() calls so that read -> compute -> write
  // in LowDbStore.update is not interleaved and no entry is lost.
  private appendQueue: Promise<void> = Promise.resolve();

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
    const next = this.appendQueue.then(async () => {
      await this.store.update((current) => ({
        ...current,
        entries: [entry, ...current.entries].slice(0, MAX_ENTRIES),
      }));
    });
    // Swallow errors in the chain so one failed append does not poison
    // the queue for subsequent appends. The original promise still rejects
    // for the caller.
    this.appendQueue = next.catch(() => undefined);
    return next;
  }
}
