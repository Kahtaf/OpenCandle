import {
  buildMarketIndicesSnapshot as buildSharedMarketIndicesSnapshot,
  type MarketIndicesSnapshot,
} from "../shared/market-quote-snapshot.js";
import { fetchQuoteSnapshot } from "./market-state-api.js";

export {
  MARKET_INDEX_SYMBOLS,
  type MarketIndicesSnapshot,
} from "../shared/market-quote-snapshot.js";
export type MarketIndexSnapshotEntry = MarketIndicesSnapshot["indices"][number];

export async function buildMarketIndicesSnapshot(): Promise<MarketIndicesSnapshot> {
  return buildSharedMarketIndicesSnapshot({
    fetchQuote: fetchQuoteSnapshot,
  });
}
