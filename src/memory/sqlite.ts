import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { getStateDbPath } from "../infra/opencandle-paths.js";

const CURRENT_SCHEMA_VERSION = 6;

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
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_one_default
    ON watchlists(is_default)
    WHERE is_default = 1;

  CREATE TABLE IF NOT EXISTS watchlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,
    thesis TEXT,
    notes TEXT,
    tags_json TEXT,
    target_price REAL,
    stop_price REAL,
    price_currency TEXT,
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

  CREATE TABLE IF NOT EXISTS prediction_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instrument_id INTEGER NOT NULL,
    direction TEXT NOT NULL,
    conviction REAL NOT NULL,
    entry_price REAL NOT NULL,
    target_price REAL,
    opened_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL,
    resolved_at TEXT,
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
  );

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
    status TEXT NOT NULL,
    message TEXT,
    FOREIGN KEY (alert_rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
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
    artifact_path TEXT,
    summary_json TEXT,
    errors_json TEXT,
    FOREIGN KEY (template_id) REFERENCES report_templates(id) ON DELETE SET NULL
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

  if (currentVersion === 5) {
    migrateV5ToV6(db);
    return;
  }

  if (currentVersion === 4) {
    migrateV4ToV5(db);
    migrateV5ToV6(db);
    return;
  }

  if (currentVersion === 3) {
    migrateV3ToV4(db);
    migrateV4ToV5(db);
    migrateV5ToV6(db);
    return;
  }

  // Additive v2 → v3 → v4 → v5 → v6 migration without dropping data.
  if (currentVersion === 2) {
    migrateV2ToV3(db);
    migrateV3ToV4(db);
    migrateV4ToV5(db);
    migrateV5ToV6(db);
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
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(4);
}

function migrateV4ToV5(db: Database.Database): void {
  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(5);
}

function migrateV5ToV6(db: Database.Database): void {
  addColumnIfMissing(db, "import_rows", "source_row_id", "TEXT");
  addColumnIfMissing(db, "import_rows", "source_account_ref", "TEXT");
  addColumnIfMissing(db, "import_rows", "source_metadata_json", "TEXT");

  db.exec(CURRENT_SCHEMA);

  db.prepare("DELETE FROM schema_version").run();
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_SCHEMA_VERSION);
}

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const cols = (db.pragma(`table_info(${tableName})`) as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
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
    DROP TABLE IF EXISTS import_rows;
    DROP TABLE IF EXISTS import_batches;
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
