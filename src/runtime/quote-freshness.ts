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

// Explicit statements that option quotes are not live. A generic "verify with
// your broker" line is deliberately not enough: it does not tell the reader
// that the numbers shown are not tradable right now. Affirmative phrases
// ("last-session quotes", "markets are closed") only count when the same
// clause does not negate them ("these are not last-session quotes").

/**
 * Session, cache, and staleness wording ("last-session", "as of the prior
 * close", "outside regular trading", "stale", "from a stale cache", "recheck
 * at the open"). It only discloses when its sentence is about the option
 * quotes: "Underlying: $200 as of market close" timestamps the stock, not the
 * premiums shown.
 */
const QUOTE_SCOPED_PATTERNS: readonly RegExp[] = [
  /\blast[- ]session\b/gi,
  /\b(?:prior|previous|last|most\s+recent)\s+(?:regular\s+)?(?:trading\s+)?(?:session|close|trading day)\b/gi,
  /\b(?:yesterday|(?:mon|tues|wednes|thurs|fri|satur|sun)day)'?s\s+(?:close|session|quotes?)\b/gi,
  /\bas\s+of\s+(?:the\s+)?(?:market\s+)?close\b/gi,
  // "Liquidity can deteriorate outside regular hours" is generic advice; it
  // must say the chain or quotes were observed outside regular trading.
  /\boutside\s+(?:of\s+)?(?:the\s+)?(?:regular\s+)?(?:options\s+|market\s+)?(?:trading|market|session)\b/gi,
  // "Markets closed" can be past tense ("the market closed higher"), so it must
  // sit in a sentence about the quotes.
  /\bmarkets?(?:'s)?[- ]closed\b/gi,
  // "stale" and "delayed" must describe the quotes, not another subject
  // ("the earnings release was delayed"), and must not be negated in between.
  /\b(?:quotes?|premiums?|prices?|bids?|asks?|bid\/ask|marks?|data|chain|figures|numbers)\b(?:(?!\bnot\b|n't\b|\bnever\b)(?:[^.;:!?\n]|\.(?=\d))){0,30}?\b(?:stale|delayed)\b/gi,
  /\b(?:stale|delayed)\s+(?:option\s+)?(?:quotes?|premiums?|prices?|bids?|asks?|bid\/ask|marks?|data|chain|figures)\b/gi,
  /\b(?:closing|indicative|cached|carried[- ]over|end[- ]of[- ]day|after[- ]hours|pre[- ]?market)\s+(?:option\s+)?(?:quotes?|prices?|premiums?|bids?|bid\/ask|marks?)\b/gi,
  /\bfrom\s+(?:a|the)\s+(?:stale\s+)?cache\b/gi,
  // A timing phrase alone ("buy at the open") is not a disclosure; it must be
  // an instruction to recheck the figures once trading resumes.
  /\b(?:re-?check|check|verify|confirm|refresh|re-?quote|re-?price)\b[^.;:!?\n]{0,60}?\b(?:(?:after|when|once|until|before)\s+(?:the\s+)?(?:regular\s+)?(?:options\s+)?(?:market|trading|session)\s+(?:re)?opens?|(?:at|after)\s+(?:the|tomorrow'?s|(?:mon|tues|wednes|thurs|fri)day'?s|next\s+session'?s)\s+(?:market\s+)?open)\b/gi,
];

const QUOTE_SUBJECT =
  /\b(?:quotes?|premiums?|bid\/ask|bids?|asks?|marks?|options?|chain|contracts?)\b/i;
/**
 * Generic nouns ("prices", "data") only refer to the quotes when unqualified:
 * at the start of the sentence or after a determiner ("these prices", "the
 * data"). "Economic data" or "commodity prices" are other subjects.
 */
const GENERIC_QUOTE_SUBJECT =
  /(?:^\s*|\b(?:these|those|the|all|quoted|shown|listed)\s+)(?:prices?|data|numbers|figures)\b/i;
const OPTION_SPECIFIC_SUBJECT = /\b(?:options?|premiums?|bid\/ask|chain|contracts?)\b/i;
const NON_OPTION_SUBJECT = /\b(?:underlying|stock|(?<!per\s)shares?|equity|index)\b/i;

/**
 * Whether a span talks about the option quotes. When it also names the
 * underlying or stock, it must name the options themselves ("option
 * premiums", "bid/ask"), so "the underlying price is not live" does not count.
 */
function describesOptionQuotes(span: string): boolean {
  if (!QUOTE_SUBJECT.test(span) && !GENERIC_QUOTE_SUBJECT.test(span)) return false;
  return !NON_OPTION_SUBJECT.test(span) || OPTION_SPECIFIC_SUBJECT.test(span);
}

/** The sentence around a match (bounded, stops at sentence ends, not decimals). */
function sentenceAround(text: string, index: number, length: number): string {
  const before = text.slice(Math.max(0, index - 120), index);
  const start = [...before.matchAll(/[!?\n]|\.(?!\d)/g)].at(-1)?.index;
  const after = text.slice(index + length, index + length + 120);
  const end = after.search(/[!?\n]|\.(?!\d)/);
  return (
    (start === undefined ? before : before.slice(start + 1)) +
    text.slice(index, index + length) +
    (end < 0 ? after : after.slice(0, end))
  );
}

/**
 * Present market status ("markets are closed", "the options market is in
 * after-hours trading"). These describe why no quote is live right now.
 */
const MARKET_STATUS_PATTERNS: readonly RegExp[] = [
  // Present tense only: "the market was closed yesterday" says nothing about now.
  /\b(?:options\s+)?markets?\s+(?:is|are|has|have|has been|have been)\s+(?:now\s+|currently\s+)?closed\b/gi,
  /\b(?:options\s+)?markets?\s+(?:is|are)\s+(?:now\s+|currently\s+)?(?:in\s+)?(?:after[- ]hours|pre[- ]?market)\b/gi,
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
  /\b(?:quotes?|premiums?|prices?|bid\/ask|bids?|asks?|figures|numbers)(?:\s+(?!(?:are|is|not)\b)[\w/-]+){0,4}\s+(?:are|is)\s+(?:currently\s+|now\s+|still\s+)?(?:live|executable|tradable|tradeable|real[- ]?time)\b/gi;

export function disclosesNonLiveQuotes(text: string | undefined): boolean {
  if (!text) return false;
  // A live claim about the underlying ("stock quotes are live") is fine; only
  // a live claim about the option figures contradicts a disclosure.
  const liveClaim = [...text.matchAll(LIVE_CLAIM)].some((match) =>
    describesOptionQuotes(clauseBefore(text, match.index).slice(-30) + match[0]),
  );
  if (liveClaim) return false;
  // Any phrase in a conditional ("if these quotes are not live") is hypothetical,
  // not a disclosure; affirmative phrases must also not be negated.
  const counts = (index: number, checkNegation: boolean): boolean => {
    const clause = clauseBefore(text, index);
    const subClause = clause.slice(clause.lastIndexOf(",") + 1);
    if (PRECEDING_CONDITIONAL.test(subClause)) return false;
    return !(checkNegation && PRECEDING_NEGATION.test(clause));
  };
  const matches = (
    patterns: readonly RegExp[],
    checkNegation: boolean,
    aboutOptionQuotes: boolean,
  ): boolean =>
    patterns.some((pattern) =>
      [...text.matchAll(pattern)].some(
        (match) =>
          counts(match.index, checkNegation) &&
          (!aboutOptionQuotes ||
            describesOptionQuotes(sentenceAround(text, match.index, match[0].length))),
      ),
    );
  // "Not live", staleness, and session wording must be about the option
  // quotes, not the underlying; present market status needs no subject.
  return (
    matches(NEGATED_NON_LIVE_PATTERNS, false, true) ||
    matches(QUOTE_SCOPED_PATTERNS, true, true) ||
    matches(MARKET_STATUS_PATTERNS, true, false)
  );
}

/** Text of the current clause before `index` (bounded, stops at clause breaks). */
function clauseBefore(text: string, index: number): string {
  const window = text.slice(Math.max(0, index - 60), index);
  const breaks = [...window.matchAll(/[;:!?\n]|\.(?!\d)/g)];
  const last = breaks.at(-1);
  return last?.index === undefined ? window : window.slice(last.index + 1);
}

const QUOTE_VOCABULARY =
  /\b(?:premiums?|bids?|asks?|bid\/ask|mid(?:point)?s?|prices?|costs?|debits?|credits?|marks?|last(?:\s+(?:price|trade))?)\b/i;

/**
 * Whether the text shows any price-like figure an options quote could be read
 * from: a currency amount, a number next to quote vocabulary in the same
 * clause ("premium of 4.80", "Bid: 4", "480 per contract", "4 dollars"), or a
 * table whose header names a quote column. Greeks and ratios alone ("delta
 * 0.42") and status lines ("Fetched the chain for 2 expirations") show none.
 */
/**
 * A currency amount that is not a strike or an underlying/stock price. "The
 * $210 strike" and "Underlying: $200" name no quote; "at $4.80" does.
 */
function presentsCurrencyQuote(text: string): boolean {
  for (const match of text.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?/g)) {
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 12);
    if (/^\s*(?:strikes?|calls?|puts?|[cp])\b/i.test(after)) continue;
    const before = text.slice(Math.max(0, match.index - 25), match.index);
    const lead = before.slice(before.search(/[^.;:!?\n]*$/));
    if (
      /\b(?:strike|underlying|stock|shares?|spot)\b/i.test(lead) &&
      !/\b(?:premium|bid|ask|mid|cost|debit|credit|calls?|puts?|options?|contracts?)\b/i.test(lead)
    )
      continue;
    if (/\b(?:underlying|stock|spot)\s*:\s*$/i.test(before)) continue;
    return true;
  }
  return false;
}

export function presentsQuoteFigures(text: string | undefined): boolean {
  if (!text) return false;
  if (presentsCurrencyQuote(text)) return true;
  const vocabulary = QUOTE_VOCABULARY.source;
  // Same clause only: a sentence end (not a decimal point) breaks proximity.
  const clauseChar = "(?:[^\\n;!?.]|\\.(?=\\d))";
  // The number must be a quote value, not a count ("for 3 expirations").
  const quoteValue =
    "\\b\\d[\\d,]*(?:\\.\\d+)?\\b(?!\\s*(?:%|(?:expirations?|contracts?|strikes?|calls?|puts?|delta|days?|weeks?|months?|dte|percent|shares?|times)\\b))";
  const nearQuote = [
    new RegExp(`${vocabulary}${clauseChar}{0,25}?${quoteValue}`, "gi"),
    // A value stated for a named contract: "the 210 call is 4.80", "the 205 put: 3.10".
    new RegExp(
      `\\b(?:calls?|puts?)\\b${clauseChar}{0,15}?(?:\\b(?:is|at|for|costs?|of)\\b|[:=])\\s*${quoteValue}`,
      "gi",
    ),
    // The amount may also come first: "4.80 bid", "4.80 / 5.00 bid/ask",
    // "480 per contract". A comma ends that phrase ("200.15, no premium").
    new RegExp(
      `\\d(?:(?!,)${clauseChar}){0,15}?(?:${vocabulary}|\\b(?:dollars?|usd|per\\s+(?:contract|share))\\b)`,
      "gi",
    ),
  ];
  // "The stock price is 200" is the underlying, not an option quote.
  const aboutOptions = (index: number, length: number): boolean => {
    const lead = text.slice(Math.max(0, index - 25), index);
    const span = lead.slice(lead.search(/[^.;!?\n]*$/)) + text.slice(index, index + length);
    return !NON_OPTION_SUBJECT.test(span) || OPTION_SPECIFIC_SUBJECT.test(span);
  };
  for (const pattern of nearQuote) {
    for (const match of text.matchAll(pattern)) {
      if (aboutOptions(match.index, match[0].length)) return true;
    }
  }
  return tablePresentsQuoteCell(text);
}

/**
 * A markdown table with a quote column (premium, bid/ask, last, ...) whose
 * cell holds a number in some row. Other numeric cells (strike, expiry) do not
 * count, so a table whose quote cells are all "N/A" presents no quote.
 */
function tablePresentsQuoteCell(text: string): boolean {
  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("|")) continue;
    const quoteColumns = cells(lines[i])
      .map((cell, index) => (QUOTE_VOCABULARY.test(cell) ? index : -1))
      .filter((index) => index >= 0);
    if (quoteColumns.length === 0) continue;
    for (const row of lines.slice(i + 1)) {
      if (!row.includes("|")) break;
      const rowCells = cells(row);
      if (quoteColumns.some((index) => /\d/.test(rowCells[index] ?? ""))) return true;
    }
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
