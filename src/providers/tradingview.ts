import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { httpPost } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";

const BASE_URL = "https://scanner.tradingview.com";
const DATA_CAVEAT =
  "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const QUOTE_COLUMNS = [
  "name",
  "close",
  "change",
  "change_abs",
  "volume",
  "exchange",
  "market",
  "description",
  "type",
  "typespecs",
] as const;

export const DEFAULT_COLUMNS = [
  "name",
  "close",
  "change",
  "volume",
  "market_cap_basic",
  "price_earnings_ttm",
] as const;

export type ScreenFilterOp =
  | "greater"
  | "egreater"
  | "less"
  | "eless"
  | "equal"
  | "nequal"
  | "in_range"
  | "not_in_range"
  | "crosses"
  | "crosses_above"
  | "crosses_below"
  | "above%"
  | "below%"
  | "match"
  | "nmatch"
  | "has"
  | "has_none_of"
  | "empty"
  | "nempty";

export interface ScreenFilterClause {
  field: string;
  op: ScreenFilterOp;
  value?: unknown;
}

export interface ScreenSort {
  field: string;
  direction?: "asc" | "desc";
}

export interface ScreenStocksOpts {
  market?: string;
  columns?: string[];
  filter?: ScreenFilterClause[];
  sort?: ScreenSort;
  limit?: number;
}

export interface ScreenerRow {
  tvSymbol: string;
  symbol: string;
  values: Record<string, unknown | null>;
  sourceProvider: "tradingview";
  dataCaveat: string;
}

export interface TradingViewQuote {
  requestedSymbol: string;
  tvSymbol: string;
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  exchange?: string;
  market?: string;
  name?: string;
  type?: string;
  typespecs?: unknown;
  sourceProvider: "tradingview";
  dataCaveat: string;
}

interface TradingViewResponse {
  fields?: string[];
  symbols?: Array<{
    s: string;
    f: unknown[];
  }>;
}

interface ScannerBody {
  markets?: string[];
  symbols?: { tickers?: string[]; query?: { types: string[] } };
  columns: readonly string[];
  filter?: Array<{ left: string; operation: string; right?: unknown }>;
  sort?: { sortBy: string; sortOrder: "asc" | "desc" };
  range: [number, number];
  options: { lang: "en" };
}

interface DecodedRow {
  tvSymbol: string;
  symbol: string;
  values: Record<string, unknown | null>;
}

export function buildTvSymbol(exchange: string, ticker: string): string {
  const trimmedTicker = ticker.trim().toUpperCase();
  if (trimmedTicker.includes(":")) return trimmedTicker;
  const trimmedExchange = exchange.trim().toUpperCase();
  return trimmedExchange ? `${trimmedExchange}:${trimmedTicker}` : trimmedTicker;
}

export async function screenStocks(opts: ScreenStocksOpts = {}): Promise<ScreenerRow[]> {
  const market = opts.market?.trim().toLowerCase() || "america";
  const columns = opts.columns?.length ? opts.columns : [...DEFAULT_COLUMNS];
  const body = buildScannerBody({
    market,
    columns,
    filter: opts.filter,
    sort: opts.sort,
    limit: opts.limit,
  });
  const rows = decodeScannerRows(await scannerFetch(market, body), columns);
  return rows.map((row) => ({
    ...row,
    sourceProvider: "tradingview" as const,
    dataCaveat: DATA_CAVEAT,
  }));
}

export async function getQuotes(symbols: string[]): Promise<TradingViewQuote[]> {
  const requested = symbols.map(normalizeRequestedSymbol).filter(Boolean);
  const qualified = requested.filter(isTradingViewQualified);
  const bare = requested.filter(
    (symbol) => !isTradingViewQualified(symbol) && !shouldSkipTradingView(symbol),
  );

  const resolved = new Map<string, TradingViewQuote>();

  if (qualified.length > 0) {
    const body = buildQualifiedQuoteBody(qualified);
    const rows = decodeScannerRows(await scannerFetch("global", body), [...QUOTE_COLUMNS]);
    const byTvSymbol = new Map(rows.map((row) => [row.tvSymbol.toUpperCase(), row]));
    for (const symbol of qualified) {
      const row = byTvSymbol.get(symbol);
      const quote = row ? rowToQuote(symbol, row) : undefined;
      if (quote) resolved.set(symbol, quote);
    }
  }

  if (bare.length > 0) {
    const body = buildBareQuoteBody(bare);
    const rows = decodeScannerRows(await scannerFetch("america", body), [...QUOTE_COLUMNS]);
    const byName = groupRowsByName(rows);
    for (const symbol of bare) {
      const row = pickPrimaryListing(byName.get(symbol) ?? []);
      const quote = row ? rowToQuote(symbol, row) : undefined;
      if (quote) resolved.set(symbol, quote);
    }
  }

  return requested.flatMap((symbol) => {
    const quote = resolved.get(symbol);
    return quote ? [quote] : [];
  });
}

function buildScannerBody(
  opts: Required<Pick<ScreenStocksOpts, "market" | "columns">> &
    Pick<ScreenStocksOpts, "filter" | "sort" | "limit">,
): ScannerBody {
  const limit = clampLimit(opts.limit);
  return {
    markets: [opts.market],
    columns: opts.columns,
    ...(opts.filter?.length && { filter: opts.filter.map(mapFilterClause) }),
    ...(opts.sort && {
      sort: {
        sortBy: opts.sort.field,
        sortOrder: opts.sort.direction ?? "desc",
      },
    }),
    range: [0, limit],
    options: { lang: "en" },
  };
}

