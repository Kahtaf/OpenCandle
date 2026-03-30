import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, getTableNames, getSchemaVersion } from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import type Database from "better-sqlite3";

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

  it("sets schema version to 1", () => {
    expect(getSchemaVersion(db)).toBe(1);
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
    expect(getSchemaVersion(resetDb)).toBe(1);

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
  });
});
