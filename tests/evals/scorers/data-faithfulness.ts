import type { EvalTrace, LayerDetail } from "../types.js";

const RELATIVE_TOLERANCE = 0.01; // 1%

/**
 * Minus-sign characters seen in financial text, including the typographic
 * minus (U+2212) plus small and full-width hyphen-minus variants.
 */
const MINUS_SIGN_CHARS = new Set(["-", "\u2212", "\uFE63", "\uFF0D"]);

/**
 * Currency amount whose sign may precede or follow the dollar sign, with an
 * optional magnitude suffix: $185.50, -$2.50, $-2.50, +$3.25, $1,234.56,
 * -$2.5B. The sign and suffix are part of the match so the digits can never be
 * re-matched as an unsigned substring.
 */
const CURRENCY_PATTERN =
  /([+\-\u2212\uFE63\uFF0D])?\$([+\-\u2212\uFE63\uFF0D])?(\d[\d,]*(?:\.\d+)?)([BMTbmt]\b)?/g;

/**
 * A currency amount (groups 1-4) or a plain number (group 5). The ordered
 * alternation keeps a signed currency amount from being double-counted as a
 * bare unsigned number.
 */
const STRING_NUMBER_PATTERN =
  /([+\-\u2212\uFE63\uFF0D])?\$([+\-\u2212\uFE63\uFF0D])?(\d[\d,]*(?:\.\d+)?)([BMTbmt]\b)?|([+-]?\d+(?:\.\d+)?)/g;

/** Apply the B/M/T magnitude suffix (if any) to a currency magnitude. */
function magnitudeMultiplier(suffix: string | undefined): number {
  if (suffix === undefined) return 1;
  const upper = suffix.toUpperCase();
  if (upper === "T") return 1e12;
  if (upper === "B") return 1e9;
  return 1e6;
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

  // Percentages: 28.5%, -0.5%, +12.3%
  for (const m of text.matchAll(/[+-]?\d+(?:\.\d+)?%/g)) {
    numbers.push(parseFloat(m[0].replace("%", "")));
  }

  // Multipliers: 15.3x
  for (const m of text.matchAll(/\d+(?:\.\d+)?x\b/g)) {
    numbers.push(parseFloat(m[0].replace("x", "")));
  }

  // Abbreviated large numbers: 1.2B, 500M, 3.5T. Currency-prefixed amounts are
  // already consumed by CURRENCY_PATTERN, so skip them here rather than emit a
  // second, unsigned value.
  for (const m of text.matchAll(
    /([+\-\u2212\uFE63\uFF0D]?\$[+\-\u2212\uFE63\uFF0D]?)?(\d+(?:\.\d+)?[BMTbmt]\b)/g,
  )) {
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
        const n = parseFloat(m[0]);
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
