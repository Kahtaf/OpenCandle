import type { EvalTrace, LayerDetail } from "../types.js";

const RELATIVE_TOLERANCE = 0.01; // 1%

/**
 * Minus-sign characters seen in financial text, including the typographic
 * minus (U+2212) plus small and full-width hyphen-minus variants.
 */
const MINUS_SIGN_CHARS = new Set(["-", "\u2212", "\uFE63", "\uFF0D"]);
const SIGN_CHAR_CLASS = "[+\\-\\u2212\\uFE63\\uFF0D]";

/**
 * Digits for a financial number: either a properly comma-grouped integer
 * (thousands groups of exactly three digits) or an ungrouped integer, each with
 * an optional decimal part. Shared by currency, bare tool-string, abbreviated,
 * and metric parsing so a grouped magnitude such as "3,680B" is one number
 * rather than "3" plus "680B", while an arbitrary comma list such as "20,30"
 * stays two numbers instead of merging into 2030. The trailing digit guard keeps
 * a valid group from ending mid digit-run, so "20,3000" stays "20" and "3000"
 * instead of becoming "20,300" plus "0".
 */
const NUMBER_DIGITS = "(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?(?!\\d)|\\d+(?:\\.\\d+)?)";

/**
 * Magnitude suffix after a number: the compact forms B/M/T or a spelled-out
 * trillion/billion/million. The spelled-out form may be separated from the
 * digits by horizontal whitespace ("$3.697 Trillion", "3.68 Trillion"). The
 * compact, spelled, and multiplier pieces below are the single shared grammar
 * used by currency, bare tool-string, abbreviated, and metric parsing.
 */
const SPELLED_MAGNITUDE = "(?:[Tt]rillion|[Bb]illion|[Mm]illion)";
const COMPACT_MAGNITUDE = "[BMTbmt]";
const CURRENCY_MAGNITUDE = `(?:${COMPACT_MAGNITUDE}\\b|[ \\t]*${SPELLED_MAGNITUDE}\\b)`;

/**
 * Explicit duration context that makes a trailing `m`/`M` a time unit (minutes)
 * rather than a millions magnitude: "~15m delayed", "15m ago". Outside this
 * context a lowercase `m` remains a millions suffix; ambiguous connective words
 * (before/after/later/left/remaining/prior) are deliberately excluded so that
 * "raised 15M before fees" stays a money amount.
 */
const DURATION_AFTER = "(?:delayed|delay|ago)\\b";

/**
 * Compact magnitude after a bare number, with the duration exception applied to
 * `m`/`M`. Shared so the response abbreviated parser and the tool-string parser
 * recognize the same compact scale letters.
 */
const COMPACT_BARE_MAGNITUDE = `(?:[BTbt]\\b|[mM]\\b(?![ \\t]*${DURATION_AFTER}))`;

/**
 * Magnitude after a bare (non-currency) number: the compact forms plus the
 * spelled-out forms. This is the tool-string counterpart of CURRENCY_MAGNITUDE.
 */
const BARE_MAGNITUDE = `(?:${COMPACT_BARE_MAGNITUDE}|[ \\t]*${SPELLED_MAGNITUDE}\\b)`;

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
  `(?:${DOLLAR_RANGE_GUARD}(${SIGN_CHAR_CLASS}))?\\$(${SIGN_CHAR_CLASS})?(${NUMBER_DIGITS})(${CURRENCY_MAGNITUDE})?`,
  "g",
);

/**
 * A currency amount (groups 1-4) or a bare number with an optional sign and
 * magnitude (groups 5-7). The ordered alternation keeps a signed currency
 * amount from being double-counted as a bare unsigned number. The bare-number
 * branch keeps unary sign parsing, now scaled by the shared digit and bare
 * magnitude grammars; only a sign directly after a dollar amount is treated as
 * a range separator. Consuming the magnitude with the digits prevents an
 * unscaled mantissa from being emitted beside the scaled value.
 */
