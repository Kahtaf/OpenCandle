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
    expect(tables).not.toContain("sessions");
    expect(tables).not.toContain("messages");
    expect(tables).not.toContain("tool_calls");
    expect(tables).not.toContain("memory_facts");
  });

  it("sets schema version to 4", () => {
    expect(getSchemaVersion(db)).toBe(4);
  });

  it("is idempotent — running again does not error", () => {
    const db2 = initDatabase(":memory:");
    const tables = getTableNames(db2);
    expect(tables.length).toBeGreaterThanOrEqual(4);
    db2.close();
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
    expect(getSchemaVersion(resetDb)).toBe(4);

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

    expect(getSchemaVersion(migrated)).toBe(4);

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
