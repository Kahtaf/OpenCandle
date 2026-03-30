import type { ExtractedEntities } from "./types.js";

const COMMON_WORDS = new Set([
  "I", "A", "AN", "AM", "AS", "AT", "BE", "BY", "DO", "GO", "IF", "IN", "IS",
  "IT", "ME", "MY", "NO", "OF", "ON", "OR", "SO", "TO", "UP", "US", "WE",
  "THE", "AND", "BUT", "FOR", "NOT", "ALL", "ARE", "CAN", "HAD", "HAS", "HER",
  "HIM", "HIS", "HOW", "ITS", "LET", "MAY", "NEW", "NOW", "OLD", "OUR", "OWN",
  "SAY", "SHE", "TOO", "USE", "WAY", "WHO", "BOY", "DID", "GET", "HAS", "HIM",
  "OUT", "PUT", "RUN", "SET", "TOP", "WHY", "BIG", "END", "FAR", "FEW",
  "GOT", "LOW", "MAN", "OFF", "PAY", "TRY", "TWO", "BUY", "ETF", "ETFS",
  "BEST", "WHAT", "WITH", "THAT", "THIS", "FROM", "HAVE", "BEEN", "SOME",
  "THEM", "THAN", "LIKE", "JUST", "OVER", "ALSO", "BACK", "MUCH", "MOST",
  "ONLY", "VERY", "WHEN", "COME", "MAKE", "FIND", "HERE", "KNOW", "TAKE",
  "WANT", "GIVE", "GOOD", "CALL", "PUTS", "SAFE", "RISK", "LONG", "TERM",
  "NEXT", "SHOW", "LAST",
]);

export function extractEntities(input: string): ExtractedEntities {
  return {
    symbols: extractSymbols(input),
    budget: extractBudget(input),
    maxPremium: extractMaxPremium(input),
    direction: extractDirection(input),
    riskProfile: extractRiskProfile(input),
    dteHint: extractDteHint(input),
    timeHorizon: extractTimeHorizon(input),
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
      !symbols.includes(cleaned)
    ) {
      symbols.push(cleaned);
    }
  }

  return symbols;
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
  if (/\bleaps?\b/i.test(lower) || /\blong[\s-]*dated\b/.test(lower)) return "leaps";
  if (/\bmonth\b/.test(lower)) return "month";
  if (/\bweek(?:ly|s?)?\b/.test(lower)) return "week";
  return undefined;
}

function extractTimeHorizon(input: string): string | undefined {
  const lower = input.toLowerCase();
  if (/\bshort[\s-]*term\b/.test(lower) || /\bday[\s-]*trad/i.test(lower)) return "short";
  if (/\blong[\s-]*term\b/.test(lower) || /\bbuy[\s-]*and[\s-]*hold\b/.test(lower)) return "long";
  return undefined;
}
