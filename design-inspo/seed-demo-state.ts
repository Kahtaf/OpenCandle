// Throwaway: seeds realistic market-state data for UX review. Run: npx tsx design-inspo/seed-demo-state.ts
import { initDefaultDatabase } from "../src/memory/sqlite.js";
import { MarketStateService } from "../src/market-state/service.js";
import {
  ALERT_CONDITION_VERSION,
  priceCrossesAbove,
  priceCrossesBelow,
  rsiThreshold,
  percentMove,
} from "../src/market-state/alert-conditions.js";

const db = initDefaultDatabase();
const svc = new MarketStateService(db);

const inst = (symbol: string, name: string, assetType = "equity") => ({
  symbol,
  name,
  assetType,
  exchange: "NASDAQ",
  currency: "USD",
  provider: "yahoo",
});

// Watchlist
svc.addWatchlistItem({
  instrument: inst("NVDA", "NVIDIA Corporation"),
  targetPrice: 220,
  stopPrice: 150,
  thesis: "AI capex supercycle; datacenter demand outpacing supply",
  tags: ["ai", "semis"],
});
svc.addWatchlistItem({
  instrument: inst("AAPL", "Apple Inc."),
  targetPrice: 260,
  thesis: "Services margin expansion, on-device AI refresh cycle",
  tags: ["megacap"],
});
svc.addWatchlistItem({
  instrument: inst("ASTS", "AST SpaceMobile Inc."),
  targetPrice: 95,
  stopPrice: 38,
  thesis: "Direct-to-device satellite; FirstNet + Verizon deals",
  notes: "High beta, watch dilution risk",
  tags: ["space", "speculative"],
});
svc.addWatchlistItem({
  instrument: inst("MSFT", "Microsoft Corporation"),
  thesis: "Azure AI monetization",
  tags: ["megacap", "ai"],
});
svc.addWatchlistItem({
  instrument: inst("SPY", "SPDR S&P 500 ETF Trust", "etf"),
  notes: "Benchmark",
  tags: ["benchmark"],
});

// Portfolio lots (mixed winners/losers, multiple lots same symbol)
svc.addPortfolioLot({ instrument: inst("AAPL", "Apple Inc."), quantity: 50, avgCost: 168.4, currency: "USD", openedAt: "2024-11-12T14:30:00Z" });
svc.addPortfolioLot({ instrument: inst("AAPL", "Apple Inc."), quantity: 25, avgCost: 231.1, currency: "USD", openedAt: "2025-09-03T14:30:00Z" });
svc.addPortfolioLot({ instrument: inst("NVDA", "NVIDIA Corporation"), quantity: 80, avgCost: 117.8, currency: "USD", openedAt: "2025-02-20T14:30:00Z" });
svc.addPortfolioLot({ instrument: inst("TSLA", "Tesla Inc."), quantity: 30, avgCost: 342.5, currency: "USD", openedAt: "2025-12-15T14:30:00Z", notes: "Swing position" });
svc.addPortfolioLot({ instrument: inst("SPY", "SPDR S&P 500 ETF Trust", "etf"), quantity: 60, avgCost: 512.3, currency: "USD", openedAt: "2024-06-10T14:30:00Z" });
svc.addPortfolioLot({ instrument: inst("ASTS", "AST SpaceMobile Inc."), quantity: 200, avgCost: 51.2, currency: "USD", openedAt: "2026-01-08T14:30:00Z" });

// Predictions
svc.recordPrediction({ instrument: inst("NVDA", "NVIDIA Corporation"), direction: "bullish", conviction: 8, entryPrice: 178.2, targetPrice: 220, timeframeDays: 90 });
svc.recordPrediction({ instrument: inst("TSLA", "Tesla Inc."), direction: "bearish", conviction: 6, entryPrice: 410.0, targetPrice: 340, timeframeDays: 45 });
svc.recordPrediction({ instrument: inst("ASTS", "AST SpaceMobile Inc."), direction: "bullish", conviction: 7, entryPrice: 49.5, targetPrice: 80, timeframeDays: 180 });

// Alerts
const nvda = svc.upsertInstrumentRecord(inst("NVDA", "NVIDIA Corporation"));
const asts = svc.upsertInstrumentRecord(inst("ASTS", "AST SpaceMobile Inc."));
const tsla = svc.upsertInstrumentRecord(inst("TSLA", "Tesla Inc."));
svc.createAlertRule({
  scopeType: "instrument", instrumentId: nvda.id,
  conditionType: "price_crosses_above", conditionVersion: ALERT_CONDITION_VERSION,
  condition: priceCrossesAbove(220), timeframe: "quote",
});
svc.createAlertRule({
  scopeType: "instrument", instrumentId: asts.id,
  conditionType: "price_crosses_below", conditionVersion: ALERT_CONDITION_VERSION,
  condition: priceCrossesBelow(40), timeframe: "quote",
});
svc.createAlertRule({
  scopeType: "instrument", instrumentId: tsla.id,
  conditionType: "rsi_threshold", conditionVersion: ALERT_CONDITION_VERSION,
  condition: rsiThreshold(14, 70, "above"), timeframe: "1d",
});
svc.createAlertRule({
  scopeType: "instrument", instrumentId: nvda.id,
  conditionType: "percent_move", conditionVersion: ALERT_CONDITION_VERSION,
  condition: percentMove("down", 5), timeframe: "1d", enabled: false,
});

console.log("Seeded:", {
  watchlist: svc.getDefaultWatchlist().id,
  alerts: svc.listAlertRules().length,
});
db.close();
