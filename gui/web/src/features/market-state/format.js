const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUOTE_STALE_MS = 15 * 60_000;
const humanDateTimeFormatters = new Map();

export function relativeTime(iso, nowMs = Date.now()) {
  const ts = Date.parse(iso ?? "");
  if (!Number.isFinite(ts)) return "";
  const deltaMs = nowMs - ts;
  if (deltaMs < 60_000) return "just now";
  if (deltaMs < 60 * 60_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.floor(deltaMs / (60 * 60_000))}h ago`;
  const date = new Date(ts);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export function shortDateLabel(iso, nowMs = Date.now()) {
  const ts = Date.parse(iso ?? "");
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  const label = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  return date.getUTCFullYear() === new Date(nowMs).getUTCFullYear()
    ? label
    : `${label}, ${date.getUTCFullYear()}`;
}

export function formatHumanDateTime(iso, timeZone) {
  const ts = Date.parse(iso ?? "");
  if (!Number.isFinite(ts)) return "";
  const key = timeZone || "local";
  let formatter = humanDateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      ...(timeZone ? { timeZone } : {}),
    });
    humanDateTimeFormatters.set(key, formatter);
  }
  return formatter.format(new Date(ts));
}

export function quoteFreshnessTitle(quotes = [], timeZone) {
  let fetchedAt;
  let oldestTimestamp = Number.POSITIVE_INFINITY;
  for (const quote of quotes) {
    const timestamp = Date.parse(quote?.fetchedAt ?? "");
    if (!Number.isFinite(timestamp) || timestamp >= oldestTimestamp) continue;
    fetchedAt = quote.fetchedAt;
    oldestTimestamp = timestamp;
  }
  const formatted = formatHumanDateTime(fetchedAt, timeZone);
  return formatted ? `Fetched ${formatted}` : undefined;
}

export function degradedQuoteBadge(quotes = [], nowMs = Date.now()) {
  const retainedUnavailable = quotes.filter((quote) => quote?.refreshStatus === "unavailable");
  if (retainedUnavailable.length > 0) {
    const fetchedAtMs = parsedQuoteTimes(retainedUnavailable, "fetchedAt");
    if (fetchedAtMs.length === 0) return "Quotes unavailable · last update time unknown";
    const oldestMs = Math.min(...fetchedAtMs);
    return `Quotes unavailable · last updated ${relativeTime(new Date(oldestMs).toISOString(), nowMs)}`;
  }
  if (quotes.some((quote) => quote?.status === "unavailable")) return "Quotes unavailable";

  const fetchedAtMs = parsedQuoteTimes(quotes, "fetchedAt");
  if (fetchedAtMs.length > 0) {
    const ageMs = nowMs - Math.min(...fetchedAtMs);
    if (ageMs > QUOTE_STALE_MS) return `Quotes ${Math.floor(ageMs / 60_000)}m old`;
  }

  if (quotes.some((quote) => hasExtendedQuote(quote))) return null;
  const dataAsOfMs = parsedQuoteTimes(quotes, "dataAsOf");
  if (dataAsOfMs.length === 0) return null;

  const oldestMs = Math.min(...dataAsOfMs);
  if (!isPriorCalendarDay(oldestMs, nowMs)) return null;
  const dataAsOf = new Date(oldestMs);
  return `As of ${MONTHS[dataAsOf.getUTCMonth()]} ${dataAsOf.getUTCDate()}`;
}

function parsedQuoteTimes(quotes, key) {
  const timestamps = [];
  for (const quote of quotes) {
    const timestamp = Date.parse(quote?.[key] ?? "");
    if (Number.isFinite(timestamp)) timestamps.push(timestamp);
  }
  return timestamps;
}

function hasExtendedQuote(quote) {
  return typeof quote?.extendedPrice === "number" && Number.isFinite(quote.extendedPrice);
}

function isPriorCalendarDay(timestampMs, nowMs) {
  const timestamp = new Date(timestampMs);
  const now = new Date(nowMs);
  return (
    timestamp.getUTCFullYear() !== now.getUTCFullYear() ||
    timestamp.getUTCMonth() !== now.getUTCMonth() ||
    timestamp.getUTCDate() !== now.getUTCDate()
  );
}

export function quoteChangeDirections(previousQuotes = new Map(), nextQuotes = new Map()) {
  const directions = new Map();
  if (!(previousQuotes instanceof Map) || !(nextQuotes instanceof Map)) return directions;
  for (const [symbol, nextQuote] of nextQuotes) {
    const previousQuote = previousQuotes.get(symbol);
    const previousPrice = quotePrice(previousQuote);
    const nextPrice = quotePrice(nextQuote);
    if (
      !Number.isFinite(previousPrice) ||
      !Number.isFinite(nextPrice) ||
      previousPrice === nextPrice
    ) {
      continue;
    }
    directions.set(symbol, nextPrice > previousPrice ? "up" : "down");
  }
  return directions;
}

function quotePrice(quote) {
  const value = quote?.price ?? quote?.currentPrice;
  return typeof value === "number" ? value : Number.NaN;
}
