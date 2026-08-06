import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type Database from "better-sqlite3";
import { ensureOpenCandleHomeDir, getStateDbPath } from "../infra/opencandle-paths.js";
import type { StateDatabase } from "../runtime/state-database.js";
import { CURRENT_SCHEMA_VERSION } from "../runtime/state-schema-version.js";

export { CURRENT_SCHEMA_VERSION } from "../runtime/state-schema-version.js";

const require = createRequire(import.meta.url);

type NativeDatabaseConstructor = new (path: string) => Database.Database;

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

  CREATE TABLE IF NOT EXISTS instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    name TEXT,
    exchange TEXT,
    currency TEXT,
    provider TEXT NOT NULL,
    provider_metadata_json TEXT,
    last_resolved_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_instruments_symbol ON instruments(symbol);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_instruments_provider_identity
    ON instruments(provider, symbol, asset_type, IFNULL(exchange, ''));

  CREATE TABLE IF NOT EXISTS instrument_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instrument_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    source_symbol TEXT NOT NULL,
    source_exchange TEXT,
    source_asset_type TEXT,
    source_id TEXT,
    raw_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_instrument_aliases_source_id
    ON instrument_aliases(source, source_id)
    WHERE source_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_instrument_aliases_source_symbol
    ON instrument_aliases(source, source_symbol, IFNULL(source_exchange, ''), IFNULL(source_asset_type, ''))
    WHERE source_id IS NULL;

  CREATE TABLE IF NOT EXISTS watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(name)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_one_default
    ON watchlists(is_default)
    WHERE is_default = 1;

  CREATE TABLE IF NOT EXISTS watchlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,
    source TEXT,
    source_row_id TEXT,
    source_metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(watchlist_id, instrument_id),
    FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_watchlist_items_source_row
    ON watchlist_items(source, source_row_id)
    WHERE source IS NOT NULL AND source_row_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_currency TEXT NOT NULL DEFAULT 'USD',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolios_one_default
    ON portfolios(is_default)
    WHERE is_default = 1;

  CREATE TABLE IF NOT EXISTS portfolio_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    avg_cost REAL NOT NULL,
    currency TEXT NOT NULL,
    opened_at TEXT,
    notes TEXT,
    source TEXT,
    source_account_ref TEXT,
    source_lot_id TEXT,
    source_row_id TEXT,
    source_metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_portfolio_lots_source_row
    ON portfolio_lots(source, source_row_id)
    WHERE source IS NOT NULL AND source_row_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_portfolio_lots_source_lot
    ON portfolio_lots(source, source_lot_id)
    WHERE source IS NOT NULL AND source_lot_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_type TEXT NOT NULL,
    scope_id INTEGER,
    instrument_id INTEGER,
    condition_type TEXT NOT NULL,
    condition_version INTEGER NOT NULL,
    condition_json TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    check_interval_seconds INTEGER,
    next_check_at TEXT,
    last_checked_at TEXT,
    last_observed_json TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    retrigger_mode TEXT NOT NULL DEFAULT 'recurring',
    last_condition_state TEXT NOT NULL DEFAULT 'unknown',
    rule_revision INTEGER NOT NULL DEFAULT 1,
    arm_cycle_id INTEGER NOT NULL DEFAULT 1,
    cooldown_seconds INTEGER,
    last_triggered_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS alert_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_rule_id INTEGER NOT NULL,
    instrument_id INTEGER,
    observed_value_json TEXT,
    triggered_at TEXT NOT NULL,
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    provider_data_at TEXT,
    source_provider TEXT,
    cache_status TEXT NOT NULL DEFAULT 'live',
    data_delay_ms INTEGER,
    trigger_source TEXT NOT NULL DEFAULT 'manual',
    dedupe_key TEXT,
    status TEXT NOT NULL,
    message TEXT,
    FOREIGN KEY (alert_rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_events_dedupe
    ON alert_events(dedupe_key)
    WHERE dedupe_key IS NOT NULL;

  CREATE TABLE IF NOT EXISTS alert_check_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    checked_count INTEGER NOT NULL DEFAULT 0,
    triggered_count INTEGER NOT NULL DEFAULT 0,
    unavailable_count INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT,
    error_json TEXT,
    provider_status_json TEXT
  );

  CREATE TABLE IF NOT EXISTS report_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    report_type TEXT NOT NULL,
    cadence TEXT NOT NULL,
    timezone TEXT NOT NULL,
    local_time TEXT NOT NULL,
    config_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS report_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    scheduled_for TEXT,
    owner_id TEXT,
    artifact_path TEXT,
    summary_json TEXT,
    errors_json TEXT,
    FOREIGN KEY (template_id) REFERENCES report_templates(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS automation_runner_leases (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    heartbeat_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    source_id INTEGER,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload_json TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    acknowledged_at TEXT
  );

  CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_event_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    completed_at TEXT,
    response_json TEXT,
    error TEXT,
    FOREIGN KEY (notification_event_id) REFERENCES notification_events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_label TEXT,
    imported_at TEXT NOT NULL,
    status TEXT NOT NULL,
    raw_metadata_json TEXT
  );

  CREATE TABLE IF NOT EXISTS import_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    row_type TEXT NOT NULL,
    source_symbol TEXT,
    source_row_id TEXT,
    source_account_ref TEXT,
    normalized_instrument_id INTEGER,
    status TEXT NOT NULL,
    error TEXT,
    source_metadata_json TEXT,
    raw_json TEXT,
    FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (normalized_instrument_id) REFERENCES instruments(id) ON DELETE SET NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_import_rows_batch_source_row
    ON import_rows(batch_id, source_row_id)
    WHERE source_row_id IS NOT NULL;
