const TICKER_LINE_SPARKLINE_ENDPOINT = "https://ticker-line.dev/api/v1/sparkline";

const INDEX_TICKERS = new Map([
  ["^GSPC", "SPX500/USD"],
  ["^NDX", "NAS100/USD"],
  ["^DJI", "US30/USD"],
]);

const COMMODITY_TICKERS = new Map([
  ["GC=F", "XAU/USD"],
  ["CL=F", "WTIUSD"],
]);

const OCC_OPTION_SYMBOL = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;

export interface TickerLineInstrument {
  ticker: string;
  market: "stock" | "crypto" | "forex" | "index" | "commodity";
}

export function resolveTickerLineInstrument(
  symbol: unknown,
  assetType: unknown,
): TickerLineInstrument | null {
  const normalizedSymbol = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const normalizedAssetType = String(assetType ?? "")
    .trim()
    .toLowerCase();
  if (
    !normalizedSymbol ||
    normalizedAssetType === "option" ||
    OCC_OPTION_SYMBOL.test(normalizedSymbol)
  ) {
    return null;
  }

  const indexTicker = INDEX_TICKERS.get(normalizedSymbol);
  if (indexTicker) return { ticker: indexTicker, market: "index" };

  const commodityTicker = COMMODITY_TICKERS.get(normalizedSymbol);
  if (commodityTicker) return { ticker: commodityTicker, market: "commodity" };

  if (normalizedSymbol.endsWith("=F") || normalizedSymbol.startsWith("^")) return null;

  if (normalizedSymbol.endsWith("=X")) {
    const ticker = normalizeCurrencyPair(normalizedSymbol.slice(0, -2));
    return ticker ? { ticker, market: "forex" } : null;
  }

  if (normalizedSymbol.endsWith("-USD")) {
    return { ticker: `${normalizedSymbol.slice(0, -4)}/USD`, market: "crypto" };
  }

  if (normalizedAssetType === "crypto") {
    return { ticker: normalizeUsdPair(normalizedSymbol), market: "crypto" };
  }
  if (normalizedAssetType === "forex" || normalizedAssetType === "fx") {
    const ticker = normalizeCurrencyPair(normalizedSymbol);
    return ticker ? { ticker, market: "forex" } : null;
  }
  if (normalizedAssetType === "commodity") {
    return { ticker: normalizeCommodity(normalizedSymbol), market: "commodity" };
  }
  if (normalizedAssetType === "index") {
    return normalizedSymbol.includes("/") ? { ticker: normalizedSymbol, market: "index" } : null;
  }
  if (["equity", "etf", "fund", "stock"].includes(normalizedAssetType)) {
    return { ticker: normalizeStockSymbol(normalizedSymbol), market: "stock" };
  }

  return null;
}

export function tickerLineProviderSparklineUrl(symbol: unknown, assetType: unknown): string | null {
  const instrument = resolveTickerLineInstrument(symbol, assetType);
  if (!instrument) return null;

  const params = new URLSearchParams({
    ticker: instrument.ticker,
    market: instrument.market,
    timeframe: "1d",
    theme: "light",
    fill: "true",
  });
  return `${TICKER_LINE_SPARKLINE_ENDPOINT}?${params.toString()}`;
}

export function tickerLineProxySparklineUrl(symbol: unknown, assetType: unknown): string | null {
  if (!resolveTickerLineInstrument(symbol, assetType)) return null;
  const params = new URLSearchParams({
    symbol: String(symbol).trim(),
    assetType: String(assetType).trim(),
  });
  return `/api/market-state/sparkline?${params.toString()}`;
}

function normalizeStockSymbol(symbol: string): string {
  return symbol.replace(/^([A-Z]{1,5})-([A-Z])$/, "$1.$2");
}

function normalizeCurrencyPair(symbol: string): string | null {
  const compact = symbol.replace(/[\s/_-]/g, "");
  if (!/^[A-Z]{6}$/.test(compact)) return null;
  return `${compact.slice(0, 3)}/${compact.slice(3)}`;
}

function normalizeUsdPair(symbol: string): string {
  const compact = symbol.replace(/[\s/_-]/g, "");
  if (/^[A-Z0-9]{2,10}USD$/.test(compact)) {
    return `${compact.slice(0, -3)}/USD`;
  }
  return symbol;
}

function normalizeCommodity(symbol: string): string {
  if (symbol === "NATGAS") return symbol;
  return normalizeUsdPair(symbol);
}
