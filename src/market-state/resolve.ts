import { getQuote } from "../providers/yahoo-finance.js";
import { wrapProvider } from "../providers/wrap-provider.js";
import type { StockQuote } from "../types/market.js";
import type { InstrumentInput } from "./service.js";

export async function resolveYahooInstrument(symbol: string): Promise<InstrumentInput> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("symbol is required.");
  }

  const result = await wrapProvider("yahoo", () => getQuote(normalized));
  if (result.status === "unavailable") {
    throw new Error(`Could not resolve ${normalized}: ${result.reason}`);
  }

  const quote = result.data;
  if (isZeroFilledQuote(quote)) {
    throw new Error(`Could not resolve ${normalized}: Yahoo returned no valid market data.`);
  }

  return {
    symbol: quote.symbol?.toUpperCase() ?? normalized,
    assetType: inferAssetType(quote.symbol ?? normalized),
    currency: "USD",
    provider: "yahoo",
    providerMetadata: {
      price: quote.price,
      volume: quote.volume,
      week52High: quote.week52High,
      week52Low: quote.week52Low,
      timestamp: quote.timestamp,
    },
  };
}

export function isZeroFilledQuote(quote: StockQuote): boolean {
  return (
    quote.price === 0 &&
    quote.volume === 0 &&
    quote.week52High === 0 &&
    quote.week52Low === 0
  );
}

function inferAssetType(symbol: string): string {
  if (symbol.endsWith("-USD")) return "crypto";
  if (symbol.startsWith("^")) return "index";
  return "equity";
}
