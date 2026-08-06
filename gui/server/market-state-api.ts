import type Database from "better-sqlite3";
import { buildFreshnessStamp } from "../../src/infra/freshness.js";
import { isZeroFilledQuote, searchYahooInstruments } from "../../src/market-state/resolve.js";
import { MarketStateService } from "../../src/market-state/service.js";
import { initDefaultDatabase } from "../../src/memory/sqlite.js";
import { getProvider, type ProviderId } from "../../src/onboarding/providers.js";
import { wrapProvider } from "../../src/providers/wrap-provider.js";
import { getQuote, getYahooCompanyOverview } from "../../src/providers/yahoo-finance.js";
import {
  fetchHistoryWithFallback,
  HISTORY_INTERVALS,
  type HISTORY_RANGES,
} from "../../src/tools/market/stock-history.js";
import {
  buildMarketQuoteSnapshot as buildSharedMarketQuoteSnapshot,
  type MarketStateQuoteSnapshot as SharedMarketStateQuoteSnapshot,
} from "../shared/market-quote-snapshot.js";
import { HistorySnapshotStore } from "./history-snapshot-store.js";

type HistoryRange = (typeof HISTORY_RANGES)[number];
type HistoryInterval = (typeof HISTORY_INTERVALS)[number];
type GuiHistoryRange = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";

export interface ResolvedHistoryRange {
  range: HistoryRange;
  interval: HistoryInterval;
}

export interface InvalidHistoryRequest {
  status: "invalid_request";
  reason: string;
}

export interface InstrumentHistoryBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface InstrumentHistorySnapshotOk {
  status: "ok";
  symbol: string;
  range: string;
  interval: HistoryInterval;
  source: InstrumentHistorySource;
  fetchedAt: string;
  dataAsOf?: string;
  stale: boolean;
  prevClose: number | null;
  bars: InstrumentHistoryBar[];
}

export interface InstrumentHistorySnapshotUnavailable {
  status: "unavailable";
  reason: string;
  dataAsOf?: string;
  stale?: boolean;
}

export type InstrumentHistorySnapshot =
  | InstrumentHistorySnapshotOk
  | InstrumentHistorySnapshotUnavailable
  | InvalidHistoryRequest;

const instrumentHistorySnapshotStore = new HistorySnapshotStore<InstrumentHistorySnapshot>();

