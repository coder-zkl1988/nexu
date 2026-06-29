import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite-backed auth profile persistence matching the OpenClaw runtime
 * contract (OpenClaw >= 2026.6.5).
 *
 * OpenClaw stores per-agent auth profiles in `<agentDir>/openclaw-agent.sqlite`,
 * table `auth_profile_store`, single row keyed `'primary'`, with the entire
 * secrets store JSON in `store_json`. The runtime reads ONLY from SQLite; the
 * legacy `auth-profiles.json` file is no longer read at runtime. See
 * `specs/design-docs/2026-04-14-openclaw-registry-cache-invalidation.md` for the
 * companion restart-on-change rule.
 *
 * Database creation: the controller pre-seeds credentials before OpenClaw boots
 * (the "seed config before runtime start" bootstrap optimization). To make that
 * work for SQLite, the controller creates the database with ONLY the
 * `auth_profile_store` table when absent. OpenClaw adopts such a database on
 * boot: its schema guard tolerates a missing `schema_meta` row and a zero
 * `user_version`, and its `CREATE TABLE IF NOT EXISTS` schema materialization
 * preserves the controller-written row while filling in the remaining tables.
 * The contract (table/column names + `store_json` shape) is pinned by
 * `openclaw-agent-auth-db.test.ts` so an upstream format change is caught.
 */

const PRIMARY_ROW_KEY = "primary";

/** Matches OpenClaw's per-agent SQLite busy timeout (writes use BEGIN IMMEDIATE). */
const SQLITE_BUSY_TIMEOUT_MS = 5000;

/**
 * OpenClaw's exact `auth_profile_store` DDL. Replicated so a controller-created
 * database is byte-compatible with what OpenClaw's `ensureAgentSchema` expects
 * (its `CREATE TABLE IF NOT EXISTS` then becomes a no-op for this table).
 */
const AUTH_PROFILE_STORE_DDL = `CREATE TABLE IF NOT EXISTS auth_profile_store (
  store_key TEXT NOT NULL PRIMARY KEY,
  store_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);`;

export interface AgentAuthStoreCell {
  version: number;
  profiles: Record<string, unknown>;
}

function parseStoreJson(
  raw: string | null | undefined,
): AgentAuthStoreCell | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  return {
    version: typeof record.version === "number" ? record.version : 1,
    profiles:
      typeof record.profiles === "object" &&
      record.profiles !== null &&
      !Array.isArray(record.profiles)
        ? (record.profiles as Record<string, unknown>)
        : {},
  };
}

/**
 * Read the `auth_profile_store` primary row from an agent database.
 * Returns null when the database does not exist or holds no store row.
 */
export function readAgentAuthStore(
  databasePath: string,
): AgentAuthStoreCell | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
  } catch {
    // Database file does not exist (read-only open cannot create it).
    return null;
  }
  try {
    const row = db
      .prepare("SELECT store_json FROM auth_profile_store WHERE store_key = ?")
      .get(PRIMARY_ROW_KEY) as { store_json?: string } | undefined;
    return parseStoreJson(row?.store_json);
  } catch {
    // Missing table (database created by OpenClaw but auth schema not yet
    // materialized) is treated as "no store" rather than a hard failure.
    return null;
  } finally {
    db.close();
  }
}

/**
 * Upsert the `auth_profile_store` primary row in an agent database, creating the
 * database and table if absent so credentials can be seeded before OpenClaw
 * boots. Leaves OpenClaw's `auth_profile_state` and other tables untouched.
 *
 * Callers MUST restart the OpenClaw runtime after a write to a database it is
 * already using: the runtime caches the auth store in memory and does not watch
 * the SQLite file.
 */
export function writeAgentAuthStore(
  databasePath: string,
  cell: AgentAuthStoreCell,
): void {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
    db.exec(AUTH_PROFILE_STORE_DDL);
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.prepare(
        `INSERT INTO auth_profile_store (store_key, store_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(store_key) DO UPDATE SET
           store_json = excluded.store_json,
           updated_at = excluded.updated_at`,
      ).run(PRIMARY_ROW_KEY, JSON.stringify(cell), Date.now());
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    db.close();
  }
}

/** Derive the OpenClaw agent SQLite path that sits beside an `agent/` dir. */
export function isAgentDatabasePath(filePath: string): boolean {
  return filePath.endsWith("openclaw-agent.sqlite");
}
