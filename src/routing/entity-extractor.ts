import type { ExtractedEntities } from "./types.js";

const COMMON_WORDS = new Set([
  "I",
  "A",
  "AN",
  "AM",
  "AS",
  "AT",
  "BE",
  "BY",
  "DO",
  "GO",
  "IF",
  "IN",
  "IS",
  "IT",
  "ME",
  "MY",
  "NO",
  "OF",
  "ON",
  "OR",
  "SO",
  "TO",
  "UP",
  "US",
  "WE",
  "THE",
  "AND",
  "BUT",
  "FOR",
  "NOT",
  "ALL",
  "ARE",
  "CAN",
  "HAD",
  "HAS",
  "HER",
  "HIM",
  "HIS",
  "HOW",
  "ITS",
  "LET",
  "MAY",
  "NEW",
  "NOW",
  "OLD",
  "OUR",
  "OWN",
  "SAY",
  "SHE",
  "TOO",
  "USE",
  "WAY",
  "WHO",
  "BOY",
  "DID",
  "GET",
  "HAS",
  "HIM",
  "OUT",
  "PUT",
  "RUN",
  "SET",
  "TOP",
  "WHY",
  "BIG",
  "END",
  "FAR",
  "FEW",
  "GOT",
  "LOW",
  "MAN",
  "OFF",
  "PAY",
  "TRY",
  "TWO",
  "BUY",
  "DOES",
  "ETF",
  "ETFS",
  // Technical analysis acronyms
  "SMA",
  "EMA",
  "RSI",
  "MACD",
  "OBV",
  "ATR",
  "ADX",
  "VWAP",
  // Fundamental analysis acronyms
  "DCF",
  "FCF",
  "ROE",
  "ROA",
  "ROI",
  "EPS",
  "NAV",
  "WACC",
  "EBIT",
  // Regulatory / source / finance acronyms that are not tickers in natural language
  "IV",
  "HV",
  "ITM",
  "OTM",
  "ATM",
  "IPO",
  "SEC",
  "FED",
  "FOMC",
  "IRS",
  "ECB",
  "BOE",
  "BOJ",
  "GDP",
  "CPI",
  "PPI",
  "FX",
  "NDA",
  "YTD",
  "BEST",
  "WHAT",
  "WITH",
  "THAT",
  "THIS",
  "FROM",
  "HAVE",
  "BEEN",
  "SOME",
  "THEM",
  "THAN",
  "LIKE",
  "JUST",
  "OVER",
  "ALSO",
  "BACK",
  "MUCH",
  "MOST",
  "ONLY",
  "VERY",
  "WHEN",
  "COME",
  "MAKE",
  "FIND",
  "HERE",
  "KNOW",
  "TAKE",
  "WANT",
  "GIVE",
  "GOOD",
  "CALL",
  "PUTS",
  "SAFE",
  "RISK",
  "LONG",
  "TERM",
  "NEXT",
  "SHOW",
  "LAST",
]);

const AMBIGUOUS_CONCEPT_TICKERS = new Set(["AI", "CPI", "FRED", "GUI", "MA"]);
const CURRENCY_CODES = new Set(["USD", "CAD", "EUR", "GBP", "AUD", "JPY", "CHF"]);
const EXPLICIT_FINANCE_ACRONYM_TICKERS = new Set([
  "IV",
  "HV",
  "ITM",
  "OTM",
  "ATM",
  "IPO",
  "SEC",
  "FED",
  "FOMC",
  "IRS",
  "ECB",
  "BOE",
  "BOJ",
  "GDP",
  "CPI",
  "PPI",
  "FX",
  "NDA",
]);
const LOWERCASE_FINANCE_TERMS = new Set([
  "bond",
  "bonds",
  "cash",
  "rate",
  "rates",
  "cuts",
  // Trading verbs written in lowercase are actions, not tickers — "sell
  // calls" must not mint a SELL symbol. Uppercase ticker extraction is
  // unaffected, so a genuine $SELL / "SELL" ticker still resolves.
  "sell",
  "buy",
  "hold",
  "write",
  "roll",
  "trim",
  "gold",
  "oil",
  "stock",
  "stocks",
  "fund",
  "funds",
  "etf",
  "etfs",
  "puts",
  "calls",
  "option",
  "options",
]);

