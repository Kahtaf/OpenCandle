import {
  classifyMarketStatusAt,
  lastTradingDay,
  localDateTimeParts,
  type MarketSession,
} from "./market-calendar.js";

export interface FreshnessStamp {
  fetchedAt: string;
  providerDataAt?: string;
  providerDataDate?: string;
  cacheStatus: "live" | "cached" | "stale";
  cachedAt?: string;
  marketSession: MarketSession;
  dataDelayMs?: number;
  isStaleForSession: boolean;
}

export function buildFreshnessStamp(input: {
  asOf?: string | number | Date;
  cached?: boolean;
  stale?: boolean;
  cachedAt?: string;
  dataDelayMs?: number;
  now?: Date;
  assetClass?: "equity" | "crypto";
}): FreshnessStamp {
  const now = input.now ?? new Date();
  const parsedAsOf = normalizeAsOf(input.asOf);
  const fetchedAt = now.toISOString();
  const cacheStatus = input.stale ? "stale" : input.cached ? "cached" : "live";
  const marketSession = input.assetClass === "crypto" ? "unknown" : classifyMarketStatusAt(now);
  const cachedAt = input.cachedAt ? normalizeDate(input.cachedAt)?.toISOString() : undefined;
  const providerDataAt = parsedAsOf?.date.toISOString();
  const providerDataDate = parsedAsOf?.dateOnly;
  const isStaleForSession =
    input.assetClass === "crypto"
      ? isCryptoStale(parsedAsOf?.date, cachedAt, now, cacheStatus)
      : isEquityStale(parsedAsOf, cacheStatus, now);

  return {
    fetchedAt,
    providerDataAt,
    providerDataDate,
    cacheStatus,
    cachedAt,
    marketSession,
    dataDelayMs: input.dataDelayMs,
    isStaleForSession,
  };
}

export function formatAsOfLine(stamp: FreshnessStamp): string {
  if (stamp.isStaleForSession && stamp.providerDataAt) {
    const date = stamp.providerDataDate ?? formatEtDate(new Date(stamp.providerDataAt));
    const parenthetical = staleSessionParenthetical(stamp.marketSession);
    const cached = stamp.cachedAt
      ? ` Cached from ${formatEtDateTime(new Date(stamp.cachedAt))} ET.`
      : "";
    return `Last available price as of ${date}${parenthetical}. This is not a live quote.${cached}`;
  }

  if (stamp.cacheStatus === "stale" && stamp.cachedAt) {
    const notLive = stamp.isStaleForSession ? " This is not a live quote." : "";
    return `Using cached data from ${formatEtDateTime(new Date(stamp.cachedAt))} ET (provider unavailable).${notLive}`;
  }

  if (stamp.providerDataAt || stamp.dataDelayMs !== undefined) {
    const reference = stamp.providerDataAt ?? stamp.cachedAt ?? stamp.fetchedAt;
    const asOf = stamp.providerDataDate ?? formatEtDateTime(new Date(reference));
    if (stamp.dataDelayMs !== undefined)
      return `As of ${asOf} ET (~${Math.round(stamp.dataDelayMs / 60_000)}m delayed).`;
    return `As of ${asOf} ET (${marketSessionLabel(stamp.marketSession)}).`;
  }

  return `As of ${formatEtDateTime(new Date(stamp.fetchedAt))} ET (${marketSessionLabel(stamp.marketSession)}).`;
}

function normalizeAsOf(
  asOf: string | number | Date | undefined,
): { date: Date; dateOnly?: string } | undefined {
  if (asOf === undefined) return undefined;
  if (asOf instanceof Date) return Number.isNaN(asOf.getTime()) ? undefined : { date: asOf };
  if (typeof asOf === "number") {
    const milliseconds = asOf < 10_000_000_000 ? asOf * 1000 : asOf;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : { date };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    const date = new Date(`${asOf}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? undefined : { date, dateOnly: asOf };
  }
  const date = new Date(asOf);
  return Number.isNaN(date.getTime()) ? undefined : { date };
}

function normalizeDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isEquityStale(
  parsedAsOf: { date: Date; dateOnly?: string } | undefined,
  cacheStatus: FreshnessStamp["cacheStatus"],
  now: Date,
): boolean {
  if (!parsedAsOf) return cacheStatus === "stale";
  const localNow = localDateTimeParts(now, "America/New_York");
  const providerTradingDate =
    parsedAsOf.dateOnly ?? localDateTimeParts(parsedAsOf.date, "America/New_York").date;
  const marketSession = classifyMarketStatusAt(now);
  const requiredTradingDate =
    marketSession === "open" ||
    marketSession === "after_close" ||
    marketSession === "closed_after_hours"
      ? localNow.date
      : lastTradingDay(localNow.date);
  return providerTradingDate < requiredTradingDate;
}

function isCryptoStale(
  providerDate: Date | undefined,
  cachedAt: string | undefined,
  now: Date,
  cacheStatus: FreshnessStamp["cacheStatus"],
): boolean {
  const reference =
    providerDate ?? (cacheStatus === "stale" && cachedAt ? new Date(cachedAt) : undefined);
  if (!reference) return cacheStatus === "stale";
  return now.getTime() - reference.getTime() > 15 * 60_000;
}

function formatEtDate(date: Date): string {
  return localDateTimeParts(date, "America/New_York").date;
}

function formatEtDateTime(date: Date): string {
  const parts = localDateTimeParts(date, "America/New_York");
  return `${parts.date} ${parts.time}`;
}

function staleSessionParenthetical(marketSession: MarketSession): string {
  if (marketSession === "closed_weekend") return " (market closed — weekend)";
  if (marketSession === "closed_holiday") return " (market closed — holiday)";
  return "";
}

function marketSessionLabel(marketSession: MarketSession): string {
  switch (marketSession) {
    case "open":
      return "market open";
    case "pre_market":
      return "pre-market";
    case "closed_weekend":
      return "market closed — weekend";
    case "closed_holiday":
      return "market closed — holiday";
    case "after_close":
      return "after close";
    case "closed_after_hours":
      return "market closed";
    case "unknown":
      return "market session unknown";
  }
}
