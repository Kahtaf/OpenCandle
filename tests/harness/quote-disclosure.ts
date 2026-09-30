/**
 * Eval-side measurement of whether an answer discloses that option quotes are
 * not live. Production does not gate on model wording: OpenCandle appends a
 * deterministic notice instead (see src/runtime/quote-freshness.ts). The
 * `data_gap_disclosed` structured check uses this to score answers.
 */
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

/**
 * The copular form of a live claim: "these are live option quotes", "they are
 * executable premiums". The copula is required, so an instruction such as
 * "verify live bid/ask with your broker" is not a claim.
 */
const COPULAR_LIVE_CLAIM =
  /\b(?:these|those|they|it|this|all)\s+(?:are|is|were|was)\s+(?:currently\s+|now\s+|still\s+)?(?:live|executable|tradable|tradeable|real[- ]?time)\s+(?:option\s+)?(?:quotes?|premiums?|prices?|bid\/ask|bids?|asks?|figures|numbers)\b/gi;

export function disclosesNonLiveQuotes(text: string | undefined): boolean {
  if (!text) return false;
  // A live claim about the underlying ("stock quotes are live") is fine; only
  // a live claim about the option figures contradicts a disclosure.
  const liveClaim =
    [...text.matchAll(LIVE_CLAIM)].some((match) =>
      describesOptionQuotes(clauseBefore(text, match.index).slice(-30) + match[0]),
    ) || [...text.matchAll(COPULAR_LIVE_CLAIM)].some((match) => describesOptionQuotes(match[0]));
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
