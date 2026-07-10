import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import type { TeamWorkflow } from "@nexu/shared";
import { logger } from "../../lib/logger.js";

/**
 * On-disk ledger of team workflows (SOPs), mirroring the team ledger contract:
 * a single JSON file with atomic write-via-rename. Each entry is the full
 * {@link TeamWorkflow} keyed by workflow id.
 */
export type TeamWorkflowLedger = {
  version: 1;
  updatedAt: string | null;
  entries: Record<string, TeamWorkflow>;
};

const EMPTY_LEDGER: TeamWorkflowLedger = {
  version: 1,
  updatedAt: null,
  entries: {},
};

export class TeamWorkflowLedgerStore {
  constructor(private readonly ledgerPath: string) {}

  read(): TeamWorkflowLedger {
    if (!existsSync(this.ledgerPath)) {
      return { ...EMPTY_LEDGER, entries: {} };
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.ledgerPath, "utf8"),
      ) as TeamWorkflowLedger;
      if (parsed && parsed.version === 1 && parsed.entries) {
        return parsed;
      }
      logger.warn({}, "team workflow ledger schema mismatch — returning empty");
      return { ...EMPTY_LEDGER, entries: {} };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "team workflow ledger parse failed — returning empty",
      );
      return { ...EMPTY_LEDGER, entries: {} };
    }
  }

  private async write(ledger: TeamWorkflowLedger): Promise<void> {
    // Unique tmp suffix + fsync-before-rename: same atomic-write contract as
    // the team ledger, so concurrent writers can't clobber each other.
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

  listByTeam(teamId: string): TeamWorkflow[] {
    return Object.values(this.read().entries)
      .filter((workflow) => workflow.teamId === teamId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  get(workflowId: string): TeamWorkflow | null {
    return this.read().entries[workflowId] ?? null;
  }

  async upsert(workflow: TeamWorkflow): Promise<void> {
    const ledger = this.read();
    ledger.entries[workflow.id] = workflow;
    ledger.updatedAt = workflow.updatedAt;
    await this.write(ledger);
  }

  /** Remove a workflow entry. Returns true when an entry was actually deleted. */
  async remove(workflowId: string): Promise<boolean> {
    const ledger = this.read();
    if (!ledger.entries[workflowId]) {
      return false;
    }
    delete ledger.entries[workflowId];
    ledger.updatedAt = new Date().toISOString();
    await this.write(ledger);
    return true;
  }

  /** Remove all workflows owned by a team (team deletion cleanup). */
  async removeByTeam(teamId: string): Promise<number> {
    const ledger = this.read();
    const ids = Object.values(ledger.entries)
      .filter((workflow) => workflow.teamId === teamId)
      .map((workflow) => workflow.id);
    for (const id of ids) {
      delete ledger.entries[id];
    }
    if (ids.length > 0) {
      ledger.updatedAt = new Date().toISOString();
      await this.write(ledger);
    }
    return ids.length;
  }
}
