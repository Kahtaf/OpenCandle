import type { EvalTrace, LayerDetail } from "../types.js";

const RELATIVE_TOLERANCE = 0.01; // 1%

/**
 * Extract financial numbers from response text.
 * Matches: $185.50, 28.5%, 1.2B, 15.3x, -0.5%, plain decimals in financial context.
 * Excludes: ordinals (1st, 2nd), list indices, dates, year numbers.
 */
export function extractFinancialNumbers(text: string): number[] {
  const numbers: number[] = [];

  // Currency amounts: $185.50, $1,234.56
  for (const m of text.matchAll(/\$[\d,]+(?:\.\d+)?/g)) {
    numbers.push(parseFloat(m[0].replace(/[$,]/g, "")));
  }

  // Percentages: 28.5%, -0.5%, +12.3%
  for (const m of text.matchAll(/[+-]?\d+(?:\.\d+)?%/g)) {
    numbers.push(parseFloat(m[0].replace("%", "")));
  }

  // Multipliers: 15.3x
  for (const m of text.matchAll(/\d+(?:\.\d+)?x\b/g)) {
    numbers.push(parseFloat(m[0].replace("x", "")));
  }

  // Abbreviated large numbers: 1.2B, 500M, 3.5T
  for (const m of text.matchAll(/\d+(?:\.\d+)?[BMTbmt]\b/g)) {
    const raw = m[0];
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

  if (typeof obj === "number" && isFinite(obj)) {
    numbers.push(obj);
  } else if (typeof obj === "string") {
    // Extract numbers from string values
    for (const m of obj.matchAll(/[+-]?\d+(?:\.\d+)?/g)) {
      const n = parseFloat(m[0]);
      if (isFinite(n)) numbers.push(n);
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
      groundTruth.has(num) ||
      [...groundTruth].some((ref) => isWithinTolerance(num, ref));
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
