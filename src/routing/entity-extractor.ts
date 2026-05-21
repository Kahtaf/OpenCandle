import type { ExtractedEntities } from "./types.js";

const COMMON_WORDS = new Set([
  "I", "A", "AN", "AM", "AS", "AT", "BE", "BY", "DO", "GO", "IF", "IN", "IS",
  "IT", "ME", "MY", "NO", "OF", "ON", "OR", "SO", "TO", "UP", "US", "WE",
  "THE", "AND", "BUT", "FOR", "NOT", "ALL", "ARE", "CAN", "HAD", "HAS", "HER",
  "HIM", "HIS", "HOW", "ITS", "LET", "MAY", "NEW", "NOW", "OLD", "OUR", "OWN",
  "SAY", "SHE", "TOO", "USE", "WAY", "WHO", "BOY", "DID", "GET", "HAS", "HIM",
  "OUT", "PUT", "RUN", "SET", "TOP", "WHY", "BIG", "END", "FAR", "FEW",
  "GOT", "LOW", "MAN", "OFF", "PAY", "TRY", "TWO", "BUY", "ETF", "ETFS",
  // Technical analysis acronyms
  "SMA", "EMA", "RSI", "MACD", "OBV", "ATR", "ADX", "VWAP",
  // Fundamental analysis acronyms
  "DCF", "FCF", "ROE", "ROA", "ROI", "EPS", "NAV", "WACC", "EBIT",
  // Regulatory / source acronyms that are not tickers in natural language
  "SEC",
  "BEST", "WHAT", "WITH", "THAT", "THIS", "FROM", "HAVE", "BEEN", "SOME",
  "THEM", "THAN", "LIKE", "JUST", "OVER", "ALSO", "BACK", "MUCH", "MOST",
  "ONLY", "VERY", "WHEN", "COME", "MAKE", "FIND", "HERE", "KNOW", "TAKE",
  "WANT", "GIVE", "GOOD", "CALL", "PUTS", "SAFE", "RISK", "LONG", "TERM",
  "NEXT", "SHOW", "LAST",
]);

const AMBIGUOUS_CONCEPT_TICKERS = new Set(["AI", "CPI", "FRED", "GUI"]);

export function extractEntities(input: string): ExtractedEntities {
  const symbols = extractSymbols(input);
  const heldSymbol = extractHeldSymbol(input, symbols);
  return {
    symbols,
    budget: extractBudget(input),
    maxPremium: extractMaxPremium(input),
    costBasis: extractCostBasis(input),
    direction: extractDirection(input),
    riskProfile: extractRiskProfile(input),
    dteHint: extractDteHint(input),
    heldSymbol,
    catalystSymbols: heldSymbol
      ? symbols.filter((symbol) => symbol !== heldSymbol)
      : undefined,
    timeHorizon: extractTimeHorizon(input),
    assetScope: extractAssetScope(input),
    compareMetrics: extractCompareMetrics(input),
  };
}

export function extractBudget(input: string): number | undefined {
  // Match $10,000 or $10000 or $10k
  const dollarSign = input.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?\b/);
  if (dollarSign) {
    const base = parseFloat(dollarSign[1].replace(/,/g, ""));
    return dollarSign[2] ? base * 1000 : base;
  }

  // Match "10k" or "10K" standalone
  const kNotation = input.match(/\b(\d+(?:\.\d+)?)\s*[kK]\b/);
  if (kNotation) {
    return parseFloat(kNotation[1]) * 1000;
  }

  // Match "10000 dollars" or "10,000 dollars"
  const dollarWord = input.match(/\b([\d,]+(?:\.\d+)?)\s+dollars?\b/i);
  if (dollarWord) {
    return parseFloat(dollarWord[1].replace(/,/g, ""));
  }

  return undefined;
}

function extractSymbols(input: string): string[] {
  const symbols: string[] = [];

  // Match $TICKER patterns
  const dollarTickers = input.matchAll(/\$([A-Za-z]{1,5})\b/g);
  for (const match of dollarTickers) {
    symbols.push(match[1].toUpperCase());
  }

  // Match standalone uppercase tickers (1-5 chars, all caps)
  const words = input.split(/[\s,]+/);
  for (const word of words) {
    const cleaned = word.replace(/[^A-Za-z]/g, "");
    if (
      cleaned.length >= 1 &&
      cleaned.length <= 5 &&
      cleaned === cleaned.toUpperCase() &&
      /^[A-Z]+$/.test(cleaned) &&
      !COMMON_WORDS.has(cleaned) &&
      !isAmbiguousConceptUsage(input, cleaned) &&
      !symbols.includes(cleaned)
    ) {
      symbols.push(cleaned);
    }
  }

  return symbols;
}

