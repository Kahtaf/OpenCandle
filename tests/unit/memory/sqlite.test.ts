import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, getTableNames, getSchemaVersion } from "../../../src/memory/sqlite.js";
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

  it("sets schema version to 3", () => {
    expect(getSchemaVersion(db)).toBe(3);
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
