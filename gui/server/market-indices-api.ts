import { fetchQuoteSnapshot } from "./market-state-api.js";

export const MARKET_INDEX_SYMBOLS = ["^GSPC", "^NDX", "^DJI", "BTC-USD"] as const;

const MARKET_INDEX_ASSET_TYPES = {
  "^GSPC": "index",
  "^NDX": "index",
  "^DJI": "index",
  "BTC-USD": "crypto",
} as const;

export interface MarketIndexSnapshotEntry {
  symbol: (typeof MARKET_INDEX_SYMBOLS)[number];
  assetType: "index" | "crypto";
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
}

export interface MarketIndicesSnapshot {
  generatedAt: string;
  indices: MarketIndexSnapshotEntry[];
}

export async function buildMarketIndicesSnapshot(): Promise<MarketIndicesSnapshot> {
  const indices: MarketIndexSnapshotEntry[] = [];
  for (const symbol of MARKET_INDEX_SYMBOLS) {
    const quote = await fetchQuoteSnapshot(symbol);
    const assetType = MARKET_INDEX_ASSET_TYPES[symbol];
    if (quote.status === "unavailable") {
      indices.push({ symbol, assetType, status: "unavailable", reason: quote.reason });
      continue;
    }
    indices.push({
      symbol,
      assetType,
      name: quote.name,
      status: "ok",
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      currency: quote.currency,
      marketState: quote.marketState,
      dataAsOf: quote.dataAsOf,
      stale: quote.stale,
    });
  }
  return { generatedAt: new Date().toISOString(), indices };
}
