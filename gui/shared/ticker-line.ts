const TICKER_LINE_SPARKLINE_ENDPOINT = "https://ticker-line.com/v1/sparkline";
export const TICKER_LINE_MAX_SVG_BYTES = 512 * 1024;
export const TICKER_LINE_MAX_JSON_BYTES = TICKER_LINE_MAX_SVG_BYTES + 16_384;

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

  const symbolCryptoPair = normalizedSymbol.match(/^([A-Z0-9]{2,10})-([A-Z0-9]{3,10})$/);
  if (symbolCryptoPair) {
    return { ticker: `${symbolCryptoPair[1]}/${symbolCryptoPair[2]}`, market: "crypto" };
  }

  if (normalizedAssetType === "crypto") {
    return { ticker: normalizeCryptoPair(normalizedSymbol), market: "crypto" };
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

export function tickerLineResponseFailure(headers: Headers): string | null {
  const code = headers.get("x-error-code");
  const status = headers.get("x-error-status");
  const message = headers.get("x-error-message") ?? headers.get("x-ticker-line-error");
  if (code || status || message) {
    return `Ticker Line unavailable: ${message ?? code ?? status}`;
  }
  if (headers.get("x-cache")?.toUpperCase() === "STALE") {
    const dataAsOf = headers.get("x-data-as-of");
    return `Ticker Line returned stale market data${dataAsOf ? ` as of ${dataAsOf}` : ""}`;
  }
  return null;
}

export function isTickerLineSvg(value: string): boolean {
  return /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(value.trimStart());
}

export async function readTickerLineTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ status: "ok"; text: string } | { status: "too_large" }> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    return { status: "too_large" };
  }
  if (!response.body) return { status: "ok", text: "" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return { status: "too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { status: "ok", text };
  } finally {
    reader.releaseLock();
  }
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

function normalizeCryptoPair(symbol: string): string {
  const separated = symbol.match(/^([A-Z0-9]{2,10})[\s/_-]([A-Z0-9]{2,10})$/);
  if (separated) return `${separated[1]}/${separated[2]}`;
  return normalizeUsdPair(symbol);
}

function normalizeCommodity(symbol: string): string {
  if (symbol === "NATGAS") return symbol;
  return normalizeUsdPair(symbol);
}
