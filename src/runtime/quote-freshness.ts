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

/** How an option chain's quotes fail to be live. */
export type NonLiveQuoteKind = "last_session" | "closed_market" | "stale_cache";

export interface NonLiveQuoteEvidence {
  tool: string;
  kind: NonLiveQuoteKind;
  quoteStatus?: QuoteStatusSummary;
  reason: string;
}

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
 * How a tool result's quotes fail to be live, or undefined when they are live
 * (or the result carries no quote status at all).
 */
export function nonLiveQuoteKind(value: unknown): NonLiveQuoteKind | undefined {
  const status = extractQuoteStatusSummary(value);
  if (!status) return undefined;
  if (status.bidAskState === "last_session_quotes") return "last_session";
  if (status.bidAskState === "closed_market_or_stale_quotes") return "closed_market";
  const record = asRecord(value);
  const freshness = asRecord(record.freshness ?? asRecord(record.details).freshness);
  return freshness.cacheStatus === "stale" ? "stale_cache" : undefined;
}

/**
 * Why a tool result's quotes are not live, or undefined when they are live
 * (or the result carries no quote status at all).
 */
export function nonLiveQuoteReason(value: unknown): string | undefined {
  const kind = nonLiveQuoteKind(value);
  if (!kind) return undefined;
  if (kind === "stale_cache") {
    return "Option quotes were served from a stale cache after a provider failure; bid/ask and premiums are not live.";
  }
  const status = extractQuoteStatusSummary(value);
  return `Option quotes are ${status?.bidAskState} (market session: ${status?.marketSession}); bid/ask and premiums are not live or executable now.`;
}

/** Captured tool evidence whose option quotes were not live when fetched. */
export function findNonLiveQuoteEvidence(
  records: readonly EvidenceRecord[],
): NonLiveQuoteEvidence[] {
  const found: NonLiveQuoteEvidence[] = [];
  for (const record of records) {
    const value = asRecord(record.value);
    if (value.outcome === "error" || value.outcome === "unavailable") continue;
    const kind = nonLiveQuoteKind(value);
    const reason = nonLiveQuoteReason(value);
    if (!kind || !reason) continue;
    const quoteStatus = extractQuoteStatusSummary(value);
    found.push({
      tool: stringValue(value.tool) ?? record.label,
      kind,
      ...(quoteStatus ? { quoteStatus } : {}),
      reason,
    });
  }
  return found;
}

const SESSION_SENTENCES: Readonly<Record<string, string>> = {
  pre_market: "Options market has not opened yet.",
  after_hours: "Options market is after hours.",
  closed: "Options market is closed.",
};

const KIND_SENTENCES: Readonly<Record<NonLiveQuoteKind, string>> = {
  last_session: "Option prices shown are from the last regular session and are not executable now.",
  closed_market: "Option bid/ask were not quoted, so recheck prices during regular trading.",
  stale_cache: "Option prices shown came from cached data after a provider error and are not live.",
};

const KIND_ORDER: readonly NonLiveQuoteKind[] = ["last_session", "closed_market", "stale_cache"];

/**
 * The fixed notice OpenCandle appends after an answer built from non-live
 * option-chain evidence, or undefined when every captured chain was live. It
 * is derived from the tool's own quote status, never from the model's words.
 */
export function buildNonLiveQuoteNotice(records: readonly EvidenceRecord[]): string | undefined {
  const nonLive = findNonLiveQuoteEvidence(records);
  if (nonLive.length === 0) return undefined;
  const session = nonLive
    .map((entry) => SESSION_SENTENCES[entry.quoteStatus?.marketSession ?? ""])
    .find((sentence) => sentence !== undefined);
  const kinds = new Set(nonLive.map((entry) => entry.kind));
  const details = KIND_ORDER.filter((kind) => kinds.has(kind)).map((kind) => KIND_SENTENCES[kind]);
  return [...(session ? [session] : []), ...details].join(" ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
