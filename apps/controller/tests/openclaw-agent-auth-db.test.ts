import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isAgentDatabasePath,
  readAgentAuthStore,
  writeAgentAuthStore,
} from "../src/runtime/openclaw-agent-auth-db.js";

/**
 * Pins the controller's side of the OpenClaw (>= 2026.6.5) auth-profile SQLite
 * contract. If an OpenClaw upgrade changes the table/column names, the
 * `store_json` shape, or the database-adoption preconditions, these assertions
 * must be revisited before bumping the bundled runtime.
 */
describe("openclaw-agent-auth-db", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "nexu-agent-auth-db-"));
    dbPath = path.join(
      tmpDir,
      "agents",
      "bot-1",
      "agent",
      "openclaw-agent.sqlite",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("identifies agent database paths", () => {
    expect(isAgentDatabasePath(dbPath)).toBe(true);
    expect(isAgentDatabasePath(path.join(tmpDir, "auth-profiles.json"))).toBe(
      false,
    );
  });

  it("returns null when the database does not exist", () => {
    expect(readAgentAuthStore(dbPath)).toBeNull();
  });

  it("creates the database and round-trips the secrets store", () => {
    const cell = {
      version: 1,
      profiles: {
        "anthropic:default": {
          type: "oauth",
          provider: "anthropic",
          access: "acc",
          refresh: "ref",
          expires: 123,
          email: "user@example.com",
        },
        "openai:default": { type: "api_key", provider: "openai", key: "sk-x" },
      },
    };
    writeAgentAuthStore(dbPath, cell);
    expect(readAgentAuthStore(dbPath)).toEqual(cell);
  });

  it("upserts the primary row instead of appending", () => {
    writeAgentAuthStore(dbPath, { version: 1, profiles: { a: { v: 1 } } });
    writeAgentAuthStore(dbPath, { version: 1, profiles: { b: { v: 2 } } });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const count = db
        .prepare("SELECT COUNT(*) AS n FROM auth_profile_store")
        .get() as { n: number };
      expect(count.n).toBe(1);
    } finally {
      db.close();
    }
    expect(readAgentAuthStore(dbPath)).toEqual({
      version: 1,
      profiles: { b: { v: 2 } },
    });
  });

  it("persists the exact OpenClaw contract: table, columns, primary row key, store_json shape", () => {
    writeAgentAuthStore(dbPath, {
      version: 1,
      profiles: { a: { type: "api_key" } },
    });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const columns = (
        db.prepare("PRAGMA table_info(auth_profile_store)").all() as Array<{
          name: string;
          type: string;
          pk: number;
        }>
      ).map((c) => ({ name: c.name, type: c.type, pk: c.pk }));
      expect(columns).toEqual([
        { name: "store_key", type: "TEXT", pk: 1 },
        { name: "store_json", type: "TEXT", pk: 0 },
        { name: "updated_at", type: "INTEGER", pk: 0 },
      ]);

      const row = db
        .prepare(
          "SELECT store_key, store_json, updated_at FROM auth_profile_store",
        )
        .get() as { store_key: string; store_json: string; updated_at: number };
      expect(row.store_key).toBe("primary");
      expect(JSON.parse(row.store_json)).toEqual({
        version: 1,
        profiles: { a: { type: "api_key" } },
      });
      expect(typeof row.updated_at).toBe("number");
    } finally {
      db.close();
    }
  });

  it("creates an adoptable database: user_version 0 and no schema_meta", () => {
    // OpenClaw adopts a controller-created database only when its schema guard
    // is satisfied: missing schema_meta (no ownership conflict) and
    // user_version <= 1. If either changes, OpenClaw would reject the database.
    writeAgentAuthStore(dbPath, { version: 1, profiles: {} });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const userVersion = db.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      expect(userVersion.user_version).toBe(0);

      const schemaMeta = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
        )
        .get();
      expect(schemaMeta).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