export function extractEntities(input: string): ExtractedEntities {
  const symbols = extractSymbols(input);
  const heldSymbol = extractHeldSymbol(input, symbols);
  const catalystSymbols = heldSymbol ? symbols.filter((symbol) => symbol !== heldSymbol) : [];
  return {
    symbols,
    budget: extractBudget(input),
    maxPremium: extractMaxPremium(input),
    costBasis: extractCostBasis(input),
    shareQuantity: extractShareQuantity(input),
    direction: extractDirection(input),
    riskProfile: extractRiskProfile(input),
    dteHint: extractDteHint(input),
    optionStrategy: extractOptionStrategy(input),
    heldSymbol,
    catalystSymbols: catalystSymbols.length > 0 ? catalystSymbols : undefined,
    timeHorizon: extractTimeHorizon(input),
    assetScope: extractAssetScope(input),
    positionCount: extractPositionCount(input),
    maxSinglePositionPct: extractMaxSinglePositionPct(input),
    compareMetrics: extractCompareMetrics(input),
  };
}

export function extractBudget(input: string): number | undefined {
  if (
    /\b(?:at|above|below|under|over|near)\s+\$\s*[\d,]+(?:\.\d+)?\s*([kK])?\b/i.test(input) &&
    !hasBudgetContext(input)
  ) {
    return undefined;
  }

  // Match $10,000 or $10000 or $10k
  const dollarSign = input.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?\b/);
  if (dollarSign) {
    if (isNonBudgetDollarAmount(input, dollarSign.index ?? 0, dollarSign[0].length)) {
      return undefined;
    }
    const base = parseFloat(dollarSign[1].replace(/,/g, ""));
    return dollarSign[2] ? base * 1000 : base;
  }

  // Match "10k" or "10K" standalone
  const kNotation = input.match(/\b(\d+(?:\.\d+)?)\s*[kK]\b/);
  if (kNotation) {
    if (isNonBudgetDollarAmount(input, kNotation.index ?? 0, kNotation[0].length)) {
      return undefined;
    }
    return parseFloat(kNotation[1]) * 1000;
  }

  // Match "10000 dollars" or "10,000 dollars"
  const dollarWord = input.match(/\b([\d,]+(?:\.\d+)?)\s+dollars?\b/i);
  if (dollarWord) {
    if (isNonBudgetDollarAmount(input, dollarWord.index ?? 0, dollarWord[0].length)) {
      return undefined;
    }
    return parseFloat(dollarWord[1].replace(/,/g, ""));
  }

  return undefined;
}

function hasBudgetContext(input: string): boolean {
  return /\b(?:budget|invest|allocate|portfolio|cash|capital|with|have|spend|put\s+to\s+work)\b/i.test(
    input,
  );
}

function isNonBudgetDollarAmount(input: string, start: number, length: number): boolean {
  const before = input.slice(Math.max(0, start - 32), start);
  const after = input.slice(start + length, start + length + 24);
  return (
    /\b(?:average\s+cost|avg\s+cost|cost\s*basis|basis|entry(?:\s*price)?|worth|valued?\s+at|pays?|dividends?\s+of|gained|lost|received|made|profit\s+of|up|down|trading\s+(?:at|around|near))\s*(?:is|at|of|:)?\s*$/i.test(
      before,
    ) ||
    /^\s*(?:premium|max\s+premium|average\s+cost|avg\s+cost|cost\s*basis|basis|entry(?:\s*price)?|per\s+share|in\s+dividends?|profit|gain|loss)\b/i.test(
      after,
    )
  );
}

