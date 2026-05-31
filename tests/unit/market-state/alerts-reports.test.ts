import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import {
  ALERT_CONDITION_VERSION,
  priceCrossesAbove,
  priceCrossesSma,
  rsiThreshold,
  volumeSpike,
} from "../../../src/market-state/alert-conditions.js";

describe("market-state alerts and reports", () => {
  let db: Database.Database;
  let service: MarketStateService;

  beforeEach(() => {
    db = initDatabase(":memory:");
    service = new MarketStateService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("stores versioned canonical alert condition JSON", () => {
    const item = service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
    });

    const rule = service.createAlertRule({
      scopeType: "instrument",
      instrumentId: item.instrumentId,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(250),
      timeframe: "quote",
      cooldownSeconds: 3600,
    });

    expect(rule.conditionVersion).toBe(1);
    expect(rule.conditionJson).toEqual({ threshold: 250, field: "last_price" });
    expect(rule.timeframe).toBe("quote");
    expect(service.listAlertRules()).toHaveLength(1);
  });

  it("builds SMA RSI and volume condition shapes", () => {
    expect(priceCrossesSma(50, "above")).toEqual({
      period: 50,
      direction: "above",
      price_field: "close",
    });
    expect(rsiThreshold(14, 30, "below")).toEqual({
      period: 14,
      threshold: 30,
      direction: "below",
    });
    expect(volumeSpike(20, 2)).toEqual({
      lookback_period: 20,
      multiplier: 2,
    });
  });

  it("stores daily report template timezone and local time", () => {
    const template = service.createReportTemplate({
      name: "Morning watchlist",
      reportType: "watchlist_daily",
      cadence: "daily",
      timezone: "America/Toronto",
      localTime: "08:00",
      config: { targets: { default_watchlist: true } },
      enabled: true,
    });

    expect(template.timezone).toBe("America/Toronto");
    expect(template.localTime).toBe("08:00");
    expect(template.configJson).toEqual({ targets: { default_watchlist: true } });
  });
});
