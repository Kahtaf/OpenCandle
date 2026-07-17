import {
  fetchQuoteSnapshot,
  fetchSparklineSnapshot,
  type MarketSparklineSnapshot,
} from "./market-state-api.js";

export const MARKET_INDEX_SYMBOLS = ["^GSPC", "^IXIC", "^DJI", "BTC-USD"] as const;

export interface MarketIndexSnapshotEntry {
  symbol: (typeof MARKET_INDEX_SYMBOLS)[number];
  name?: string;
  status: "ok" | "unavailable";
  reason?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  currency?: string | null;
  marketState?: "PRE" | "REGULAR" | "POST" | "CLOSED";
  dataAsOf?: string;
  stale?: boolean;
  sparkline?: MarketSparklineSnapshot;
}

export interface MarketIndicesSnapshot {
  generatedAt: string;
  indices: MarketIndexSnapshotEntry[];
}

export async function buildMarketIndicesSnapshot(): Promise<MarketIndicesSnapshot> {
  const indices: MarketIndexSnapshotEntry[] = [];
  for (const symbol of MARKET_INDEX_SYMBOLS) {
    const quote = await fetchQuoteSnapshot(symbol);
    if (quote.status === "unavailable") {
      indices.push({ symbol, status: "unavailable", reason: quote.reason });
      continue;
    }
    indices.push({
      symbol,
      name: quote.name,
      status: "ok",
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      currency: quote.currency,
      marketState: quote.marketState,
      dataAsOf: quote.dataAsOf,
      stale: quote.stale,
      sparkline: await fetchSparklineSnapshot(symbol),
    });
  }
  return { generatedAt: new Date().toISOString(), indices };
}