`;

export function initDatabase(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const NativeDatabase = loadNativeDatabaseConstructor();
  const db = new NativeDatabase(path);
  try {
    db.pragma("busy_timeout = 5000");
    const currentVersion = readSchemaVersion(db);
    if (currentVersion !== null && currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `State database uses newer OpenCandle schema version ${currentVersion}; this build supports version ${CURRENT_SCHEMA_VERSION}. Update OpenCandle before opening this data.`,
      );
    }
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initializeStateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function loadNativeDatabaseConstructor(): NativeDatabaseConstructor {
  const moduleName = ["better", "sqlite3"].join("-");
  const loaded = require(moduleName) as
    | NativeDatabaseConstructor
    | { default?: NativeDatabaseConstructor };
  const NativeDatabase = typeof loaded === "function" ? loaded : loaded.default;
  if (!NativeDatabase) throw new Error("Native SQLite driver is unavailable");
  return NativeDatabase;
}

export function initDefaultDatabase(): Database.Database {
  ensureOpenCandleHomeDir();
  return initDatabase(getStateDbPath());
}

export function initializeStateDatabase(db: StateDatabase): void {
  const currentVersion = readSchemaVersion(db);

  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    // Up to date — still run CREATE TABLE IF NOT EXISTS for any missing auxiliary
    // tables (e.g. workflow_events added out-of-band).
    db.exec(CURRENT_SCHEMA);
    return;
  }

  if (currentVersion !== null && currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `State database uses newer OpenCandle schema version ${currentVersion}; this build supports version ${CURRENT_SCHEMA_VERSION}. Update OpenCandle before opening this data.`,
    );
  }

  if (currentVersion === 8) {
    migrateV8ToV9(db);
    return;
  }

  if (currentVersion === 7) {
    migrateV7ToV8(db);
    migrateV8ToV9(db);
    return;
  }

  if (currentVersion === 6) {
    migrateV6ToV7(db);
    migrateV7ToV8(db);
    migrateV8ToV9(db);
    return;
  }

  if (currentVersion === 5) {
    migrateV5ToV6(db);
    migrateV6ToV7(db);
    migrateV7ToV8(db);
    migrateV8ToV9(db);
    return;
  }

  if (currentVersion === 4) {
    migrateV4ToV5(db);
    migrateV5ToV6(db);
    migrateV6ToV7(db);
    migrateV7ToV8(db);
    migrateV8ToV9(db);
    return;
  }

  if (currentVersion === 3) {
    migrateV3ToV4(db);
    migrateV4ToV5(db);
    migrateV5ToV6(db);
    migrateV6ToV7(db);
    migrateV7ToV8(db);
    migrateV8ToV9(db);
    return;
  }

  // Additive v2 → v3 → ... migration without dropping data (v8 drops
  // prediction_records and v9 drops watchlist item annotation columns as
  // explicit feature removals).
  if (currentVersion === 2) {
    migrateV2ToV3(db);
    migrateV3ToV4(db);
    migrateV4ToV5(db);
    migrateV5ToV6(db);
    migrateV6ToV7(db);
    migrateV7ToV8(db);
    migrateV8ToV9(db);
    return;
  }

  // Any other mismatch (null first-run, or a foreign schema): reset.
  resetSchema(db);
}

function migrateV2ToV3(db: StateDatabase): void {
  const cols = (db.pragma("table_info(workflow_runs)") as Array<{ name: string }>).map(
    (c) => c.name,
  );

  if (!cols.includes("turn_type")) {
    db.exec(`ALTER TABLE workflow_runs ADD COLUMN turn_type TEXT NOT NULL DEFAULT 'workflow'`);
  }

  // Ensure any tables or indexes added between versions are present.
  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(3);
}

function migrateV3ToV4(db: StateDatabase): void {
  // CURRENT_SCHEMA indexes alert_events(dedupe_key); pre-v7 tables lack the column.
  addColumnIfMissing(db, "alert_events", "dedupe_key", "TEXT");
  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(4);
}

function migrateV4ToV5(db: StateDatabase): void {
  addColumnIfMissing(db, "alert_events", "dedupe_key", "TEXT");
  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(5);
}

function migrateV5ToV6(db: StateDatabase): void {
  addColumnIfMissing(db, "import_rows", "source_row_id", "TEXT");
  addColumnIfMissing(db, "import_rows", "source_account_ref", "TEXT");
  addColumnIfMissing(db, "import_rows", "source_metadata_json", "TEXT");

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(6);
}

function migrateV6ToV7(db: StateDatabase): void {
  addColumnIfMissing(db, "alert_rules", "status", "TEXT NOT NULL DEFAULT 'active'");
  addColumnIfMissing(db, "alert_rules", "retrigger_mode", "TEXT NOT NULL DEFAULT 'recurring'");
  addColumnIfMissing(db, "alert_rules", "last_condition_state", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(db, "alert_rules", "rule_revision", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(db, "alert_rules", "arm_cycle_id", "INTEGER NOT NULL DEFAULT 1");

  addColumnIfMissing(db, "alert_events", "observed_at", "TEXT");
  addColumnIfMissing(db, "alert_events", "provider_data_at", "TEXT");
  addColumnIfMissing(db, "alert_events", "source_provider", "TEXT");
  addColumnIfMissing(db, "alert_events", "cache_status", "TEXT NOT NULL DEFAULT 'live'");
  addColumnIfMissing(db, "alert_events", "data_delay_ms", "INTEGER");
  addColumnIfMissing(db, "alert_events", "trigger_source", "TEXT NOT NULL DEFAULT 'manual'");
  addColumnIfMissing(db, "alert_events", "dedupe_key", "TEXT");

  addColumnIfMissing(db, "report_runs", "trigger_type", "TEXT NOT NULL DEFAULT 'manual'");
  addColumnIfMissing(db, "report_runs", "scheduled_for", "TEXT");
  addColumnIfMissing(db, "report_runs", "owner_id", "TEXT");

  if (tableExists(db, "alert_events")) {
    db.exec("UPDATE alert_events SET observed_at = triggered_at WHERE observed_at IS NULL");
  }

  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(7);
}

function migrateV7ToV8(db: StateDatabase): void {
  // Predictions feature removal: dropping prediction_records is the explicit,
  // documented destructive step for this table; all other rows are preserved.
  db.exec("DROP TABLE IF EXISTS prediction_records");
  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(8);
}

function migrateV8ToV9(db: StateDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlists_v9 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    );

    INSERT OR IGNORE INTO watchlists_v9 (id, name, is_default, created_at, updated_at)
      SELECT id, name, is_default, created_at, updated_at FROM watchlists;

    DROP TABLE IF EXISTS watchlist_items_v9;
    CREATE TABLE watchlist_items_v9 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watchlist_id INTEGER NOT NULL,
      instrument_id INTEGER NOT NULL,
      source TEXT,
      source_row_id TEXT,
      source_metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(watchlist_id, instrument_id),
      FOREIGN KEY (watchlist_id) REFERENCES watchlists_v9(id) ON DELETE CASCADE,
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
    );

    INSERT OR IGNORE INTO watchlist_items_v9 (
      id, watchlist_id, instrument_id, source, source_row_id, source_metadata_json, created_at, updated_at
    )
      SELECT id, watchlist_id, instrument_id, source, source_row_id, source_metadata_json, created_at, updated_at
      FROM watchlist_items;

    DROP TABLE watchlist_items;
    DROP TABLE watchlists;
    ALTER TABLE watchlists_v9 RENAME TO watchlists;
    ALTER TABLE watchlist_items_v9 RENAME TO watchlist_items;
  `);
  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_SCHEMA_VERSION);
}

