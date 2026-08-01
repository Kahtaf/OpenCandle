import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getSchemaVersion,
  getTableNames,
  initDatabase,
  initDefaultDatabase,
} from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";

function rowCount(db: Database.Database, tableName: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).get() as { n: number }).n;
}

describe("initDatabase", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("migrates a v4 database whose alert_events lacks dedupe_key without crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-migration-v4-"));
    const path = join(dir, "state.db");

    // Shape a v4-era database: current tables, but alert_events without the
    // v7 dedupe_key column (whose unique index used to crash the migration).
    const v4 = initDatabase(path);
    v4.exec(`
      DROP INDEX IF EXISTS idx_alert_events_dedupe;
      ALTER TABLE alert_events DROP COLUMN dedupe_key;
      DELETE FROM schema_version;
      INSERT INTO schema_version (version) VALUES (4);
    `);
    v4.close();

    const migrated = initDatabase(path);
    const columns = (migrated.pragma("table_info(alert_events)") as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(columns).toContain("dedupe_key");
    expect(getSchemaVersion(migrated)).toBeGreaterThanOrEqual(7);
    migrated.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates domain tables plus schema_version", () => {
    const tables = getTableNames(db);
    expect(tables).toContain("user_preferences");
    expect(tables).toContain("workflow_runs");
    expect(tables).toContain("recommendations");
    expect(tables).toContain("schema_version");
    expect(tables).toContain("instruments");
    expect(tables).toContain("instrument_aliases");
    expect(tables).toContain("watchlists");
    expect(tables).toContain("watchlist_items");
    expect(tables).toContain("portfolios");
    expect(tables).toContain("portfolio_lots");
    expect(tables).not.toContain("prediction_records");
    expect(tables).toContain("alert_rules");
    expect(tables).toContain("alert_events");
    expect(tables).toContain("alert_check_runs");
    expect(tables).toContain("report_templates");
    expect(tables).toContain("report_runs");
    expect(tables).toContain("automation_runner_leases");
    expect(tables).toContain("notification_events");
    expect(tables).toContain("notification_delivery_attempts");
    expect(tables).toContain("import_batches");
    expect(tables).toContain("import_rows");
    expect(tables).not.toContain("sessions");
    expect(tables).not.toContain("messages");
    expect(tables).not.toContain("tool_calls");
    expect(tables).not.toContain("memory_facts");
  });

  it("sets schema version to 9", () => {
    expect(getSchemaVersion(db)).toBe(9);
  });

  it("is idempotent — running again does not error", () => {
    const db2 = initDatabase(":memory:");
    const tables = getTableNames(db2);
    expect(tables.length).toBeGreaterThanOrEqual(4);
    db2.close();
  });

  it("sets a busy timeout so concurrent writers can wait for normal locks", () => {
    const busyTimeout = db.pragma("busy_timeout", { simple: true });
    expect(busyTimeout).toBe(5000);
  });

  it("creates parent directories for file-backed databases", () => {
    const base = join(tmpdir(), `vantage-sqlite-test-${Date.now()}`);
    const dbPath = join(base, "nested", "state.db");
    const fileDb = initDatabase(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    fileDb.close();
    rmSync(base, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")(
    "creates the default state DB under owner-only home",
    () => {
      const originalHome = process.env.OPENCANDLE_HOME;
      const base = mkdtempSync(join(tmpdir(), "opencandle-default-db-perms-"));
      const home = join(base, "home");
      process.env.OPENCANDLE_HOME = home;

      try {
        const defaultDb = initDefaultDatabase();
        defaultDb.close();

        expect(existsSync(join(home, "state.db"))).toBe(true);
        expect(statSync(home).mode & 0o777).toBe(0o700);
      } finally {
        if (originalHome == null) {
          delete process.env.OPENCANDLE_HOME;
        } else {
          process.env.OPENCANDLE_HOME = originalHome;
        }
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "repairs the default state DB home directory permissions",
    () => {
      const originalHome = process.env.OPENCANDLE_HOME;
      const home = mkdtempSync(join(tmpdir(), "opencandle-default-db-existing-"));
      process.env.OPENCANDLE_HOME = home;

      try {
        const defaultDb = initDefaultDatabase();
        defaultDb.close();

        expect(statSync(home).mode & 0o777).toBe(0o700);
      } finally {
        if (originalHome == null) {
          delete process.env.OPENCANDLE_HOME;
        } else {
          process.env.OPENCANDLE_HOME = originalHome;
        }
        rmSync(home, { recursive: true, force: true });
      }
    },
  );

  it("resets stale pre-release schemas to the current layout", () => {
    const base = mkdtempSync(join(tmpdir(), "vantage-sqlite-reset-"));
    const dbPath = join(base, "state.db");
    const legacyDb = initDatabase(dbPath);

    legacyDb.exec(`
      DROP TABLE recommendations;
      DROP TABLE workflow_runs;
      DROP TABLE user_preferences;
      DROP TABLE schema_version;

      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (1);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL
      );

      CREATE TABLE user_preferences (
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

      CREATE TABLE workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        workflow_type TEXT NOT NULL,
        input_slots_json TEXT,
        resolved_slots_json TEXT,
        defaults_used_json TEXT,
        output_summary TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_run_id INTEGER NOT NULL,
        recommendation_type TEXT NOT NULL,
        symbol TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id)
      );
    `);
    legacyDb.close();

    const resetDb = initDatabase(dbPath);
    expect(getSchemaVersion(resetDb)).toBe(9);

    const workflowRunsSql = resetDb
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workflow_runs'")
      .get() as { sql: string };
    expect(workflowRunsSql.sql).not.toContain("REFERENCES sessions");

    const storage = new MemoryStorage(resetDb);
    expect(() =>
      storage.insertWorkflowRun({
        sessionId: "test-session",
        workflowType: "portfolio_builder",
        inputSlotsJson: "{}",
        resolvedSlotsJson: "{}",
        defaultsUsedJson: "[]",
      }),
    ).not.toThrow();

    resetDb.close();
    rmSync(base, { recursive: true, force: true });
  });

  it("refuses to open state written by a newer schema without modifying it", () => {
    const base = mkdtempSync(join(tmpdir(), "opencandle-sqlite-newer-schema-"));
    const dbPath = join(base, "state.db");
    const newerDb = initDatabase(dbPath);
    newerDb.exec(`
      CREATE TABLE newer_state (value TEXT NOT NULL);
      INSERT INTO newer_state (value) VALUES ('keep-me');
      DELETE FROM schema_version;
      INSERT INTO schema_version (version) VALUES (999);
    `);
    newerDb.close();

    expect(() => initDatabase(dbPath)).toThrow("newer OpenCandle schema version 999");

    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);

    const untouched = new Database(dbPath);
    expect(untouched.prepare("SELECT value FROM newer_state").get()).toEqual({ value: "keep-me" });
    expect(untouched.prepare("SELECT version FROM schema_version").get()).toEqual({ version: 999 });
    untouched.close();
    rmSync(base, { recursive: true, force: true });
  });

  it("user_preferences table has expected columns", () => {
    const info = db.pragma("table_info(user_preferences)") as Array<{ name: string }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("namespace");
    expect(cols).toContain("key");
    expect(cols).toContain("value_json");
    expect(cols).toContain("confidence");
    expect(cols).toContain("source");
    expect(cols).toContain("created_at");
    expect(cols).toContain("updated_at");
  });

  it("workflow_runs table has expected columns", () => {
    const info = db.pragma("table_info(workflow_runs)") as Array<{ name: string }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("session_id");
    expect(cols).toContain("workflow_type");
    expect(cols).toContain("input_slots_json");
    expect(cols).toContain("resolved_slots_json");
    expect(cols).toContain("defaults_used_json");
    expect(cols).toContain("output_summary");
    expect(cols).toContain("created_at");
    expect(cols).toContain("turn_type");
  });
});

describe("v2 → v3 additive migration", () => {
  it("adds turn_type column without dropping existing rows", () => {
    const base = mkdtempSync(join(tmpdir(), "vantage-v2-migrate-"));
    const dbPath = join(base, "state.db");

    // Build a v2 database by hand (pre-turn_type schema).
    const v2 = new Database(dbPath);
    v2.pragma("journal_mode = WAL");
    v2.pragma("foreign_keys = ON");
    v2.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (2);

      CREATE TABLE user_preferences (
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

      CREATE TABLE workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        workflow_type TEXT NOT NULL,
        input_slots_json TEXT,
        resolved_slots_json TEXT,
        defaults_used_json TEXT,
        output_summary TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_run_id INTEGER NOT NULL,
        recommendation_type TEXT NOT NULL,
        symbol TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id)
      );

      INSERT INTO user_preferences (namespace, key, value_json, confidence, source, created_at, updated_at)
      VALUES ('global', 'risk_profile', '"aggressive"', 'high', 'inferred', '2024-01-01', '2024-01-01'),
             ('global', 'time_horizon', '"long"', 'medium', 'explicit', '2024-01-02', '2024-01-02');

      INSERT INTO workflow_runs (session_id, workflow_type, input_slots_json, resolved_slots_json, defaults_used_json, output_summary, created_at)
      VALUES ('sess-a', 'portfolio_builder', '{}', '{}', '[]', 'legacy-a', '2024-01-03'),
             ('sess-b', 'options_screener', '{}', '{}', '[]', 'legacy-b', '2024-01-04');

      INSERT INTO recommendations (workflow_run_id, recommendation_type, symbol, payload_json, created_at)
      VALUES (1, 'position', 'AAPL', '{}', '2024-01-05'),
             (2, 'option', 'TSLA', '{}', '2024-01-06');
    `);
    v2.close();

    // Run the migration.
    const migrated = initDatabase(dbPath);

    expect(getSchemaVersion(migrated)).toBe(9);

    // (a) zero row loss
    const prefCount = (
      migrated.prepare("SELECT COUNT(*) AS n FROM user_preferences").get() as { n: number }
    ).n;
    const runCount = (
      migrated.prepare("SELECT COUNT(*) AS n FROM workflow_runs").get() as { n: number }
    ).n;
    const recCount = (
      migrated.prepare("SELECT COUNT(*) AS n FROM recommendations").get() as { n: number }
    ).n;
    expect(prefCount).toBe(2);
    expect(runCount).toBe(2);
    expect(recCount).toBe(2);

    // (b) turn_type column exists with default "workflow" applied to legacy rows
    const cols = (migrated.pragma("table_info(workflow_runs)") as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("turn_type");

    const legacyRows = migrated
      .prepare("SELECT turn_type FROM workflow_runs ORDER BY id")
      .all() as Array<{ turn_type: string }>;
    expect(legacyRows).toEqual([{ turn_type: "workflow" }, { turn_type: "workflow" }]);

    migrated.close();
    rmSync(base, { recursive: true, force: true });
  });
});

describe("v4 → v5 market-state migration", () => {
  it("adds market-state tables without dropping existing memory rows", () => {
    const base = mkdtempSync(join(tmpdir(), "vantage-v4-market-state-"));
    const dbPath = join(base, "state.db");

    const v4 = new Database(dbPath);
    v4.pragma("journal_mode = WAL");
    v4.pragma("foreign_keys = ON");
    v4.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (4);

      CREATE TABLE user_preferences (
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

      CREATE TABLE workflow_runs (
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

      CREATE TABLE recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_run_id INTEGER NOT NULL,
        recommendation_type TEXT NOT NULL,
        symbol TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id)
      );

      CREATE TABLE workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX idx_workflow_events_run_id ON workflow_events(run_id);

      CREATE TABLE tool_defaults (
        tool_name TEXT NOT NULL,
        param_path TEXT NOT NULL,
        value_json TEXT NOT NULL,
        set_at TEXT NOT NULL,
        PRIMARY KEY (tool_name, param_path)
      );

      INSERT INTO user_preferences (namespace, key, value_json, confidence, source, created_at, updated_at)
      VALUES ('global', 'risk_profile', '"balanced"', 'high', 'explicit', '2026-01-01', '2026-01-01');
    `);
    v4.close();

    const migrated = initDatabase(dbPath);

    expect(getSchemaVersion(migrated)).toBe(9);
    expect(getTableNames(migrated)).toContain("watchlist_items");
    expect(getTableNames(migrated)).toContain("portfolio_lots");
    expect(getTableNames(migrated)).not.toContain("prediction_records");

    const prefCount = (
      migrated.prepare("SELECT COUNT(*) AS n FROM user_preferences").get() as { n: number }
    ).n;
    expect(prefCount).toBe(1);

    migrated.close();
    rmSync(base, { recursive: true, force: true });
  });
});

