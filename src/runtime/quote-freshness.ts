import type { EvidenceRecord } from "./evidence.js";

/**
 * Compact, serializable view of an option chain's quote status. It is copied
 * onto captured tool evidence so validators and eval traces can tell whether
 * the quotes an answer relies on were live, without re-reading the full chain.
 */
export interface QuoteStatusSummary {
  marketSession: string;
  bidAskState: string;
  marketSessionSource?: string;
  providerMarketState?: string;
  latestContractTradeAt?: string;
}

export interface NonLiveQuoteEvidence {
  tool: string;
  quoteStatus?: QuoteStatusSummary;
  reason: string;
}

/**
 * Bid/ask states that are not executable now: carried over from the last
 * regular session, or all-zero outside the regular session.
 */
const NON_LIVE_BID_ASK_STATES: ReadonlySet<string> = new Set([
  "last_session_quotes",
  "closed_market_or_stale_quotes",
]);

/** Read a quote status from a tool result, its `details`, or a captured evidence value. */
export function extractQuoteStatusSummary(value: unknown): QuoteStatusSummary | undefined {
  const record = asRecord(value);
  const status = asRecord(record.quoteStatus ?? asRecord(record.details).quoteStatus);
  const marketSession = stringValue(status.marketSession);
  const bidAskState = stringValue(status.bidAskState);
  if (!marketSession || !bidAskState) return undefined;
  const marketSessionSource = stringValue(status.marketSessionSource);
  const providerMarketState = stringValue(status.providerMarketState);
  const latestContractTradeAt = stringValue(status.latestContractTradeAt);
  return {
    marketSession,
    bidAskState,
    ...(marketSessionSource ? { marketSessionSource } : {}),
    ...(providerMarketState ? { providerMarketState } : {}),
    ...(latestContractTradeAt ? { latestContractTradeAt } : {}),
  };
}

/**
 * Why a tool result's quotes are not live, or undefined when they are live
 * (or the result carries no quote status at all).
 */
export function nonLiveQuoteReason(value: unknown): string | undefined {
  const status = extractQuoteStatusSummary(value);
  if (status && NON_LIVE_BID_ASK_STATES.has(status.bidAskState)) {
    return `Option quotes are ${status.bidAskState} (market session: ${status.marketSession}); bid/ask and premiums are not live or executable now.`;
  }
  const record = asRecord(value);
  const freshness = asRecord(record.freshness ?? asRecord(record.details).freshness);
  if (status && freshness.cacheStatus === "stale") {
    return "Option quotes were served from a stale cache after a provider failure; bid/ask and premiums are not live.";
  }
  return undefined;
}

/** Captured tool evidence whose option quotes were not live when fetched. */
export function findNonLiveQuoteEvidence(
  records: readonly EvidenceRecord[],
): NonLiveQuoteEvidence[] {
  const found: NonLiveQuoteEvidence[] = [];
  for (const record of records) {
    const value = asRecord(record.value);
    if (value.outcome === "error" || value.outcome === "unavailable") continue;
    const reason = nonLiveQuoteReason(value);
    if (!reason) continue;
    found.push({
      tool: stringValue(value.tool) ?? record.label,
      quoteStatus: extractQuoteStatusSummary(value),
      reason,
    });
  }
  return found;
}

/**
 * Explicit statements that option quotes are not live. A generic "verify with
 * your broker" line is deliberately not enough: it does not tell the reader
 * that the numbers shown are not tradable right now.
 */
const NON_LIVE_DISCLOSURE_PATTERNS: readonly RegExp[] = [
  /\blast[- ]session\b/i,
  /\b(?:prior|previous|last)\s+(?:regular\s+)?(?:trading\s+)?(?:session|close|trading day)\b/i,
  /\byesterday'?s\s+(?:close|session|quotes?)\b/i,
  /\bnot\s+(?:currently\s+|yet\s+)?(?:live|executable|tradable|tradeable|firm)\b/i,
  /\bnon[- ]?(?:live|executable|tradable|tradeable)\b/i,
  /\bno\s+live\s+(?:quotes?|bid|ask|bid\/ask|prices?|premiums?|market)\b/i,
  /(?<!\bnot\s)\bstale\b/i,
  /\b(?:closing|indicative|delayed|carried[- ]over|end[- ]of[- ]day)\s+(?:option\s+)?(?:quotes?|prices?|premiums?|bids?|bid\/ask|marks?)\b/i,
  /\boutside\s+(?:of\s+)?(?:the\s+)?(?:regular\s+)?(?:options\s+|market\s+)?(?:trading|market|session)\b/i,
  /\b(?:options\s+)?markets?\s+(?:is|are|was|were|has been|have been)\s+(?:currently\s+)?closed\b/i,
  /\bmarket[- ]closed\b/i,
  /\b(?:after|when|once)\s+(?:the\s+)?(?:regular\s+)?(?:options\s+)?(?:market|trading|session)\s+(?:re)?opens?\b/i,
];

export function disclosesNonLiveQuotes(text: string | undefined): boolean {
  if (!text) return false;
  return NON_LIVE_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(text));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
