import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPreferencesSnapshot } from "../../../src/memory/preferences-view.js";
import { buildMemoryContext } from "../../../src/memory/retrieval.js";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import {
  clearDefault,
  deleteDefault,
  getAllDefaults,
  listAllToolDefaults,
  setDefault,
} from "../../../src/memory/tool-defaults.js";

describe("preference transparency accessors", () => {
  let db: Database.Database;
  let storage: MemoryStorage;

  beforeEach(() => {
    db = initDatabase(":memory:");
    storage = new MemoryStorage(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("listAllPreferences", () => {
    it("lists every namespace with parsed values and provenance", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("balanced"),
        confidence: "high",
        source: "explicit",
      });
      storage.upsertPreference({
        namespace: "workspace",
        key: "position_sizing",
        valueJson: JSON.stringify({ maxPct: 8 }),
        confidence: "low",
        source: "inferred",
      });

      const rows = storage.listAllPreferences();

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        namespace: "global",
        key: "risk_profile",
        value: "balanced",
        confidence: "high",
        source: "explicit",
      });
      expect(typeof rows[0].updatedAt).toBe("string");
      expect(rows[1]).toMatchObject({
        namespace: "workspace",
        key: "position_sizing",
        value: { maxPct: 8 },
      });
    });

    it("returns an empty list for an empty store", () => {
      expect(storage.listAllPreferences()).toEqual([]);
    });

    it("keeps an unparseable stored value as its raw text", () => {
      db.prepare(
        `INSERT INTO user_preferences (namespace, key, value_json, confidence, source, created_at, updated_at)
         VALUES ('global', 'legacy', 'not json', 'medium', 'explicit', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      ).run();

      expect(storage.listAllPreferences()[0].value).toBe("not json");
    });
  });

  describe("deletePreference", () => {
    it("removes the addressed row and reports the removal", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("balanced"),
      });
      storage.upsertPreference({
        namespace: "workspace",
        key: "risk_profile",
        valueJson: JSON.stringify("aggressive"),
      });

      expect(storage.deletePreference("global", "risk_profile")).toBe(true);
      expect(storage.getPreference("global", "risk_profile")).toBeNull();
      expect(storage.getPreference("workspace", "risk_profile")).toBeTruthy();
    });

    it("reports false when nothing matched", () => {
      expect(storage.deletePreference("global", "never_saved")).toBe(false);
    });

    it("removes the deleted preference from retrieved prompt context", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("balanced"),
      });
      storage.upsertPreference({
        namespace: "global",
        key: "time_horizon",
        valueJson: JSON.stringify("1y_plus"),
      });
      expect(buildMemoryContext(storage)).toContain("risk_profile");

      storage.deletePreference("global", "risk_profile");

      const context = buildMemoryContext(storage);
      expect(context).not.toContain("risk_profile");
      expect(context).toContain("time_horizon");
      expect(storage.getWorkflowPreferences().riskProfile).toBeUndefined();
    });
  });

  describe("tool defaults", () => {
    it("lists flat rows with the stored parameter path and set time", () => {
      setDefault("get_stock_history", "range", "6mo", db);
      setDefault("get_option_chain", "filters.minVolume", 250, db);

      const rows = listAllToolDefaults(db);

      expect(rows).toEqual([
        {
          toolName: "get_option_chain",
          paramPath: "filters.minVolume",
          value: 250,
          setAt: expect.any(String),
        },
        {
          toolName: "get_stock_history",
          paramPath: "range",
          value: "6mo",
          setAt: expect.any(String),
        },
      ]);
    });

    it("refuses to treat the __enabled control row as a deletable default", async () => {
      const { assertUserDeletableToolDefaultPath } = await import(
        "../../../src/memory/tool-defaults.js"
      );
      expect(() => assertUserDeletableToolDefaultPath("__enabled")).toThrow(
        "cannot be deleted here",
      );
      expect(() => assertUserDeletableToolDefaultPath("range")).not.toThrow();
    });

    it("hides the __enabled bookkeeping rows written by tool toggles", () => {
      setDefault("get_stock_history", "range", "6mo", db);
      setDefault("backtest_strategy", "__enabled", false, db);

      const rows = listAllToolDefaults(db);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.paramPath).toBe("range");
    });

    it("deletes one parameter path and reports the removal", () => {
      setDefault("get_stock_history", "range", "6mo", db);
      setDefault("get_stock_history", "interval", "1d", db);

      expect(deleteDefault("get_stock_history", "range", db)).toBe(true);
      expect(deleteDefault("get_stock_history", "range", db)).toBe(false);
      expect(getAllDefaults(db).get("get_stock_history")).toEqual({ interval: "1d" });
    });

    it("keeps clearDefault working as the existing void-returning alias", () => {
      setDefault("get_stock_history", "range", "6mo", db);

      clearDefault("get_stock_history", "range", db);

      expect(listAllToolDefaults(db)).toEqual([]);
    });
  });

  describe("buildPreferencesSnapshot", () => {
    it("returns both stores in one payload and never carries credential material", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("balanced"),
      });
      setDefault("get_stock_history", "range", "6mo", db);

      const snapshot = buildPreferencesSnapshot(db);

      expect(Object.keys(snapshot).sort()).toEqual(["preferences", "toolDefaults"]);
      expect(snapshot.preferences).toHaveLength(1);
      expect(snapshot.toolDefaults).toHaveLength(1);
      expect(JSON.stringify(snapshot)).not.toMatch(/apiKey|api_key|secret|token|credential/i);
    });

    it("is empty for a fresh database", () => {
      expect(buildPreferencesSnapshot(db)).toEqual({ preferences: [], toolDefaults: [] });
    });
  });
});