const DEFAULT_HISTORY_RANGE_MAP: Record<GuiHistoryRange, ResolvedHistoryRange> = {
  "1D": { range: "1d", interval: "5m" },
  "5D": { range: "5d", interval: "15m" },
  "1M": { range: "1mo", interval: "1h" },
  "6M": { range: "6mo", interval: "1d" },
  YTD: { range: "ytd", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
  MAX: { range: "max", interval: "1mo" },
};

const HISTORY_RANGE_SPAN_DAYS: Record<GuiHistoryRange, number> = {
  "1D": 1,
  "5D": 5,
  "1M": 31,
  "6M": 183,
  YTD: 366,
  "1Y": 366,
  "5Y": 1_827,
  MAX: Number.POSITIVE_INFINITY,
};

const INTRADAY_DEPTH_CAP_DAYS: Partial<Record<HistoryInterval, number>> = {
  "1m": 7,
  "5m": 60,
  "15m": 60,
  "1h": 730,
};

const DAILY_OR_LONGER_INTERVALS = new Set<HistoryInterval>(["1d", "1wk", "1mo"]);
type InstrumentHistorySource = "Yahoo Finance" | "Alpha Vantage" | "London Strategic Edge";
const HISTORY_PROVIDER_REGISTRY_IDS = {
  yahoo: "yahoo",
  alphavantage: "alpha_vantage",
  lse: "lse",
} as const satisfies Record<string, ProviderId>;

function historyProviderDisplayName(provider: string | undefined): InstrumentHistorySource | null {
  if (!(provider && provider in HISTORY_PROVIDER_REGISTRY_IDS)) return null;
  const providerId =
    HISTORY_PROVIDER_REGISTRY_IDS[provider as keyof typeof HISTORY_PROVIDER_REGISTRY_IDS];
  return getProvider(providerId).displayName as InstrumentHistorySource;
}

export function resolveHistoryRange(
  rangeLabel: string,
  intervalOverride?: string,
): ResolvedHistoryRange | InvalidHistoryRequest {
  const resolved = DEFAULT_HISTORY_RANGE_MAP[rangeLabel as GuiHistoryRange];
  if (!resolved) {
    return { status: "invalid_request", reason: `Unknown history range: ${rangeLabel}` };
  }
  if (intervalOverride === undefined) return resolved;
  if (!isHistoryInterval(intervalOverride)) {
    return { status: "invalid_request", reason: `Unknown history interval: ${intervalOverride}` };
  }

  const depthCapDays = INTRADAY_DEPTH_CAP_DAYS[intervalOverride];
  if (
    depthCapDays !== undefined &&
    HISTORY_RANGE_SPAN_DAYS[rangeLabel as GuiHistoryRange] > depthCapDays
  ) {
    return {
      status: "invalid_request",
      reason: `History range ${rangeLabel} exceeds the depth cap for interval ${intervalOverride}`,
    };
  }
  return { range: resolved.range, interval: intervalOverride };
}

function isHistoryInterval(value: string): value is HistoryInterval {
  return (HISTORY_INTERVALS as readonly string[]).includes(value);
}

export async function getInstrumentHistorySnapshot(
  symbol: string,
  rangeLabel = "1D",
  intervalOverride?: string,
): Promise<InstrumentHistorySnapshot> {
  const resolved = resolveHistoryRange(rangeLabel, intervalOverride);
  if ("status" in resolved) return resolved;

  const key = `${symbol}|${resolved.range}|${resolved.interval}`;
  return instrumentHistorySnapshotStore.get(key, async () => {
    const result = await fetchHistoryWithFallback(symbol, resolved.range, resolved.interval);
    if (result.status === "unavailable") {
      return { status: "unavailable", reason: result.reason };
    }
    const source = historyProviderDisplayName(result.provider);
    if (source === null) {
      return { status: "unavailable", reason: "History provider attribution is unavailable" };
    }

    const bars = result.data.filter((bar) => Number.isFinite(bar.close));
    const dataAsOf = bars.at(-1)?.date;
    const chartBars: InstrumentHistoryBar[] = [];
    for (const bar of bars) {
      let time = bar.timestamp;
      if (typeof time !== "number" || !Number.isFinite(time)) {
        if (DAILY_OR_LONGER_INTERVALS.has(resolved.interval)) {
          time = Date.parse(`${bar.date}T00:00:00Z`) / 1_000;
        }
        if (typeof time !== "number" || !Number.isFinite(time)) {
          return {
            status: "unavailable",
            reason: `Historical bars for ${resolved.interval} are missing finite timestamps`,
            dataAsOf,
            stale: result.stale === true || undefined,
          };
        }
      }
      chartBars.push({
        time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    }

    // Design D3: daily+ bars can honestly derive the previous close from the prior bar.
    const prevClose =
      DAILY_OR_LONGER_INTERVALS.has(resolved.interval) && bars.length >= 2
        ? bars[bars.length - 2].close
        : null;

    return {
      status: "ok",
      symbol,
      range: rangeLabel,
      interval: resolved.interval,
      source,
      fetchedAt: result.timestamp,
      dataAsOf,
      stale: result.stale === true,
      prevClose,
      bars: chartBars,
    };
  });
}

export function resetInstrumentHistoryMemoForTests(): void {
  instrumentHistorySnapshotStore.clear();
}

export interface MarketStateSnapshot {
  instruments: Array<NonNullable<ReturnType<MarketStateService["getInstrument"]>>>;
  watchlists: ReturnType<MarketStateService["listWatchlists"]>;
  portfolios: ReturnType<MarketStateService["listPortfolios"]>;
  watchlist: ReturnType<MarketStateService["listWatchlistItems"]>;
  portfolio: ReturnType<MarketStateService["listPortfolioLots"]>;
  alerts: ReturnType<MarketStateService["listAlertRules"]>;
  alertEvents: ReturnType<MarketStateService["listAlertEvents"]>;
  alertCheckRuns: ReturnType<MarketStateService["listAlertCheckRuns"]>;
  reportTemplates: ReturnType<MarketStateService["listReportTemplates"]>;
  reportRuns: ReturnType<MarketStateService["listReportRuns"]>;
  runnerLease: ReturnType<MarketStateService["getAutomationRunnerLease"]>;
  notifications: ReturnType<MarketStateService["listNotificationEvents"]>;
  notificationDeliveryAttempts: ReturnType<MarketStateService["listNotificationDeliveryAttempts"]>;
}

export type MarketStateQuoteSnapshot = SharedMarketStateQuoteSnapshot;

interface SavedSymbolsMemoOptions {
  ttlMs?: number;
  now?: () => number;
}

export function createSavedSymbolsMemo(
  load: () => string[],
  options: SavedSymbolsMemoOptions = {},
): () => string[] {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  let cachedAt = 0;
  let cached: string[] | null = null;
  return () => {
    const current = now();
    if (cached && current - cachedAt < ttlMs) return cached;
    cached = load();
    cachedAt = current;
    return cached;
  };
}

export const getSavedMarketStateSymbols = createSavedSymbolsMemo(loadSavedMarketStateSymbols);

export function buildMarketStateSnapshot(db?: Database.Database): MarketStateSnapshot {
  const ownedDb = db ?? initDefaultDatabase();
  const service = new MarketStateService(ownedDb);
  try {
    const alerts = service.listAlertRules();
    const instrumentIds = [
      ...new Set(alerts.map((rule) => rule.instrumentId).filter((id) => id != null)),
    ];
    const watchlists = service.listWatchlists();
    const portfolios = service.listPortfolios();
    return {
      instruments: instrumentIds
        .map((id) => service.getInstrument(id))
        .filter((instrument) => instrument != null),
      watchlists,
      portfolios,
      watchlist: watchlists.flatMap((watchlist) => service.listWatchlistItems(watchlist.id)),
      portfolio: portfolios.flatMap((portfolio) => service.listPortfolioLots(portfolio.id)),
      alerts,
      alertEvents: service.listAlertEvents(),
      alertCheckRuns: service.listAlertCheckRuns(),
      reportTemplates: service.listReportTemplates(),
      reportRuns: service.listReportRuns(),
      runnerLease: service.getAutomationRunnerLease(),
      notifications: service.listNotificationEvents(),
      notificationDeliveryAttempts: service.listNotificationDeliveryAttempts(),
    };
  } finally {
    if (!db) ownedDb.close();
  }
}

function loadSavedMarketStateSymbols(): string[] {
  const db = initDefaultDatabase();
  const service = new MarketStateService(db);
  try {
    const symbols = [
      ...service
        .listWatchlists()
        .flatMap((watchlist) =>
          service.listWatchlistItems(watchlist.id).map((item) => item.symbol),
        ),
      ...service
        .listPortfolios()
        .flatMap((portfolio) => service.listPortfolioLots(portfolio.id).map((lot) => lot.symbol)),
    ];
    return normalizeSymbols(symbols);
  } finally {
    db.close();
  }
}

function normalizeSymbols(symbols: string[]): string[] {
  const normalized: string[] = [];
  for (const symbol of symbols) {
    const next = symbol.trim().toUpperCase();
    if (!next || normalized.includes(next)) continue;
    normalized.push(next);
  }
  return normalized;
}

export async function buildMarketStateQuoteSnapshot(
  db?: Database.Database,
): Promise<MarketStateQuoteSnapshot> {
  const ownedDb = db ?? initDefaultDatabase();
  try {
    return buildSharedMarketQuoteSnapshot(buildMarketStateSnapshot(ownedDb), {
      fetchQuote: fetchQuoteSnapshot,
    });
  } finally {
    if (!db) ownedDb.close();
  }
}

export async function searchInstrumentCandidates(query: string): Promise<{
  query: string;
  candidates: Awaited<ReturnType<typeof searchYahooInstruments>>;
  error?: string;
}> {
  const trimmed = query.trim();
  if (!trimmed) return { query: "", candidates: [] };
  try {
    return {
      query: trimmed,
      candidates: await searchYahooInstruments(trimmed),
    };
  } catch (err) {
    return {
      query: trimmed,
      candidates: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getInstrumentQuoteSnapshot(symbol: string): Promise<
  | {
      symbol: string;
      status: "ok";
      name?: string;
      price: number;
      change: number;
      changePercent: number;
      volume: number;
      high: number;
      low: number;
      week52High: number;
      week52Low: number;
      marketCap: number;
      fetchedAt: string;
      dataAsOf?: string;
      marketState?: "PRE" | "REGULAR" | "POST" | "CLOSED";
      extendedPrice?: number;
      extendedChange?: number;
      extendedChangePercent?: number;
      extendedAsOf?: string;
      stale: boolean;
      currency: string | null;
    }
  | { symbol: string; status: "unavailable"; reason: string }
> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return { symbol: "", status: "unavailable", reason: "symbol is required" };
  const quote = await fetchQuoteSnapshot(normalized);
  if (quote.status === "unavailable") return { symbol: normalized, ...quote };
  return {
    symbol: normalized,
    status: quote.status,
    name: quote.name,
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    volume: quote.volume,
    high: quote.high,
    low: quote.low,
    week52High: quote.week52High,
    week52Low: quote.week52Low,
    marketCap: quote.marketCap,
    fetchedAt: quote.fetchedAt,
    dataAsOf: quote.dataAsOf,
    marketState: quote.marketState,
    extendedPrice: quote.extendedPrice,
    extendedChange: quote.extendedChange,
    extendedChangePercent: quote.extendedChangePercent,
    extendedAsOf: quote.extendedAsOf,
    stale: quote.stale,
    currency: quote.currency,
  };
}

export type InstrumentOverviewSnapshot =
  | {
      symbol: string;
      status: "ok";
      name: string;
      description: string;
      exchange: string;
      sector: string;
      industry: string;
      marketCap: number;
      pe: number | null;
      forwardPe: number | null;
      eps: number | null;
      dividendYield: number | null;
      beta: number | null;
      avgVolume: number;
      profitMargin: number | null;
      revenueGrowth: number | null;
      week52High: number;
      week52Low: number;
      stale: boolean;
    }
  | { symbol: string; status: "unavailable"; reason: string };

interface InstrumentOverviewMemoEntry {
  snapshot: InstrumentOverviewSnapshot | null;
  fetchedAtMs: number;
  inFlight: Promise<InstrumentOverviewSnapshot> | null;
}

const INSTRUMENT_OVERVIEW_TTL_MS = 5 * 60_000;
const instrumentOverviewMemo = new Map<string, InstrumentOverviewMemoEntry>();

export async function getInstrumentOverviewSnapshot(
  symbol: string,
): Promise<InstrumentOverviewSnapshot> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return { symbol: "", status: "unavailable", reason: "symbol is required" };

  const existing = instrumentOverviewMemo.get(normalized);
  if (existing?.snapshot && Date.now() - existing.fetchedAtMs < INSTRUMENT_OVERVIEW_TTL_MS) {
    return existing.snapshot;
  }
  if (existing?.snapshot) {
    if (!existing.inFlight) refreshInstrumentOverview(normalized, existing).catch(() => {});
    return existing.snapshot.status === "ok"
      ? { ...existing.snapshot, stale: true }
      : existing.snapshot;
  }
  if (existing?.inFlight) return existing.inFlight;

  const entry = existing ?? { snapshot: null, fetchedAtMs: 0, inFlight: null };
  return refreshInstrumentOverview(normalized, entry);
}

function refreshInstrumentOverview(
  normalized: string,
  entry: InstrumentOverviewMemoEntry,
): Promise<InstrumentOverviewSnapshot> {
  if (entry.inFlight) return entry.inFlight;
  const inFlight = loadInstrumentOverviewSnapshot(normalized)
    .then((snapshot) => {
      if (entry.snapshot?.status === "ok" && snapshot.status === "unavailable") {
        return entry.snapshot;
      }
      entry.snapshot = snapshot;
      entry.fetchedAtMs = Date.now();
      return snapshot;
    })
    .finally(() => {
      if (entry.inFlight === inFlight) entry.inFlight = null;
    });
  entry.inFlight = inFlight;
  instrumentOverviewMemo.set(normalized, entry);
  return inFlight;
}

async function loadInstrumentOverviewSnapshot(
  normalized: string,
): Promise<InstrumentOverviewSnapshot> {
  const result = await wrapProvider("yahoo", () => getYahooCompanyOverview(normalized));
  if (result.status === "unavailable") {
    return { symbol: normalized, status: "unavailable", reason: result.reason };
  }
  return {
    symbol: normalized,
    status: "ok",
    name: result.data.name,
    description: result.data.description,
    exchange: result.data.exchange,
    sector: result.data.sector,
    industry: result.data.industry,
    marketCap: result.data.marketCap,
    pe: result.data.pe,
    forwardPe: result.data.forwardPe,
    eps: result.data.eps,
    dividendYield: result.data.dividendYield,
    beta: result.data.beta,
    avgVolume: result.data.avgVolume,
    profitMargin: result.data.profitMargin,
    revenueGrowth: result.data.revenueGrowth,
    week52High: result.data.week52High,
    week52Low: result.data.week52Low,
    stale: result.stale === true,
  };
}

export function resetInstrumentOverviewMemoForTests(): void {
  instrumentOverviewMemo.clear();
}

export async function fetchQuoteSnapshot(symbol: string): Promise<
  | {
      status: "ok";
      name?: string;
      price: number;
      change: number;
      changePercent: number;
      volume: number;
      high: number;
      low: number;
      week52High: number;
      week52Low: number;
      marketCap: number;
      fetchedAt: string;
      dataAsOf?: string;
      marketState?: "PRE" | "REGULAR" | "POST" | "CLOSED";
      extendedPrice?: number;
      extendedChange?: number;
      extendedChangePercent?: number;
      extendedAsOf?: string;
      stale: boolean;
      currency: string | null;
    }
  | { status: "unavailable"; reason: string }
> {
  const result = await wrapProvider("yahoo", () => getQuote(symbol));
  if (result.status === "unavailable") return { status: "unavailable", reason: result.reason };
  if (result.stale) return { status: "unavailable", reason: "provider returned stale market data" };
  if (isZeroFilledQuote(result.data)) {
    return { status: "unavailable", reason: "Yahoo returned no valid market data." };
  }
  const freshness = buildFreshnessStamp({
    asOf: result.data.asOf,
    cached: result.cached,
    stale: result.stale,
    cachedAt: result.timestamp,
  });
  if (freshness.isStaleForSession) {
    return { status: "unavailable", reason: "provider returned stale market data" };
  }
  return {
    status: "ok",
    name: result.data.name,
    price: result.data.price,
    change: result.data.change,
    changePercent: result.data.changePercent,
    volume: result.data.volume,
    high: result.data.high,
    low: result.data.low,
    week52High: result.data.week52High,
    week52Low: result.data.week52Low,
    marketCap: result.data.marketCap,
    fetchedAt: result.timestamp,
    dataAsOf: freshness.providerDataAt,
    marketState: result.data.marketState,
    extendedPrice: result.data.extendedPrice,
    extendedChange: result.data.extendedChange,
    extendedChangePercent: result.data.extendedChangePercent,
    extendedAsOf: result.data.extendedAsOf,
    stale: Boolean(result.stale),
    currency: result.data.currency ?? null,
  };
}