function extractSymbols(input: string): string[] {
  const symbols: string[] = [];
  const addSymbol = (
    raw: string | undefined,
    options: { lowercaseContext?: boolean; explicitTicker?: boolean } = {},
  ) => {
    const symbol = raw?.toUpperCase();
    if (options.lowercaseContext && LOWERCASE_FINANCE_TERMS.has(String(raw || "").toLowerCase())) {
      return;
    }
    if (
      symbol &&
      !options.explicitTicker &&
      CURRENCY_CODES.has(symbol) &&
      isCurrencyCodeUsage(input, symbol)
    ) {
      return;
    }
    if (
      symbol &&
      symbol.length >= 1 &&
      symbol.length <= 5 &&
      /^[A-Z]+$/.test(symbol) &&
      (!COMMON_WORDS.has(symbol) ||
        (options.explicitTicker && EXPLICIT_FINANCE_ACRONYM_TICKERS.has(symbol))) &&
      !isAmbiguousConceptUsage(input, symbol) &&
      !symbols.includes(symbol)
    ) {
      symbols.push(symbol);
    }
  };

  // Match $TICKER patterns
  const dollarTickers = input.matchAll(/\$([A-Za-z]{1,5})\b/g);
  for (const match of dollarTickers) {
    addSymbol(match[1], { explicitTicker: true });
  }

  // Match explicit lowercase ticker contexts without treating arbitrary short
  // words as symbols.
  const lowercaseCompare = input.match(
    /\bcompare\s+([a-z]{1,5})\s+(?:and|vs\.?|versus)\s+([a-z]{1,5})\b/i,
  );
  if (lowercaseCompare) {
    addSymbol(lowercaseCompare[1], { lowercaseContext: true });
    addSymbol(lowercaseCompare[2], { lowercaseContext: true });
  }
  const lowercaseTickerContext = input.matchAll(
    /\b(?:analy[sz]e|quote|ticker)\s+\$?([a-z]{1,5})\b|\b\$?([a-z]{1,5})\s+(?:ticker|stock|shares?|quote|options?|calls?|puts?)\b/gi,
  );
  for (const match of lowercaseTickerContext) {
    addSymbol(match[1] ?? match[2], { lowercaseContext: true, explicitTicker: true });
  }
  const lowercaseHeldPosition = input.matchAll(
    /\b(?:own|hold|holding|long|protect|hedge|have)\s+\d+(?:,\d{3})*\s+shares?\s+(?:of\s+)?\$?([a-z]{1,5})\b|\b\d+(?:,\d{3})*\s+shares?\s+of\s+\$?([a-z]{1,5})\b/gi,
  );
  for (const match of lowercaseHeldPosition) {
    const raw = match[1] ?? match[2];
    if (raw && raw !== raw.toUpperCase()) {
      addSymbol(raw, { lowercaseContext: true });
    }
  }

  // Match standalone uppercase tickers (1-5 chars, all caps)
  const words = input.split(/[\s,]+/);
  for (const word of words) {
    const cleaned = word.replace(/[^A-Za-z]/g, "");
    if (cleaned === cleaned.toUpperCase()) {
      addSymbol(cleaned);
    }
  }

  return symbols;
}

