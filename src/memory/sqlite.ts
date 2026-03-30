import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { getStateDbPath } from "../infra/vantage-paths.js";

const CURRENT_SCHEMA_VERSION = 3;

const SCHEMA_V1 = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL DEFAULT 'global',
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    confidence TEXT DEFAULT 'medium',
    source TEXT DEFAULT 'explicit',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(namespace, key)
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    workflow_type TEXT NOT NULL,
    input_slots_json TEXT,
    resolved_slots_json TEXT,
    defaults_used_json TEXT,
    output_summary TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_run_id INTEGER NOT NULL,
    recommendation_type TEXT NOT NULL,
    symbol TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id)
  );
`;

export function initDatabase(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(SCHEMA_V1);

  // Set schema version if not yet set
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_SCHEMA_VERSION);
  } else if (row.version < CURRENT_SCHEMA_VERSION) {
    migrateSchema(db, row.version, CURRENT_SCHEMA_VERSION);
  }

  return db;
}

export function initDefaultDatabase(): Database.Database {
  return initDatabase(getStateDbPath());
}

function migrateSchema(db: Database.Database, from: number, to: number): void {
  // v2→v3: sessions, messages, tool_calls, memory_facts tables removed
  // (now handled by Pi's native session persistence).
  // Orphan tables in existing DBs are harmless — no destructive migration needed.
  db.prepare("UPDATE schema_version SET version = ?").run(to);
}

export function getTableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function getSchemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}