function buildQualifiedQuoteBody(tickers: string[]): ScannerBody {
  return {
    symbols: { tickers },
    columns: QUOTE_COLUMNS,
    range: [0, clampLimit(tickers.length)],
    options: { lang: "en" },
  };
}

function buildBareQuoteBody(symbols: string[]): ScannerBody {
  return {
    markets: ["america"],
    symbols: { query: { types: [] } },
    columns: QUOTE_COLUMNS,
    filter: [
      { left: "name", operation: "in_range", right: symbols },
      { left: "is_primary", operation: "equal", right: true },
      { left: "type", operation: "in_range", right: ["stock", "fund", "dr"] },
    ],
    range: [0, 500],
    options: { lang: "en" },
  };
}

function mapFilterClause(clause: ScreenFilterClause): {
  left: string;
  operation: string;
  right?: unknown;
} {
  return {
    left: clause.field,
    operation: clause.op,
    ...(clause.value !== undefined && { right: clause.value }),
  };
}

async function scannerFetch(market: string, body: ScannerBody): Promise<TradingViewResponse> {
  const endpoint = `${BASE_URL}/${market}/scan2?label-product=screener-stock`;
  const cacheKey = `tradingview:scan2:${market}:${stableStringify(body)}`;
  const cached = cache.get<TradingViewResponse>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("tradingview");
    const response = await httpPost<TradingViewResponse>(endpoint, body, {
      headers: {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        "User-Agent": BROWSER_UA,
      },
    });
    cache.set(cacheKey, response, TTL.SCREENER);
    return response;
  } catch (error) {
    const stale = cache.getStale<TradingViewResponse>(cacheKey, STALE_LIMIT.SCREENER);
    if (stale) return stale.value;
    throw error;
  }
}

function decodeScannerRows(
  response: TradingViewResponse,
  requestedColumns: readonly string[],
): DecodedRow[] {
  const fields = response.fields ?? [];
  return (response.symbols ?? []).map((row) => {
    const values: Record<string, unknown | null> = {};
    for (const column of requestedColumns) {
      const index = fields.indexOf(column);
      values[column] = index >= 0 ? (row.f[index] ?? null) : null;
    }
    return {
      tvSymbol: row.s,
      symbol: stringValue(values.name) ?? symbolFromTvSymbol(row.s),
      values,
    };
  });
}

function rowToQuote(requestedSymbol: string, row: DecodedRow): TradingViewQuote | undefined {
  const price = numberValue(row.values.close);
  if (price === undefined) return undefined;
  const changePercent = numberValue(row.values.change) ?? 0;
  const changeAbs = numberValue(row.values.change_abs) ?? 0;
  return {
    requestedSymbol,
    tvSymbol: row.tvSymbol,
    symbol: row.symbol,
    price,
    change: changeAbs,
    changePercent,
    volume: numberValue(row.values.volume) ?? 0,
    exchange: stringValue(row.values.exchange),
    market: stringValue(row.values.market),
    name: stringValue(row.values.description),
    type: stringValue(row.values.type),
    typespecs: row.values.typespecs ?? undefined,
    sourceProvider: "tradingview",
    dataCaveat: DATA_CAVEAT,
  };
}

function groupRowsByName(rows: DecodedRow[]): Map<string, DecodedRow[]> {
  const grouped = new Map<string, DecodedRow[]>();
  for (const row of rows) {
    const name = row.symbol.toUpperCase();
    grouped.set(name, [...(grouped.get(name) ?? []), row]);
  }
  return grouped;
}

function pickPrimaryListing(rows: DecodedRow[]): DecodedRow | undefined {
  if (rows.length === 0) return undefined;
  return [...rows].sort(compareListings)[0];
}

function compareListings(a: DecodedRow, b: DecodedRow): number {
  return (
    scoreMarket(a) - scoreMarket(b) ||
    scoreType(a) - scoreType(b) ||
    scoreExchange(a) - scoreExchange(b) ||
    a.tvSymbol.localeCompare(b.tvSymbol)
  );
}

function scoreMarket(row: DecodedRow): number {
  return stringValue(row.values.market)?.toLowerCase() === "america" ? 0 : 1;
}

function scoreType(row: DecodedRow): number {
  const type = stringValue(row.values.type)?.toLowerCase();
  if (type === "stock") return 0;
  if (type === "fund") return 1;
  if (type === "dr") return 2;
  return 3;
}

function scoreExchange(row: DecodedRow): number {
  const exchange = stringValue(row.values.exchange)?.toUpperCase();
  if (exchange === "NASDAQ") return 0;
  if (exchange === "NYSE") return 1;
  if (exchange === "AMEX") return 2;
  return 3;
}

function clampLimit(limit: number | undefined): number {
  if (limit == null) return 50;
  if (limit < 1) return 50;
  return Math.min(Math.floor(limit), 500);
}

function normalizeRequestedSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function isTradingViewQualified(symbol: string): boolean {
  return /^[A-Z0-9_]+:[A-Z0-9._-]+$/.test(symbol);
}

export function shouldSkipTradingView(symbol: string): boolean {
  return /(?:-USD|\.(?:TO|DE|T|L|HK))$/i.test(symbol);
}

export function canUseTradingViewQuote(symbol: string): boolean {
  const normalized = normalizeRequestedSymbol(symbol);
  return (
    normalized.length > 0 &&
    (isTradingViewQualified(normalized) || !shouldSkipTradingView(normalized))
  );
}

function symbolFromTvSymbol(tvSymbol: string): string {
  return tvSymbol.includes(":") ? (tvSymbol.split(":").at(-1) ?? tvSymbol) : tvSymbol;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortObjectKeys(nested)]),
  );
}
