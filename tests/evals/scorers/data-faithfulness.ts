import type { EvalTrace, LayerDetail } from "../types.js";

const RELATIVE_TOLERANCE = 0.01; // 1%

/**
 * Minus-sign characters seen in financial text, including the typographic
 * minus (U+2212) plus small and full-width hyphen-minus variants.
 */
const MINUS_SIGN_CHARS = new Set(["-", "\u2212", "\uFE63", "\uFF0D"]);
const SIGN_CHAR_CLASS = "[+\\-\\u2212\\uFE63\\uFF0D]";

/**
 * Magnitude suffix after a currency amount: the compact forms B/M/T or a
 * spelled-out trillion/billion/million. The spelled-out form may be separated
 * from the digits by horizontal whitespace ("$3.697 Trillion").
 */
const SPELLED_MAGNITUDE = "(?:[Tt]rillion|[Bb]illion|[Mm]illion)";
const CURRENCY_MAGNITUDE = `(?:[BMTbmt]\\b|[ \\t]*${SPELLED_MAGNITUDE}\\b)`;

/**
 * A minus directly after a completed dollar amount (only horizontal whitespace
 * may intervene) is a range separator, not a unary sign: `$100-$200`,
 * `$100 - $200`, `$1 million-$2 million`. A line break ends the range context,
 * so `$100\n-$200` keeps the negative on the next line. Bare numbers are
 * deliberately not consulted. The completed dollar amount uses the same
 * magnitude syntax as the currency parser so a spelled-out scale still counts
 * as a finished endpoint.
 */
const DOLLAR_RANGE_GUARD = `(?<!${SIGN_CHAR_CLASS}?\\$${SIGN_CHAR_CLASS}?[\\d,]+(?:\\.\\d+)?(?:${CURRENCY_MAGNITUDE})?[ \\t]*)`;

/**
 * Currency amount whose sign may precede or follow the dollar sign, with an
 * optional magnitude suffix: $185.50, -$2.50, $-2.50, +$3.25, $1,234.56,
 * -$2.5B, $3.697 Trillion. The sign and suffix are part of the match so the
 * digits can never be re-matched as an unsigned substring.
 */
const CURRENCY_PATTERN = new RegExp(
  `(?:${DOLLAR_RANGE_GUARD}(${SIGN_CHAR_CLASS}))?\\$(${SIGN_CHAR_CLASS})?(\\d[\\d,]*(?:\\.\\d+)?)(${CURRENCY_MAGNITUDE})?`,
  "g",
);

/**
 * A currency amount (groups 1-4) or a plain number (groups 5-6). The ordered
 * alternation keeps a signed currency amount from being double-counted as a
 * bare unsigned number. The plain-number branch keeps its original
 * `[+-]?digits` semantics; only a sign directly after a dollar amount is
 * treated as a range separator.
 */
const STRING_NUMBER_PATTERN = new RegExp(
  `${CURRENCY_PATTERN.source}|(?:${DOLLAR_RANGE_GUARD}([+-]))?(\\d+(?:\\.\\d+)?)`,
  "g",
);

/** Apply the B/M/T (compact or spelled-out) magnitude suffix to a currency magnitude. */
function magnitudeMultiplier(suffix: string | undefined): number {
  if (suffix === undefined) return 1;
  const normalized = suffix.trim().toUpperCase();
  if (normalized === "T" || normalized === "TRILLION") return 1e12;
  if (normalized === "B" || normalized === "BILLION") return 1e9;
  if (normalized === "M" || normalized === "MILLION") return 1e6;
  return 1;
}

/** Parse a currency amount, treating a minus before or after the `$` as negative. */
function parseSignedCurrency(
  signBefore: string | undefined,
  signAfter: string | undefined,
  digits: string,
  suffix?: string,
): number {
  const magnitude = parseFloat(digits.replace(/,/g, "")) * magnitudeMultiplier(suffix);
  const negative =
    (signBefore !== undefined && MINUS_SIGN_CHARS.has(signBefore)) ||
    (signAfter !== undefined && MINUS_SIGN_CHARS.has(signAfter));
  return negative ? -magnitude : magnitude;
}

/**
 * Unambiguous direction wording that may re-sign an unsigned percent magnitude.
 * A preceding direction word always wins; trailing direction is limited to
 * change NOUNS directly after the number ("a 2.47% decrease"). Trailing
 * transition verbs/participles and "up"/"down" are deliberately not
 * normalized, so "4% falling to 3%" and "4% down from 5%" stay positive.
 */
