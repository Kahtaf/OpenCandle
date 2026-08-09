import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteStoredPreference,
  deleteStoredToolDefault,
  getPreferencesSnapshot,
} from "../../../gui/server/preferences-api.js";
import { buildMemoryContext } from "../../../src/memory/retrieval.js";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import { setDefault } from "../../../src/memory/tool-defaults.js";

describe("GUI preferences API", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("lists both stores in one payload with no credential material", () => {
    new MemoryStorage(db).upsertPreference({
      namespace: "global",
      key: "risk_profile",
      valueJson: JSON.stringify("balanced"),
      confidence: "high",
      source: "explicit",
    });
    setDefault("get_stock_history", "range", "6mo", db);

    const snapshot = getPreferencesSnapshot(db);

    expect(Object.keys(snapshot).sort()).toEqual(["preferences", "toolDefaults"]);
    expect(snapshot.preferences).toEqual([
      {
        namespace: "global",
        key: "risk_profile",
        value: "balanced",
        source: "explicit",
        confidence: "high",
        updatedAt: expect.any(String),
      },
    ]);
    expect(snapshot.toolDefaults).toEqual([
      {
        toolName: "get_stock_history",
        paramPath: "range",
        value: "6mo",
        setAt: expect.any(String),
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/apikey|api_key|secret|token|credential/i);
  });

  it("deletes a preference durably and drops it from retrieved prompt context", () => {
    const storage = new MemoryStorage(db);
    storage.upsertPreference({
      namespace: "global",
      key: "risk_profile",
      valueJson: JSON.stringify("balanced"),
    });
    setDefault("get_stock_history", "range", "6mo", db);

    const afterDelete = deleteStoredPreference("global", "risk_profile", db);

    expect(afterDelete.preferences).toEqual([]);
    expect(afterDelete.toolDefaults).toHaveLength(1);
    expect(getPreferencesSnapshot(db).preferences).toEqual([]);
    expect(buildMemoryContext(storage)).not.toContain("risk_profile");
  });

  it("deletes one tool default and returns the refreshed payload", () => {
    setDefault("get_stock_history", "range", "6mo", db);
    setDefault("get_stock_history", "interval", "1d", db);

    const afterDelete = deleteStoredToolDefault("get_stock_history", "range", db);

    expect(afterDelete.toolDefaults.map((row) => row.paramPath)).toEqual(["interval"]);
  });

  it("stays idempotent when the row is already gone", () => {
    expect(deleteStoredPreference("global", "risk_profile", db)).toEqual({
      preferences: [],
      toolDefaults: [],
    });
  });

  it("rejects unusable identifiers before touching the database", () => {
    expect(() => deleteStoredPreference("", "risk_profile", db)).toThrow(/namespace/i);
    expect(() => deleteStoredPreference("global", "", db)).toThrow(/key/i);
    expect(() => deleteStoredPreference("global", "x".repeat(400), db)).toThrow(/key/i);
    expect(() => deleteStoredToolDefault("", "range", db)).toThrow(/tool/i);
    expect(() => deleteStoredToolDefault("get_stock_history", "", db)).toThrow(/parameter/i);
  });
});
