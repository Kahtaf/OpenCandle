import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { getStateDbPath } from "../infra/opencandle-paths.js";

const CURRENT_SCHEMA_VERSION = 4;

const CURRENT_SCHEMA = `
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
    created_at TEXT NOT NULL,
    turn_type TEXT NOT NULL DEFAULT 'workflow'
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

  CREATE TABLE IF NOT EXISTS workflow_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_events_run_id ON workflow_events(run_id);

  CREATE TABLE IF NOT EXISTS tool_defaults (
    tool_name TEXT NOT NULL,
    param_path TEXT NOT NULL,
    value_json TEXT NOT NULL,
    set_at TEXT NOT NULL,
    PRIMARY KEY (tool_name, param_path)
  );
`;

export function initDatabase(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureCurrentSchema(db);

  return db;
}

export function initDefaultDatabase(): Database.Database {
  return initDatabase(getStateDbPath());
}

function ensureCurrentSchema(db: Database.Database): void {
  const currentVersion = readSchemaVersion(db);

  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    // Up to date — still run CREATE TABLE IF NOT EXISTS for any missing auxiliary
    // tables (e.g. workflow_events added out-of-band).
    db.exec(CURRENT_SCHEMA);
    return;
  }

  if (currentVersion === 3) {
    migrateV3ToV4(db);
    return;
  }

  // Additive v2 → v3 → v4 migration without dropping data.
  if (currentVersion === 2) {
    migrateV2ToV3(db);
    migrateV3ToV4(db);
    return;
  }

  // Any other mismatch (null first-run, or a foreign schema): reset.
  resetSchema(db);
}

function migrateV2ToV3(db: Database.Database): void {
  const cols = (db.pragma("table_info(workflow_runs)") as Array<{ name: string }>).map(
    (c) => c.name,
  );

  if (!cols.includes("turn_type")) {
    db.exec(
      `ALTER TABLE workflow_runs ADD COLUMN turn_type TEXT NOT NULL DEFAULT 'workflow'`,
    );
  }

  // Ensure any tables or indexes added between versions are present.
  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(3);
}

function migrateV3ToV4(db: Database.Database): void {
  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_SCHEMA_VERSION);
}

function readSchemaVersion(db: Database.Database): number | null {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get() as { name: string } | undefined;
  if (!table) {
    return null;
  }

  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;
  return row?.version ?? null;
}

function resetSchema(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS recommendations;
    DROP TABLE IF EXISTS workflow_runs;
    DROP TABLE IF EXISTS user_preferences;
    DROP TABLE IF EXISTS tool_defaults;
    DROP TABLE IF EXISTS schema_version;
  `);
  db.exec(CURRENT_SCHEMA);
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_SCHEMA_VERSION);
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