const DIRECTION_CONNECTOR = "(?:of|by|about|around|roughly|approximately|nearly)";
const NEGATIVE_DIRECTION_WORDS =
  "decreas(?:e|ed|es|ing)|down|fell|fall(?:s|en|ing)?|drop(?:s|ped|ping)?|declin(?:e|ed|es|ing)|loss(?:es)?";
const POSITIVE_DIRECTION_WORDS = "increas(?:e|ed|es|ing)|up|gain(?:s|ed)?|rose|ris(?:e|en|ing)";

const NEGATIVE_DIRECTION_BEFORE = new RegExp(
  `\\b(?:${NEGATIVE_DIRECTION_WORDS})\\b(?:\\s+${DIRECTION_CONNECTOR}){0,2}\\s*$`,
  "i",
);
const POSITIVE_DIRECTION_BEFORE = new RegExp(
  `\\b(?:${POSITIVE_DIRECTION_WORDS})\\b(?:\\s+${DIRECTION_CONNECTOR}){0,2}\\s*$`,
  "i",
);
// Whole-word noun forms only: this excludes inflections such as "falling",
// "dropped", and "declining", and never includes "up"/"down".
const NEGATIVE_DIRECTION_AFTER = /^\s*(?:decrease|decline|drop|fall|loss)\b/i;
const POSITIVE_DIRECTION_AFTER = /^\s*(?:increase|gain|rise)\b/i;

/** Bounded character window on each side of a percent magnitude. */
const DIRECTION_CONTEXT_BEFORE = 32;
const DIRECTION_CONTEXT_AFTER = 16;

/**
 * Resolve an unsigned percent's sign from a directly preceding direction word,
 * falling back to a directly trailing change noun. Callers apply this only when
 * the percent has no explicit sign, so an explicit sign is never overridden and
 * a contradictory claim cannot be silently corrected.
 */
function directionForPercent(text: string, start: number, end: number): "+" | "-" | undefined {
  const before = text.slice(Math.max(0, start - DIRECTION_CONTEXT_BEFORE), start);
  const after = text.slice(end, end + DIRECTION_CONTEXT_AFTER);
  // A directly preceding direction is unambiguous and wins over trailing nouns.
  if (NEGATIVE_DIRECTION_BEFORE.test(before)) return "-";
  if (POSITIVE_DIRECTION_BEFORE.test(before)) return "+";
  if (NEGATIVE_DIRECTION_AFTER.test(after)) return "-";
  if (POSITIVE_DIRECTION_AFTER.test(after)) return "+";
  return undefined;
}

/**
 * Explicit duration context that makes a trailing `m`/`M` a time unit (minutes)
 * rather than a millions magnitude: "~15m delayed", "15m ago". Outside this
 * context a lowercase `m` remains a millions suffix; ambiguous connective words
 * (before/after/later/left/remaining/prior) are deliberately excluded so that
 * "raised 15M before fees" stays a money amount.
 */
const DURATION_AFTER = "(?:delayed|delay|ago)\\b";
const ABBREVIATED_LARGE_NUMBER_PATTERN = new RegExp(
  `([+\\-\\u2212\\uFE63\\uFF0D]?\\$[+\\-\\u2212\\uFE63\\uFF0D]?)?(\\d+(?:\\.\\d+)?(?:[BTbt]\\b|[mM]\\b(?![ \\t]*${DURATION_AFTER})))`,
  "g",
);

/**
 * Extract financial numbers from response text.
 * Matches: $185.50, 28.5%, 1.2B, 15.3x, -0.5%, plain decimals in financial context.
 * Excludes: ordinals (1st, 2nd), list indices, dates, year numbers.
 */