describe("v5 → v6 import provenance migration", () => {
  it("preserves existing market-state rows while adding import provenance columns", () => {
    const base = mkdtempSync(join(tmpdir(), "vantage-v5-market-state-preserve-"));
    const dbPath = join(base, "state.db");

    const v5 = new Database(dbPath);
    v5.pragma("journal_mode = WAL");
    v5.pragma("foreign_keys = ON");
    v5.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (5);

      CREATE TABLE instruments (
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

      CREATE TABLE watchlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE watchlist_items (
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
        FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE,
        FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
      );

      CREATE TABLE portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        base_currency TEXT NOT NULL DEFAULT 'USD',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE portfolio_lots (
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

      CREATE TABLE prediction_records (
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

      CREATE TABLE alert_rules (
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

      CREATE TABLE alert_events (
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

      CREATE TABLE report_templates (
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

      CREATE TABLE report_runs (
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

      CREATE TABLE import_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_label TEXT,
        imported_at TEXT NOT NULL,
        status TEXT NOT NULL,
        raw_metadata_json TEXT
      );

      CREATE TABLE import_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        row_type TEXT NOT NULL,
        source_symbol TEXT,
        normalized_instrument_id INTEGER,
        status TEXT NOT NULL,
        error TEXT,
        raw_json TEXT,
        FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
      );

      INSERT INTO instruments (symbol, asset_type, name, exchange, currency, provider, last_resolved_at, created_at, updated_at)
      VALUES ('AAPL', 'EQUITY', 'Apple Inc.', 'NMS', 'USD', 'yahoo', '2026-05-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z');
      INSERT INTO watchlists (name, is_default, created_at, updated_at)
      VALUES ('Default Watchlist', 1, '2026-05-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z');
      INSERT INTO watchlist_items (watchlist_id, instrument_id, notes, target_price, created_at, updated_at)
      VALUES (1, 1, 'core thesis', 220, '2026-05-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z');
      INSERT INTO portfolios (name, base_currency, is_default, created_at, updated_at)
      VALUES ('Default Portfolio', 'USD', 1, '2026-05-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z');
      INSERT INTO portfolio_lots (portfolio_id, instrument_id, quantity, avg_cost, currency, created_at, updated_at)
      VALUES (1, 1, 2, 180, 'USD', '2026-05-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z');
      INSERT INTO prediction_records (instrument_id, direction, conviction, entry_price, opened_at, expires_at, status, created_at, updated_at)
      VALUES (1, 'bullish', 8, 180, '2026-05-31', '2026-06-30', 'open', '2026-05-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z');
      INSERT INTO alert_rules (scope_type, instrument_id, condition_type, condition_version, condition_json, timeframe, cooldown_seconds, created_at, updated_at)
      VALUES ('instrument', 1, 'price_crosses_above', 1, '{"threshold":220}', 'quote', 3600, '2026-05-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z');
      INSERT INTO alert_events (alert_rule_id, instrument_id, observed_value_json, triggered_at, status, message)
      VALUES (1, 1, '{"value":221,"field":"price"}', '2026-05-31T12:01:00.000Z', 'triggered', 'AAPL crossed 220');
      INSERT INTO report_templates (name, report_type, cadence, timezone, local_time, config_json, created_at, updated_at)
      VALUES ('Morning Watchlist', 'watchlist_daily', 'daily', 'America/Toronto', '08:00', '{"targets":{"default_watchlist":true}}', '2026-05-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z');
      INSERT INTO report_runs (template_id, started_at, completed_at, status, summary_json)
      VALUES (1, '2026-05-31T12:02:00.000Z', '2026-05-31T12:02:03.000Z', 'completed', '{"symbols":1}');
      INSERT INTO import_batches (source, source_label, imported_at, status)
      VALUES ('tradingview', 'TV export', '2026-05-31T12:00:00.000Z', 'completed');
      INSERT INTO import_rows (batch_id, row_type, source_symbol, normalized_instrument_id, status, raw_json)
      VALUES (1, 'watchlist_item', 'NASDAQ:AAPL', 1, 'imported', '{"Symbol":"NASDAQ:AAPL"}');
    `);
    v5.close();

    const migrated = initDatabase(dbPath);

    expect(getSchemaVersion(migrated)).toBe(9);
    expect(rowCount(migrated, "instruments")).toBe(1);
    expect(rowCount(migrated, "watchlist_items")).toBe(1);
    expect(rowCount(migrated, "portfolio_lots")).toBe(1);
    // v8 drops prediction_records as the predictions-feature removal.
    expect(getTableNames(migrated)).not.toContain("prediction_records");
    expect(rowCount(migrated, "alert_rules")).toBe(1);
    expect(rowCount(migrated, "alert_events")).toBe(1);
    expect(rowCount(migrated, "report_templates")).toBe(1);
    expect(rowCount(migrated, "report_runs")).toBe(1);
    expect(rowCount(migrated, "import_rows")).toBe(1);

    const watchlistItem = migrated.prepare("SELECT id FROM watchlist_items").get() as {
      id: number;
    };
    expect(watchlistItem.id).toBe(1);
    const watchlistColumns = (
      migrated.pragma("table_info(watchlist_items)") as Array<{ name: string }>
    ).map((column) => column.name);
    expect(watchlistColumns).not.toContain("notes");
    expect(watchlistColumns).not.toContain("target_price");
    expect(watchlistColumns).not.toContain("stop_price");
    expect(watchlistColumns).not.toContain("thesis");
    expect(watchlistColumns).not.toContain("tags_json");
    expect(watchlistColumns).not.toContain("price_currency");

    migrated.close();
    rmSync(base, { recursive: true, force: true });
  });

  it("adds import-row provenance columns without dropping existing rows", () => {
    const base = mkdtempSync(join(tmpdir(), "vantage-v5-import-provenance-"));
    const dbPath = join(base, "state.db");

    const v5 = new Database(dbPath);
    v5.pragma("journal_mode = WAL");
    v5.pragma("foreign_keys = ON");
    v5.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (5);

      CREATE TABLE import_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_label TEXT,
        imported_at TEXT NOT NULL,
        status TEXT NOT NULL,
        raw_metadata_json TEXT
      );

      CREATE TABLE import_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        row_type TEXT NOT NULL,
        source_symbol TEXT,
        normalized_instrument_id INTEGER,
        status TEXT NOT NULL,
        error TEXT,
        raw_json TEXT,
        FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
      );

      INSERT INTO import_batches (source, source_label, imported_at, status, raw_metadata_json)
      VALUES ('tradingview', 'TV export', '2026-05-31T13:00:00.000Z', 'completed', '{"file":"watchlist.csv"}');

      INSERT INTO import_rows (batch_id, row_type, source_symbol, status, raw_json)
      VALUES (1, 'watchlist_item', 'NASDAQ:AAPL', 'imported', '{"Symbol":"NASDAQ:AAPL"}');
    `);
    v5.close();

    const migrated = initDatabase(dbPath);

    expect(getSchemaVersion(migrated)).toBe(9);

    const cols = (migrated.pragma("table_info(import_rows)") as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toEqual(
      expect.arrayContaining(["source_row_id", "source_account_ref", "source_metadata_json"]),
    );

    const row = migrated.prepare("SELECT source_symbol, raw_json FROM import_rows").get() as {
      source_symbol: string;
      raw_json: string;
    };
    expect(row).toEqual({
      source_symbol: "NASDAQ:AAPL",
      raw_json: '{"Symbol":"NASDAQ:AAPL"}',
    });

    migrated.close();
    rmSync(base, { recursive: true, force: true });
  });
});

describe("v6 → v7 local automation migration", () => {
  it("preserves alert/report rows while adding automation runtime state", () => {
    const base = mkdtempSync(join(tmpdir(), "vantage-v6-automation-runtime-"));
    const dbPath = join(base, "state.db");

    const v6 = new Database(dbPath);
    v6.pragma("journal_mode = WAL");
    v6.pragma("foreign_keys = ON");
    v6.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (6);

      CREATE TABLE instruments (
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

      CREATE TABLE alert_rules (
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

      CREATE TABLE alert_events (
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

      CREATE TABLE report_templates (
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

      CREATE TABLE report_runs (
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

      INSERT INTO instruments (
        symbol, asset_type, name, exchange, currency, provider,
        last_resolved_at, created_at, updated_at
      )
      VALUES ('AAPL', 'equity', 'Apple Inc.', 'NMS', 'USD', 'yahoo',
        '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z');

      INSERT INTO alert_rules (
        scope_type, instrument_id, condition_type, condition_version, condition_json,
        timeframe, enabled, cooldown_seconds, created_at, updated_at
      )
      VALUES ('instrument', 1, 'price_crosses_above', 1, '{"threshold":250,"field":"last_price"}',
        'quote', 1, 3600, '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z');

      INSERT INTO alert_events (
        alert_rule_id, instrument_id, observed_value_json, triggered_at, status, message
      )
      VALUES (1, 1, '{"value":260}', '2026-06-01T12:01:00.000Z', 'triggered', 'AAPL triggered');

      INSERT INTO report_templates (
        name, report_type, cadence, timezone, local_time, config_json, enabled,
        created_at, updated_at
      )
      VALUES ('Morning watchlist', 'watchlist_daily', 'daily', 'America/Toronto', '08:00',
        '{"targets":{"default_watchlist":true}}', 1, '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z');

      INSERT INTO report_runs (
        template_id, started_at, completed_at, status, summary_json
      )
      VALUES (1, '2026-06-01T12:02:00.000Z', '2026-06-01T12:03:00.000Z', 'completed', '{"ok":true}');
    `);
    v6.close();

    const migrated = initDatabase(dbPath);

    expect(getSchemaVersion(migrated)).toBe(9);
    expect(getTableNames(migrated)).toContain("automation_runner_leases");
    expect(getTableNames(migrated)).toContain("alert_check_runs");
    expect(getTableNames(migrated)).toContain("notification_events");
    expect(getTableNames(migrated)).toContain("notification_delivery_attempts");

    const rule = migrated
      .prepare(
        "SELECT status, retrigger_mode, last_condition_state, rule_revision, arm_cycle_id FROM alert_rules",
      )
      .get() as {
      status: string;
      retrigger_mode: string;
      last_condition_state: string;
      rule_revision: number;
      arm_cycle_id: number;
    };
    expect(rule).toEqual({
      status: "active",
      retrigger_mode: "recurring",
      last_condition_state: "unknown",
      rule_revision: 1,
      arm_cycle_id: 1,
    });

    const event = migrated
      .prepare(
        "SELECT observed_at, trigger_source, source_provider, cache_status FROM alert_events",
      )
      .get() as {
      observed_at: string;
      trigger_source: string;
      source_provider: string | null;
      cache_status: string;
    };
    expect(event).toEqual({
      observed_at: "2026-06-01T12:01:00.000Z",
      trigger_source: "manual",
      source_provider: null,
      cache_status: "live",
    });

    const run = migrated
      .prepare("SELECT trigger_type, scheduled_for, owner_id FROM report_runs")
      .get() as {
      trigger_type: string;
      scheduled_for: string | null;
      owner_id: string | null;
    };
    expect(run).toEqual({ trigger_type: "manual", scheduled_for: null, owner_id: null });
    expect(rowCount(migrated, "alert_rules")).toBe(1);
    expect(rowCount(migrated, "alert_events")).toBe(1);
    expect(rowCount(migrated, "report_runs")).toBe(1);

    migrated.close();
    rmSync(base, { recursive: true, force: true });
  });
});
