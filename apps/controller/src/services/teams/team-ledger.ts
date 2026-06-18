import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import type { TeamResponse } from "@nexu/shared";
import { logger } from "../../lib/logger.js";

/**
 * On-disk ledger of teams, mirroring the experthub ledger contract
 * (`expert-ledger.json`): a single JSON file with atomic write-via-rename.
 * Each entry is the full {@link TeamResponse} so reads need no joins.
 */
export type TeamLedger = {
  version: 1;
  updatedAt: string | null;
  entries: Record<string, TeamResponse>;
};

const EMPTY_LEDGER: TeamLedger = {
  version: 1,
  updatedAt: null,
  entries: {},
};

export class TeamLedgerStore {
  constructor(private readonly ledgerPath: string) {}

  read(): TeamLedger {
    if (!existsSync(this.ledgerPath)) {
      return { ...EMPTY_LEDGER, entries: {} };
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.ledgerPath, "utf8"),
      ) as TeamLedger;
      if (parsed && parsed.version === 1 && parsed.entries) {
        return parsed;
      }
      logger.warn({}, "team ledger schema mismatch — returning empty");
      return { ...EMPTY_LEDGER, entries: {} };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "team ledger parse failed — returning empty",
      );
      return { ...EMPTY_LEDGER, entries: {} };
    }
  }

  private async write(ledger: TeamLedger): Promise<void> {
    // Unique tmp suffix + fsync-before-rename: same atomic-write contract as
    // the experthub ledger, so concurrent writers can't clobber each other.
    const tmpPath = `${this.ledgerPath}.tmp-${randomUUID()}`;
    const fh = await open(tmpPath, "w");
    try {
      await fh.writeFile(JSON.stringify(ledger, null, 2));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmpPath, this.ledgerPath);
  }

  list(): TeamResponse[] {
    return Object.values(this.read().entries).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  get(teamId: string): TeamResponse | null {
    return this.read().entries[teamId] ?? null;
  }

  async upsert(team: TeamResponse): Promise<void> {
    const ledger = this.read();
    ledger.entries[team.id] = team;
    ledger.updatedAt = team.updatedAt;
    await this.write(ledger);
  }

  /** Remove a team entry. Returns true when an entry was actually deleted. */
  async remove(teamId: string): Promise<boolean> {
    const ledger = this.read();
    if (!ledger.entries[teamId]) {
      return false;
    }
    delete ledger.entries[teamId];
    ledger.updatedAt = new Date().toISOString();
    await this.write(ledger);
    return true;
  }
}