export function isAmbiguousConceptUsage(input: string, symbol: string): boolean {
  if (!AMBIGUOUS_CONCEPT_TICKERS.has(symbol)) return false;
  if (new RegExp(`\\$${symbol}\\b`).test(input)) return false;
  if (
    new RegExp(
      `\\b(?:analyze|quote|ticker|stock|shares?|options?|calls?|puts?)\\s+${symbol}\\b|\\b${symbol}\\s+(?:ticker|stock|shares?|quote|options?|calls?|puts?)\\b`,
      "i",
    ).test(input)
  ) {
    return false;
  }
  return true;
}

function extractMaxPremium(input: string): number | undefined {
  const lower = input.toLowerCase();
  if (!/\bpremium\b/.test(lower)) return undefined;

  const under = input.match(/\b(?:under|below|less\s+than|max(?:imum)?|up\s+to)\s+\$?\s*([\d,]+(?:\.\d+)?)\s*([kK])?\b/i);
  if (under) {
    const base = parseFloat(under[1].replace(/,/g, ""));
    if (isNaN(base)) return undefined;
    return under[2] ? base * 1000 : base;
  }

  const trailing = input.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?\s*(?:premium|max\s*premium)\b/i);
  if (trailing) {
    const base = parseFloat(trailing[1].replace(/,/g, ""));
    if (isNaN(base)) return undefined;
    return trailing[2] ? base * 1000 : base;
  }

  return undefined;
}

function extractHeldSymbol(input: string, symbols: string[]): string | undefined {
  const patterns = [
    /\b(?:i\s+)?(?:have|own|hold|holding|long)\s+\$?([A-Za-z]{1,5})\b/i,
    /\bmy\s+\$?([A-Za-z]{1,5})\s+(?:position|shares?|stock)\b/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    const symbol = match?.[1]?.toUpperCase();
    if (symbol && symbols.includes(symbol)) return symbol;
  }
  return undefined;
}

function extractCostBasis(input: string): number | undefined {
  const match = input.match(/\b(?:cost\s*basis|basis|entry(?:\s*price)?)\s*(?:is|at|of|:)?\s*\$?\s*([\d,]+(?:\.\d+)?)\b/i);
  if (!match) return undefined;
  const value = parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

function extractDirection(input: string): "bullish" | "bearish" | undefined {
  const lower = input.toLowerCase();
  if (/\bcalls?\b/.test(lower) || /\bbullish\b/.test(lower)) return "bullish";
  if (/\bputs?\b/.test(lower) || /\bbearish\b/.test(lower)) return "bearish";
  return undefined;
}

function extractRiskProfile(input: string): string | undefined {
  const lower = input.toLowerCase();
  if (/\bconservative\b/.test(lower) || /\brisk\s*averse\b/.test(lower) || /\bsafe[r]?\b/.test(lower)) {
    return "conservative";
  }
  if (/\baggressive\b/.test(lower) || /\bhigh\s*risk\b/.test(lower)) {
    return "aggressive";
  }
  if (/\bbalanced\b/.test(lower) || /\bmoderate\b/.test(lower)) {
    return "balanced";
  }
  return undefined;
}

function extractDteHint(input: string): string | undefined {
  const lower = input.toLowerCase();
  if (/\bearnings?\b.*\b(?:today|tonight|this\s+week)\b|\b(?:today|tonight|this\s+week)\b.*\bearnings?\b/.test(lower)) return "event_week";
  if (/\bleaps?\b/i.test(lower) || /\blong[\s-]*dated\b/.test(lower)) return "leaps";
  if (/\bmonth\b/.test(lower)) return "month";
  if (/\bweek(?:ly|s?)?\b/.test(lower)) return "week";
  return undefined;
}

function extractTimeHorizon(input: string): string | undefined {
  const lower = input.toLowerCase();
  const explicitMonths = lower.match(/\b(\d+)\s*(?:month|months|mo|mos)\b/);
  if (explicitMonths) return `${explicitMonths[1]}mo`;
  const explicitYears = lower.match(/\b(\d+)\s*(?:year|years|yr|yrs)\b/);
  if (explicitYears) return `${explicitYears[1]}_years`;
  if (/\bshort[\s-]*term\b/.test(lower) || /\bday[\s-]*trad/i.test(lower)) return "short";
  if (/\blong[\s-]*term\b/.test(lower) || /\bbuy[\s-]*and[\s-]*hold\b/.test(lower)) return "long";
  return undefined;
}

function extractAssetScope(input: string): string | undefined {
  const lower = input.toLowerCase();
  if (/\betfs?\b/.test(lower)) return "etf_focused";
  return undefined;
}

function extractCompareMetrics(input: string): string[] | undefined {
  const lower = input.toLowerCase();
  const metrics: string[] = [];
  if (/\bsentiment\b/.test(lower)) metrics.push("sentiment");
  if (/\b(?:macro\s*)?hedg(?:e|ing)\b/.test(lower)) metrics.push("macro_hedge");
  return metrics.length > 0 ? metrics : undefined;
}
