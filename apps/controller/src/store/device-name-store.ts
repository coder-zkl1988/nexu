import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { logger } from "../lib/logger.js";

/**
 * Disk-backed store for user-assigned device display names.
 *
 * Keeps a `Map`-compatible synchronous `get`/`set` surface (the device routes
 * read it inline while building responses) but persists every change to a JSON
 * file so a rename survives controller restarts — a plain in-memory Map lost
 * the name on every restart, which is what made renames "revert on refresh".
 */
export class DeviceNameStore {
  private readonly filePath: string;
  private readonly names = new Map<string, string>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  get(deviceId: string): string | undefined {
    return this.names.get(deviceId);
  }

  set(deviceId: string, name: string): void {
    this.names.set(deviceId, name);
    this.persist();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [deviceId, value] of Object.entries(parsed)) {
        if (typeof value === "string") this.names.set(deviceId, value);
      }
    } catch {
      // Missing/unreadable file → start empty.
    }
  }

  private persist(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(
        this.filePath,
        JSON.stringify(Object.fromEntries(this.names), null, 2),
        "utf8",
      );
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "device-name-store: persist failed",
      );
    }
  }
}