function addColumnIfMissing(
  db: StateDatabase,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const cols = (db.pragma(`table_info(${tableName})`) as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (cols.length === 0) {
    if (!tableExists(db, tableName)) return;
  }
  if (!cols.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function tableExists(db: StateDatabase, tableName: string): boolean {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return table != null;
}

function readSchemaVersion(db: StateDatabase): number | null {
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

function resetSchema(db: StateDatabase): void {
  db.exec(`
    DROP TABLE IF EXISTS import_rows;
    DROP TABLE IF EXISTS import_batches;
    DROP TABLE IF EXISTS notification_delivery_attempts;
    DROP TABLE IF EXISTS notification_events;
    DROP TABLE IF EXISTS automation_runner_leases;
    DROP TABLE IF EXISTS alert_check_runs;
    DROP TABLE IF EXISTS report_runs;
    DROP TABLE IF EXISTS report_templates;
    DROP TABLE IF EXISTS alert_events;
    DROP TABLE IF EXISTS alert_rules;
    DROP TABLE IF EXISTS prediction_records;
    DROP TABLE IF EXISTS portfolio_lots;
    DROP TABLE IF EXISTS portfolios;
    DROP TABLE IF EXISTS watchlist_items;
    DROP TABLE IF EXISTS watchlists;
    DROP TABLE IF EXISTS instrument_aliases;
    DROP TABLE IF EXISTS instruments;
    DROP TABLE IF EXISTS recommendations;
    DROP TABLE IF EXISTS workflow_runs;
    DROP TABLE IF EXISTS user_preferences;
    DROP TABLE IF EXISTS tool_defaults;
    DROP TABLE IF EXISTS schema_version;
  `);
  db.exec(CURRENT_SCHEMA);
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_SCHEMA_VERSION);
}

export function getTableNames(db: StateDatabase): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function getSchemaVersion(db: StateDatabase): number {
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}