export function isCurrencyCodeUsage(input: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b(?:average\\s+cost|avg\\s+cost|cost\\s+basis|entry\\s+price|currency|denominated|dollars?|per\\s+share|base\\s+currency|cash)\\b[^.?!]{0,80}\\b${escaped}\\b|\\b${escaped}\\b[^.?!]{0,40}\\b(?:currency|dollars?|cash|base\\s+currency)\\b`,
    "i",
  ).test(input);
}

export function isAmbiguousConceptUsage(input: string, symbol: string): boolean {
  if (!AMBIGUOUS_CONCEPT_TICKERS.has(symbol)) return false;
  if (new RegExp(`\\$${symbol}\\b`).test(input)) return false;
  if (symbol === "MA") {
    return isMovingAverageUsage(input);
  }
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

function isMovingAverageUsage(input: string): boolean {
  return (
    /\bmoving\s+averages?\b/i.test(input) ||
    /\b(?:simple|exponential|weighted|day|daily|week|weekly|month|monthly|\d+\s*(?:d|day|days|w|week|weeks)?)\s+MA\b/i.test(
      input,
    ) ||
    /\bMA\s+(?:crossover|cross|signal|signals|strategy|trend|trends|line|lines)\b/i.test(input) ||
    /\bM&A\b/.test(input)
  );
}

function extractMaxPremium(input: string): number | undefined {
  const lower = input.toLowerCase();
  if (!/\bpremium\b/.test(lower)) return undefined;

  const under = input.match(
    /\b(?:under|below|less\s+than|max(?:imum)?|up\s+to)\s+\$?\s*([\d,]+(?:\.\d+)?)\s*([kK])?\b/i,
  );
  if (under) {
    const base = parseFloat(under[1].replace(/,/g, ""));
    if (Number.isNaN(base)) return undefined;
    return under[2] ? base * 1000 : base;
  }

  const trailing = input.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?\s*(?:premium|max\s*premium)\b/i);
  if (trailing) {
    const base = parseFloat(trailing[1].replace(/,/g, ""));
    if (Number.isNaN(base)) return undefined;
    return trailing[2] ? base * 1000 : base;
  }

  return undefined;
}

function extractHeldSymbol(input: string, symbols: string[]): string | undefined {
  const patterns = [
    /\b(?:i\s+)?(?:have|own|hold|holding|long)\s+\d+(?:,\d{3})*\s+shares?\s+(?:of\s+)?\$?([A-Za-z]{1,5})\b/i,
    /\b(?:my\s+)?\d+(?:,\d{3})*\s+\$?([A-Za-z]{1,5})\s+shares?\b/i,
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

function extractShareQuantity(input: string): number | undefined {
  const match = input.match(/\b(\d{1,3}(?:,\d{3})*|\d{1,6})\s+shares?\b/i);
  if (!match) return undefined;
  const value = parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(value) ? value : undefined;
}

function extractCostBasis(input: string): number | undefined {
  const match =
    input.match(
      /\b(?:cost\s*basis|basis|entry(?:\s*price)?)\s*(?:is|at|of|:)?\s*\$?\s*([\d,]+(?:\.\d+)?)\b/i,
    ) ?? input.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:cost\s*basis|basis|entry(?:\s*price)?)\b/i);
  if (!match) return undefined;
  const value = parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

function extractDirection(input: string): "bullish" | "bearish" | undefined {
  const lower = input.toLowerCase();
  if (/\bcalls?\b(?!\s+out\b)/.test(lower) || /\bbullish\b/.test(lower)) return "bullish";
  if (/\bputs?\b/.test(lower) || /\bbearish\b/.test(lower)) return "bearish";
  return undefined;
}

function extractRiskProfile(input: string): string | undefined {
  const lower = input.toLowerCase();
  if (
    /\bconservative\b/.test(lower) ||
    /\brisk\s*averse\b/.test(lower) ||
    /\bsafe[r]?\b/.test(lower)
  ) {
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
  const withinDays = lower.match(
    /\b(?:within|up\s+to|no\s+more\s+than|at\s+most|max(?:imum)?)\s+(\d+)\s*(?:dte|days?)\b/,
  );
  if (withinDays) return `0-${withinDays[1]} days`;
  const explicitDays = lower.match(/\b(\d+)\s*(?:-|to|or)\s*(\d+)\s*(?:dte|days?)\b/);
  if (explicitDays) return `${explicitDays[1]}-${explicitDays[2]} days`;
  // An explicit user week range ("1-2 weeks out") must outrank the
  // catalyst-derived event_week inference below; a same-day earnings
  // mention otherwise collapses the requested horizon to 0-7 days
  // (historical "1-2 weeks DTE preservation" loss class).
  const explicitWeeks = lower.match(
    /\b(\d+|one|two|three|four)\s*(?:[-–]|to|or)\s*(\d+|one|two|three|four)\s*weeks?\b/,
  );
  if (explicitWeeks) return `${explicitWeeks[1]}-${explicitWeeks[2]} weeks`;
  if (/\bmonth\b/.test(lower)) return "month";
  if (
    /\bearnings?\b.*\b(?:today|tonight|this\s+week)\b|\b(?:today|tonight|this\s+week)\b.*\bearnings?\b/.test(
      lower,
    )
  )
    return "event_week";
  if (/\bleaps?\b/i.test(lower) || /\blong[\s-]*dated\b/.test(lower)) return "leaps";
  if (/\bweek(?:ly|s?)?\b/.test(lower)) return "week";
  return undefined;
}

function extractOptionStrategy(input: string): ExtractedEntities["optionStrategy"] | undefined {
  const lower = input.toLowerCase();
  if (/\bcovered\s+calls?\b/.test(lower)) return "covered_call";
  if (/\b(?:protective|married)\s+puts?\b/.test(lower)) return "protective_put";
  if (
    /\b(?:hedge|protect|protection|insurance)\b/.test(lower) &&
    /\bputs?\b/.test(lower) &&
    /\b(?:own|hold|holding|long|shares?|position)\b/.test(lower)
  ) {
    return "protective_put";
  }
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
  if (/\bstocks?\s*(?:\+|and)\s*etfs?\b/.test(lower)) return "stocks_and_etfs";
  if (/\bstocks?\s*(?:\+|and)\s*crypto(?:currencies)?\b/.test(lower)) {
    return "stocks_and_crypto";
  }
  if (/\bstocks?\s+only\b/.test(lower)) return "stocks_only";
  if (/\b(?:u\.?s\.?\s+stocks?|individual\s+stocks?)\b/.test(lower)) return "stocks_only";
  if (/\betfs?\b/.test(lower)) return "etf_focused";
  if (/\bfunds?\b/.test(lower)) return "fund_focused";
  if (/\bindex\s+(?:funds?|products?)\b/.test(lower)) return "index_focused";
  return undefined;
}

function extractPositionCount(input: string): number | undefined {
  const match = input.match(/\b(\d{1,2})\s+positions?\b/i);
  if (!match) return undefined;
  const count = Number(match[1]);
  return count >= 1 && count <= 50 ? count : undefined;
}

function extractMaxSinglePositionPct(input: string): number | undefined {
  const match = input.match(
    /\bmax(?:imum)?\s+(\d{1,3}(?:\.\d+)?)\s*%\s+(?:per|for (?:any|each))\s+(?:position|holding)\b/i,
  );
  if (!match) return undefined;
  const percent = Number(match[1]);
  return percent > 0 && percent <= 100 ? percent : undefined;
}

function extractCompareMetrics(input: string): string[] | undefined {
  const lower = input.toLowerCase();
  const metrics: string[] = [];
  if (/\bsentiment\b/.test(lower)) metrics.push("sentiment");
  if (/\b(?:macro\s*)?hedg(?:e|ing)\b/.test(lower)) metrics.push("macro_hedge");
  if (/\b(?:rates?|rate\s*cuts?|fed|federal\s+funds?|interest\s+rates?)\b/.test(lower))
    metrics.push("interest_rates");
  if (
    /\b(?:overlap|same\s+stuff|same\s+holdings|concentration|too\s+much\s+of\s+the\s+same)\b/.test(
      lower,
    )
  )
    metrics.push("overlap");
  return metrics.length > 0 ? metrics : undefined;
}
