import { describe, expect, it } from "vitest";
import { MarketStateService } from "../../../src/market-state/service.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import type { SqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database.js";
import { createSqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database-node.js";

describe("SqlJsStateDatabase", () => {
  it("runs the production schema and representative state services", async () => {
    const database = await createSqlJsStateDatabase();
    try {
      const version = database.prepare("SELECT version FROM schema_version LIMIT 1").get() as {
        version: number;
      };
      expect(version.version).toBeGreaterThan(0);

      const storage = new MemoryStorage(database);
      storage.upsertPreference({
        key: "risk_tolerance",
        valueJson: JSON.stringify("moderate"),
        confidence: "high",
        source: "explicit",
      });
      expect(storage.getPreference("global", "risk_tolerance")?.value_json).toBe('"moderate"');

      const marketState = new MarketStateService(database);
      marketState.addWatchlistItem({
        instrument: {
          symbol: "ASTS",
          assetType: "equity",
          name: "AST SpaceMobile, Inc.",
          exchange: "NMS",
          currency: "USD",
          provider: "test",
        },
      });
      marketState.addPortfolioLot({
        instrument: {
          symbol: "RKLB",
          assetType: "equity",
          name: "Rocket Lab USA, Inc.",
          exchange: "NMS",
          currency: "USD",
          provider: "test",
        },
        quantity: 20,
        avgCost: 18.5,
        currency: "USD",
      });

      expect(marketState.listWatchlistItems()).toHaveLength(1);
      expect(marketState.listPortfolioLots()).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("exports bytes that reopen with state and transaction semantics intact", async () => {
    const first = await createSqlJsStateDatabase();
    first.exec("CREATE TABLE conformance (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    first.prepare("INSERT INTO conformance (value) VALUES (?)").run("persisted");
    const bytes = first.exportBytes();
    first.close();

    const restored = await createSqlJsStateDatabase(bytes);
    try {
      expect(restored.prepare("SELECT value FROM conformance LIMIT 1").get()).toEqual({
        value: "persisted",
      });

      const fail = restored.transaction(() => {
        restored.prepare("INSERT INTO conformance (value) VALUES (?)").run("rolled-back");
        throw new Error("rollback");
      });
      expect(fail).toThrow("rollback");
      expect(restored.prepare("SELECT COUNT(*) AS count FROM conformance").get()).toEqual({
        count: 1,
      });
    } finally {
      restored.close();
    }
  });

  it("keeps foreign-key enforcement enabled after exporting a live database", async () => {
    const database = await createSqlJsStateDatabase();
    try {
      database.exec("CREATE TABLE export_parent (id INTEGER PRIMARY KEY)");
      database.exec(
        "CREATE TABLE export_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES export_parent(id))",
      );

      database.exportBytes();

      expect(() =>
        database.prepare("INSERT INTO export_child (id, parent_id) VALUES (?, ?)").run(1, 999),
      ).toThrow();
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      database.close();
    }
  });

  it("is structurally assignable as the hosted state adapter", async () => {
    const database: SqlJsStateDatabase = await createSqlJsStateDatabase();
    database.close();
  });
});
