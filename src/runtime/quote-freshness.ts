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
 *
 * These phrases state non-liveness affirmatively ("last-session quotes",
 * "markets are closed"), so a match only counts when the same clause does not
 * negate it ("these are not last-session quotes").
 */
const AFFIRMATIVE_NON_LIVE_PATTERNS: readonly RegExp[] = [
  /\blast[- ]session\b/gi,
  /\b(?:prior|previous|last|most\s+recent)\s+(?:regular\s+)?(?:trading\s+)?(?:session|close|trading day)\b/gi,
  /\b(?:yesterday|(?:mon|tues|wednes|thurs|fri|satur|sun)day)'?s\s+(?:close|session|quotes?)\b/gi,
  /\bas\s+of\s+(?:the\s+)?(?:market\s+)?close\b/gi,
  // "stale" and "delayed" must describe the quotes, not another subject
  // ("the earnings release was delayed"), and must not be negated in between.
  /\b(?:quotes?|premiums?|prices?|bids?|asks?|bid\/ask|marks?|data|chain|figures|numbers)\b(?:(?!\bnot\b|n't\b|\bnever\b)(?:[^.;:!?\n]|\.(?=\d))){0,30}?\b(?:stale|delayed)\b/gi,
  /\b(?:stale|delayed)\s+(?:option\s+)?(?:quotes?|premiums?|prices?|bids?|asks?|bid\/ask|marks?|data|chain|figures)\b/gi,
  /\b(?:closing|indicative|cached|carried[- ]over|end[- ]of[- ]day|after[- ]hours|pre[- ]?market)\s+(?:option\s+)?(?:quotes?|prices?|premiums?|bids?|bid\/ask|marks?)\b/gi,
  /\bfrom\s+(?:a|the)\s+(?:stale\s+)?cache\b/gi,
  /\boutside\s+(?:of\s+)?(?:the\s+)?(?:regular\s+)?(?:options\s+|market\s+)?(?:trading|market|session)\b/gi,
  /\b(?:options\s+)?markets?\s+(?:is|are|was|were|has|have|has been|have been)\s+(?:now\s+|currently\s+)?closed\b/gi,
  /\bmarkets?(?:'s)?[- ]closed\b/gi,
  /\b(?:options\s+)?markets?\s+(?:is|are)\s+(?:now\s+|currently\s+)?(?:in\s+)?(?:after[- ]hours|pre[- ]?market)\b/gi,
  // A timing phrase alone ("buy at the open") is not a disclosure; it must be
  // an instruction to recheck the figures once trading resumes.
  /\b(?:re-?check|check|verify|confirm|refresh|re-?quote|re-?price)\b[^.;:!?\n]{0,60}?\b(?:(?:after|when|once|until|before)\s+(?:the\s+)?(?:regular\s+)?(?:options\s+)?(?:market|trading|session)\s+(?:re)?opens?|(?:at|after)\s+(?:the|tomorrow'?s|(?:mon|tues|wednes|thurs|fri)day'?s|next\s+session'?s)\s+(?:market\s+)?open)\b/gi,
];

/** Phrases whose negation is the disclosure itself ("not live", "no live quotes"). */
const NEGATED_NON_LIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:not|isn'?t|aren'?t|wasn'?t|weren'?t)\s+(?:currently\s+|yet\s+)?(?:live|executable|tradable|tradeable|firm|real[- ]?time)\b/gi,
  /\bnon[- ]?(?:live|executable|tradable|tradeable)\b/gi,
  /\bno\s+live\s+(?:quotes?|bid|ask|bid\/ask|prices?|premiums?|market)\b/gi,
  /\bcan(?:not|'t|\s+not)\s+be\s+(?:executed|traded|filled)\b/gi,
];

/** A negation in the few words before a phrase, e.g. "are not from the". */
const PRECEDING_NEGATION =
  /\b(?:not|never|no\s+longer|isn'?t|aren'?t|wasn'?t|weren'?t)\s+(?:[\w/'-]+\s+){0,3}$/i;

/** A conditional opening the current sub-clause, e.g. "if these quotes are". */
const PRECEDING_CONDITIONAL = /\b(?:if|whether|unless|in\s+case)\b/i;

/**
 * An explicit claim that the shown figures are live ("the premiums shown are
 * live"). It contradicts any disclaimer elsewhere, so the answer does not
 * disclose. Adjectival "live bid/ask" is not a claim: "verify live bid/ask
 * with your broker" is compliant wording.
 */
const LIVE_CLAIM =
  /\b(?:quotes?|premiums?|prices?|bid\/ask|bids?|asks?|figures|numbers)\s+(?:shown\s+|above\s+|below\s+|here\s+)?(?:are|is)\s+(?:currently\s+|now\s+)?(?:live|executable|tradable|tradeable|real[- ]?time)\b/i;

export function disclosesNonLiveQuotes(text: string | undefined): boolean {
  if (!text) return false;
  if (LIVE_CLAIM.test(text)) return false;
  // Any phrase in a conditional ("if these quotes are not live") is hypothetical,
  // not a disclosure; affirmative phrases must also not be negated.
  const counts = (index: number, checkNegation: boolean): boolean => {
    const clause = clauseBefore(text, index);
    const subClause = clause.slice(clause.lastIndexOf(",") + 1);
    if (PRECEDING_CONDITIONAL.test(subClause)) return false;
    return !(checkNegation && PRECEDING_NEGATION.test(clause));
  };
  const matches = (patterns: readonly RegExp[], checkNegation: boolean): boolean =>
    patterns.some((pattern) =>
      [...text.matchAll(pattern)].some((match) => counts(match.index, checkNegation)),
    );
  return matches(NEGATED_NON_LIVE_PATTERNS, false) || matches(AFFIRMATIVE_NON_LIVE_PATTERNS, true);
}

/** Text of the current clause before `index` (bounded, stops at clause breaks). */
function clauseBefore(text: string, index: number): string {
  const window = text.slice(Math.max(0, index - 60), index);
  const breaks = [...window.matchAll(/[;:!?\n]|\.(?!\d)/g)];
  const last = breaks.at(-1);
  return last?.index === undefined ? window : window.slice(last.index + 1);
}

const QUOTE_VOCABULARY =
  /\b(?:premiums?|bids?|asks?|bid\/ask|mid(?:point)?s?|prices?|costs?|debits?|credits?|marks?)\b/i;

/**
 * Whether the text shows any price-like figure an options quote could be read
 * from: a currency amount, a number next to quote vocabulary in the same
 * clause ("premium of 4.80", "Bid: 4", "480 per contract", "4 dollars"), or a
 * table whose header names a quote column. Greeks and ratios alone ("delta
 * 0.42") and status lines ("Fetched the chain for 2 expirations") show none.
 */
export function presentsQuoteFigures(text: string | undefined): boolean {
  if (!text) return false;
  if (/\$\s?\d/.test(text)) return true;
  const vocabulary = QUOTE_VOCABULARY.source;
  if (new RegExp(`${vocabulary}[^\\n;!?]{0,25}?\\d`, "i").test(text)) return true;
  // The amount may also come first: "4.80 bid", "4.80 / 5.00 bid/ask", "480 per contract".
  if (
    new RegExp(
      `\\d[^\\n;!?]{0,15}?(?:${vocabulary}|\\b(?:dollars?|usd|per\\s+(?:contract|share))\\b)`,
      "i",
    ).test(text)
  )
    return true;
  const lines = text.split("\n");
  const header = lines.findIndex((line) => line.includes("|") && QUOTE_VOCABULARY.test(line));
  return (
    header >= 0 && lines.slice(header + 1).some((line) => line.includes("|") && /\d/.test(line))
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