const STRING_NUMBER_PATTERN = new RegExp(
  `${CURRENCY_PATTERN.source}|(?:${DOLLAR_RANGE_GUARD}(${SIGN_CHAR_CLASS}))?(${NUMBER_DIGITS})(${BARE_MAGNITUDE})?`,
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

/** Parse an unsigned decimal (commas allowed) scaled by an optional magnitude suffix. */
function parseMagnitude(digits: string, suffix?: string): number {
  return parseFloat(digits.replace(/,/g, "")) * magnitudeMultiplier(suffix);
}

/** Parse a currency amount, treating a minus before or after the `$` as negative. */
function parseSignedCurrency(
  signBefore: string | undefined,
  signAfter: string | undefined,
  digits: string,
  suffix?: string,
): number {
  const magnitude = parseMagnitude(digits, suffix);
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
 * Bare compact magnitude in response text: "1.2B", "500M", "3.5T", "-3.68T".
 * A currency-prefixed amount is captured in group 1 so the caller can skip it,
 * since CURRENCY_PATTERN already consumed those digits. Groups are currency
 * prefix (1), bare sign (2), digits (3), and compact magnitude (4); the compact
 * grammar is shared with the tool-string parser via COMPACT_BARE_MAGNITUDE and
 * the digits via NUMBER_DIGITS.
 */
const ABBREVIATED_LARGE_NUMBER_PATTERN = new RegExp(
  `(${SIGN_CHAR_CLASS}?\\$${SIGN_CHAR_CLASS}?)?(${SIGN_CHAR_CLASS})?(${NUMBER_DIGITS})(${COMPACT_BARE_MAGNITUDE})`,
  "g",
);

/**
 * Financial metric patterns: "P/E of 28.5", "ratio of 1.2", "yield of 3.5".
 * An optional magnitude is consumed with the number so a metric written as
 * "market cap of 3.68T" or "market cap of 3.68 Trillion" scales once instead of
 * also emitting an unscaled mantissa. Groups are the value (1) and an optional
 * magnitude (2).
 */
const FINANCIAL_METRIC_PATTERN = new RegExp(
  `(?:P\\/E|EPS|P\\/B|P\\/S|PEG|yield|ratio|margin|return|drawdown|volatility|beta|alpha|sharpe|VaR|market\\s+cap)\\s+(?:of\\s+|is\\s+|at\\s+|:?\\s*)([+-]?${NUMBER_DIGITS})(${CURRENCY_MAGNITUDE})?`,
  "gi",
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

  // Abbreviated large numbers: 1.2B, 500M, 3.5T, -3.68T. Currency-prefixed
  // amounts are already consumed by CURRENCY_PATTERN, so skip them here rather
  // than emit a second, unsigned value. A bare sign is applied once so a signed
  // magnitude never also emits an unsigned duplicate. A trailing `m`/`M` in
  // explicit duration context is minutes, not a millions magnitude.
  for (const m of text.matchAll(ABBREVIATED_LARGE_NUMBER_PATTERN)) {
    if (m[1] !== undefined) continue;
    const value = parseMagnitude(m[3], m[4]);
    const negative = m[2] !== undefined && MINUS_SIGN_CHARS.has(m[2]);
    numbers.push(negative ? -value : value);
  }

  // Financial metric patterns: "P/E of 28.5", "market cap of 3.68T"
  for (const m of text.matchAll(FINANCIAL_METRIC_PATTERN)) {
    numbers.push(parseMagnitude(m[1], m[2]));
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
        // Bare number (groups 5-7): optional sign, digits, optional shared
        // magnitude. A magnitude suffix is consumed with the digits so the
        // unscaled mantissa is never emitted beside the scaled value.
        // An unsigned, unscaled percent takes its direction from adjacent
        // wording exactly as in answer text, so "fell 2.47%" is -2.47 on both
        // sides of the comparison.
        const start = m.index ?? 0;
        const end = start + m[0].length;
        const direction =
          m[5] === undefined && m[7] === undefined && obj[end] === "%"
            ? directionForPercent(obj, start, end + 1)
            : undefined;
        const sign = m[5] ?? direction;
        const negative = sign !== undefined && MINUS_SIGN_CHARS.has(sign);
        const n = parseMagnitude(m[6], m[7]);
        if (Number.isFinite(n)) numbers.push(negative ? -n : n);
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