export function extractFinancialNumbers(text: string): number[] {
  const numbers: number[] = [];

  // Currency amounts: $185.50, -$2.50, $-2.50, +$3.25, $1,234.56, -$2.5B
  for (const m of text.matchAll(CURRENCY_PATTERN)) {
    const num = parseSignedCurrency(m[1], m[2], m[3], m[4]);
    if (Number.isFinite(num)) numbers.push(num);
  }

  // Percentages: 28.5%, -0.5%, +12.3%, plus unsigned magnitudes whose direction
  // is stated immediately before the number ("a decrease of 0.33%") or as a
  // trailing change noun ("a 2.47% decrease"). An explicit sign wins.
  for (const m of text.matchAll(/([+-])?(\d+(?:\.\d+)?)%/g)) {
    const magnitude = parseFloat(m[2]);
    const start = m.index ?? 0;
    const sign = m[1] ?? directionForPercent(text, start, start + m[0].length);
    numbers.push(sign === "-" ? -magnitude : magnitude);
  }

  // Multipliers: 15.3x
  for (const m of text.matchAll(/\d+(?:\.\d+)?x\b/g)) {
    numbers.push(parseFloat(m[0].replace("x", "")));
  }

  // Abbreviated large numbers: 1.2B, 500M, 3.5T. Currency-prefixed amounts are
  // already consumed by CURRENCY_PATTERN, so skip them here rather than emit a
  // second, unsigned value. A trailing `m`/`M` in explicit duration context is
  // minutes, not a millions magnitude.
  for (const m of text.matchAll(ABBREVIATED_LARGE_NUMBER_PATTERN)) {
    if (m[1] !== undefined) continue;
    const raw = m[2];
    const num = parseFloat(raw.slice(0, -1));
    const suffix = raw.slice(-1).toUpperCase();
    const multiplier = suffix === "T" ? 1e12 : suffix === "B" ? 1e9 : 1e6;
    numbers.push(num * multiplier);
  }

  // Financial metric patterns: "P/E of 28.5", "ratio of 1.2", "yield of 3.5"
  for (const m of text.matchAll(
    /(?:P\/E|EPS|P\/B|P\/S|PEG|yield|ratio|margin|return|drawdown|volatility|beta|alpha|sharpe|VaR|market\s+cap)\s+(?:of\s+|is\s+|at\s+|:?\s*)([+-]?\d+(?:\.\d+)?)/gi,
  )) {
    numbers.push(parseFloat(m[1]));
  }

  return [...new Set(numbers)];
}

/** Recursively extract all numeric values from a nested object. */
export function extractNumbersFromObject(obj: unknown): number[] {
  const numbers: number[] = [];

  if (typeof obj === "number" && Number.isFinite(obj)) {
    numbers.push(obj);
  } else if (typeof obj === "string") {
    // Extract numbers from string values, preserving currency sign placement.
    for (const m of obj.matchAll(STRING_NUMBER_PATTERN)) {
      if (m[3] !== undefined) {
        const n = parseSignedCurrency(m[1], m[2], m[3], m[4]);
        if (Number.isFinite(n)) numbers.push(n);
      } else {
        const sign = m[5];
        const magnitude = parseFloat(m[6]);
        const negative = sign !== undefined && MINUS_SIGN_CHARS.has(sign);
        const n = negative ? -magnitude : magnitude;
        if (Number.isFinite(n)) numbers.push(n);
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      numbers.push(...extractNumbersFromObject(item));
    }
  } else if (obj !== null && typeof obj === "object") {
    for (const value of Object.values(obj)) {
      numbers.push(...extractNumbersFromObject(value));
    }
  }

  return numbers;
}

function isWithinTolerance(value: number, reference: number): boolean {
  if (reference === 0) return value === 0;
  return Math.abs((value - reference) / reference) <= RELATIVE_TOLERANCE;
}

export function scoreDataFaithfulness(trace: EvalTrace): LayerDetail {
  const responseNumbers = extractFinancialNumbers(trace.text);

  if (responseNumbers.length === 0) {
    return { passed: true, score: 1.0, message: "No financial numbers in response" };
  }

  // Build the union of all numeric values from tool results
  const groundTruthNumbers: number[] = [];
  for (const tc of trace.toolCalls) {
    if (tc.result !== undefined) {
      groundTruthNumbers.push(...extractNumbersFromObject(tc.result));
    }
  }
  const groundTruth = new Set(groundTruthNumbers);

  const ungrounded: number[] = [];
  for (const num of responseNumbers) {
    const grounded =
      groundTruth.has(num) || [...groundTruth].some((ref) => isWithinTolerance(num, ref));
    if (!grounded) {
      ungrounded.push(num);
    }
  }

  const score = (responseNumbers.length - ungrounded.length) / responseNumbers.length;
  return {
    passed: ungrounded.length === 0,
    score,
    message:
      ungrounded.length > 0
        ? `Ungrounded numbers: ${ungrounded.join(", ")}`
        : `All ${responseNumbers.length} financial numbers grounded`,
  };
}
