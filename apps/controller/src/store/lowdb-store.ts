import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LowDbStoreOptions<T> {
  /**
   * Applied on the way to disk and on the way back. Used to keep credentials
   * out of the file at rest while every caller above still sees plaintext.
   */
  transform?: {
    onWrite: (value: T) => T;
    onRead: (value: T) => T;
  };
  /** POSIX mode for the persisted files. Credentials warrant 0o600. */
  fileMode?: number;
}
export class LowDbStore<T> {
  private cache: T | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly schema: { parse(input: unknown): T },
    private readonly createDefault: () => T,
    private readonly options: LowDbStoreOptions<T> = {},
  ) {}

  async read(): Promise<T> {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      this.cache = await this.readAndParse(this.filePath);
      return this.cache;
    } catch {
      const backupPath = `${this.filePath}.bak`;
      try {
        this.cache = await this.readAndParse(backupPath);
        await this.write(this.cache);
        return this.cache;
      } catch {
        const fallback = this.createDefault();
        this.cache = this.schema.parse(fallback);
        await this.write(this.cache);
        return this.cache;
      }
    }
  }

  async write(nextValue: T): Promise<void> {
    const validated = this.schema.parse(nextValue);

    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      const backupPath = `${this.filePath}.bak`;
      const persisted = this.options.transform
        ? this.options.transform.onWrite(validated)
        : validated;
      const payload = `${JSON.stringify(persisted, null, 2)}\n`;
      const mode = this.options.fileMode;
      await writeFile(tempPath, payload, {
        encoding: "utf8",
        ...(mode ? { mode } : {}),
      });
      await writeFile(backupPath, payload, {
        encoding: "utf8",
        ...(mode ? { mode } : {}),
      });
      await rename(tempPath, this.filePath);
      if (mode) {
        // rename preserves the temp file's mode, but a file that predates this
        // option keeps its old permissions until it is rewritten.
        await chmod(this.filePath, mode).catch(() => {});
        await chmod(backupPath, mode).catch(() => {});
      }
      this.cache = validated;
    });

    await this.writeQueue;
  }

  async update(updater: (current: T) => T | Promise<T>): Promise<T> {
    const current = await this.read();
    const nextValue = await updater(current);
    await this.write(nextValue);
    return nextValue;
  }

  private async readAndParse(filePath: string): Promise<T> {
    const raw = await readFile(filePath, "utf8");
    const parsed = this.schema.parse(JSON.parse(raw));
    return this.options.transform
      ? this.options.transform.onRead(parsed)
      : parsed;
  }
}
