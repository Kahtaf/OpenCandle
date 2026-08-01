import { expect, it } from "vitest";
import { MarketStateService } from "../../../src/market-state/service.js";
import { CURRENT_SCHEMA_VERSION, initializeStateDatabase } from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import type { StateDatabase } from "../../../src/runtime/state-database.js";

export function runStateDatabaseConformance(
  createDatabase: () => StateDatabase | Promise<StateDatabase>,
): void {
  it("initializes the current production schema idempotently", async () => {
    const database = await createDatabase();
    try {
      initializeStateDatabase(database);
      initializeStateDatabase(database);
      expect(database.prepare("SELECT version FROM schema_version LIMIT 1").get()).toEqual({
        version: CURRENT_SCHEMA_VERSION,
      });
      expect(
        (database.pragma("table_info(watchlist_items)") as Array<{ name: string }>).map(
          ({ name }) => name,
        ),
      ).toContain("instrument_id");
    } finally {
      database.close();
    }
  });

  it("preserves transactions and production uniqueness constraints", async () => {
    const database = await createDatabase();
    try {
      const rolledBack = database.transaction(() => {
        database.prepare("CREATE TABLE conformance_tx (value TEXT NOT NULL UNIQUE)").run();
        database.prepare("INSERT INTO conformance_tx (value) VALUES (?)").run("temporary");
        throw new Error("rollback requested");
      });
      expect(rolledBack).toThrow("rollback requested");
      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get("conformance_tx"),
      ).toBeUndefined();

      const now = new Date().toISOString();
      const insert = database.prepare(
        `INSERT INTO user_preferences (
          namespace, key, value_json, confidence, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run("global", "risk_tolerance", '"moderate"', "high", "explicit", now, now);
      expect(() =>
        insert.run("global", "risk_tolerance", '"high"', "high", "explicit", now, now),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("supports named-object bind parameters", async () => {
    const database = await createDatabase();
    try {
      expect(
        database
          .prepare<{ id: number }, { value: string }>("SELECT 'named' AS value WHERE 1 = $id")
          .get({ id: 1 }),
      ).toEqual({ value: "named" });
    } finally {
      database.close();
    }
  });

  it("enforces production foreign-key cascades", async () => {
    const database = await createDatabase();
    try {
      const marketState = new MarketStateService(database);
      marketState.getDefaultWatchlist();
      const secondary = marketState.createWatchlist("Temporary");
      marketState.addWatchlistItem({
        watchlistId: secondary.id,
        instrument: {
          symbol: "MSFT",
          assetType: "equity",
          provider: "conformance",
        },
      });

      marketState.deleteWatchlist("Temporary");

      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM watchlist_items WHERE watchlist_id = ?")
          .get(secondary.id),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("supports representative memory, watchlist, and portfolio services", async () => {
    const database = await createDatabase();
    try {
      const memory = new MemoryStorage(database);
      memory.upsertPreference({
        key: "time_horizon",
        valueJson: '"long"',
        confidence: "high",
        source: "explicit",
      });
      expect(memory.getPreference("global", "time_horizon")?.value_json).toBe('"long"');

      const marketState = new MarketStateService(database);
      marketState.addWatchlistItem({
        instrument: {
          symbol: "ASTS",
          assetType: "equity",
          name: "AST SpaceMobile, Inc.",
          exchange: "NMS",
          currency: "USD",
          provider: "conformance",
        },
      });
      marketState.addPortfolioLot({
        instrument: {
          symbol: "RKLB",
          assetType: "equity",
          name: "Rocket Lab USA, Inc.",
          exchange: "NMS",
          currency: "USD",
          provider: "conformance",
        },
        quantity: 10,
        avgCost: 25,
        currency: "USD",
      });
      expect(marketState.listWatchlistItems().map(({ symbol }) => symbol)).toEqual(["ASTS"]);
      expect(marketState.listPortfolioLots().map(({ symbol }) => symbol)).toEqual(["RKLB"]);
    } finally {
      database.close();
    }
  });
}
