import { join } from "node:path";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase } from "../../../src/memory/sqlite.js";

export function seedProductEvalMarketState(
  fixture: "e5_two_option_positions",
  openCandleHome: string,
): void {
  if (fixture === "e5_two_option_positions") {
    seedE5TwoOptionPositions(openCandleHome);
    return;
  }
}

function seedE5TwoOptionPositions(openCandleHome: string): void {
  const db = initDatabase(join(openCandleHome, "state.db"));
  try {
    const service = new MarketStateService(db);
    service.addPortfolioLot({
      instrument: {
        symbol: "NVDA260116C00200000",
        name: "NVDA Jan 16 2026 200 Call",
        assetType: "option",
        exchange: "OPRA",
        currency: "USD",
        provider: "fixture",
        aliases: [{ source: "underlying", sourceSymbol: "NVDA", sourceAssetType: "equity" }],
      },
      quantity: 2,
      avgCost: 32.5,
      currency: "USD",
      notes: "E5 ask-vs-guess fixture: NVDA calls",
      source: "eval-fixture",
    });
    service.addPortfolioLot({
      instrument: {
        symbol: "AMD260116C00150000",
        name: "AMD Jan 16 2026 150 Call",
        assetType: "option",
        exchange: "OPRA",
        currency: "USD",
        provider: "fixture",
        aliases: [{ source: "underlying", sourceSymbol: "AMD", sourceAssetType: "equity" }],
      },
      quantity: 3,
      avgCost: 12.1,
      currency: "USD",
      notes: "E5 ask-vs-guess fixture: AMD calls",
      source: "eval-fixture",
    });
  } finally {
    db.close();
  }
}
