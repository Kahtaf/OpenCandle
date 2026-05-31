import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { initDatabase, getTableNames, getSchemaVersion } from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";

describe("initDatabase", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
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
    expect(tables).toContain("prediction_records");
    expect(tables).toContain("alert_rules");
    expect(tables).toContain("alert_events");
    expect(tables).toContain("report_templates");
    expect(tables).toContain("report_runs");
    expect(tables).toContain("import_batches");
    expect(tables).toContain("import_rows");
    expect(tables).not.toContain("sessions");
    expect(tables).not.toContain("messages");
    expect(tables).not.toContain("tool_calls");
    expect(tables).not.toContain("memory_facts");
  });

  it("sets schema version to 6", () => {
    expect(getSchemaVersion(db)).toBe(6);
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
      INSERT INTO schema_version (version) VALUES (999);

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
    expect(getSchemaVersion(resetDb)).toBe(6);

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

    expect(getSchemaVersion(migrated)).toBe(6);

    // (a) zero row loss
    const prefCount = (migrated.prepare("SELECT COUNT(*) AS n FROM user_preferences").get() as { n: number }).n;
    const runCount = (migrated.prepare("SELECT COUNT(*) AS n FROM workflow_runs").get() as { n: number }).n;
    const recCount = (migrated.prepare("SELECT COUNT(*) AS n FROM recommendations").get() as { n: number }).n;
    expect(prefCount).toBe(2);
    expect(runCount).toBe(2);
    expect(recCount).toBe(2);

    // (b) turn_type column exists with default "workflow" applied to legacy rows
    const cols = (migrated.pragma("table_info(workflow_runs)") as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("turn_type");

    const legacyRows = migrated.prepare("SELECT turn_type FROM workflow_runs ORDER BY id").all() as Array<{ turn_type: string }>;
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

    expect(getSchemaVersion(migrated)).toBe(6);
    expect(getTableNames(migrated)).toContain("watchlist_items");
    expect(getTableNames(migrated)).toContain("portfolio_lots");
    expect(getTableNames(migrated)).toContain("prediction_records");

    const prefCount = (migrated.prepare("SELECT COUNT(*) AS n FROM user_preferences").get() as { n: number }).n;
    expect(prefCount).toBe(1);

    migrated.close();
    rmSync(base, { recursive: true, force: true });
  });
});

describe("v5 → v6 import provenance migration", () => {
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

    expect(getSchemaVersion(migrated)).toBe(6);

    const cols = (migrated.pragma("table_info(import_rows)") as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      "source_row_id",
      "source_account_ref",
      "source_metadata_json",
    ]));

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
